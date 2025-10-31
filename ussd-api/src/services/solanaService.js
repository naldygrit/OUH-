/**
 * Solana Service — Canonical Implementation
 * ----------------------------------------
 * - Single, stable interface consumed by USSD router.
 * - Normalized phone handling ("+234..." -> "0...").
 * - Registry-backed wallet cache with on-chain PDA fallback (dev-friendly).
 * - PIN validation + attempt rate limiting.
 * - Pyth (mock) NGN/USDC rate aggregation with best-source selection.
 * - Clean, predictable return shapes.
 *
 * Swap mocks with real on-chain/program calls as you progress; keep the
 * public method signatures identical so router code remains unchanged.
 */

'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const nacl = require('tweetnacl');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const userRegistry = require('./userRegistry');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const normalizePhone = (p) => String(p || '').replace(/^\+234/, '0');
const maskPhone = (p) => {
  const s = String(p || '');
  return s.length >= 4 ? `${s.slice(0, 4)}****` : '****';
};

// Basic Solana pubkey regex (Base58, 32-44 chars)
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---------------------------------------------------------------------------
// Service Class
// ---------------------------------------------------------------------------

class SolanaService {
  constructor() {
    // Environment
    this.cluster = process.env.SOLANA_CLUSTER || 'localnet';
    this.rpcUrl = this.cluster === 'devnet'
      ? (process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com')
      : (process.env.SOLANA_RPC_URL_LOCALNET || 'http://127.0.0.1:8899');

    this.programIdString = this.cluster === 'devnet'
      ? (process.env.SOLANA_PROGRAM_ID_DEVNET || 'CZohQsF3D3cDDTtJnMZi9WirsknWxWyBKgHiLg5b1T8E')
      : (process.env.SOLANA_PROGRAM_ID_LOCALNET || '74D7UqGmgBaod2jTaKotYF8rDNd3xWv9eo43Gt5iHKxS');

    this.connection = new Connection(this.rpcUrl, 'confirmed');
    this.programId = new PublicKey(this.programIdString);

    // Security salts & limits
    this.phoneHashSalt = process.env.PHONE_HASH_SALT || 'default_phone_salt_change_in_production';
    this.pinHashSalt = process.env.PIN_HASH_SALT || 'default_pin_salt_change_in_production';
    this.regionSalt = process.env.REGION_SALT || 'default_region_salt_change_in_production';

    this.pinAttempts = new Map();
    this.pinAttemptLimit = parseInt(process.env.PIN_ATTEMPT_LIMIT || '5', 10);
    this.pinAttemptWindow = 60 * 60 * 1000; // 1 hour

    this.transactionNonces = new Set();

    // Amount limits (₦)
    this.minTransactionAmount = parseFloat(process.env.MIN_TRANSACTION_AMOUNT || '100');
    this.maxTransactionAmount = parseFloat(process.env.MAX_TRANSACTION_AMOUNT || '1000000');

    // Pyth mock toggle
    this.pythEnabled = process.env.PYTH_ENABLED !== 'false';
    this.pythNetwork = this.cluster;

    // Metrics
    this.securityStats = {
      validationFailures: 0,
      pinAttemptViolations: 0,
      transactionAttempts: 0,
      registrationAttempts: 0,
      walletsLinked: 0,
    };

    console.log('🔗 SolanaService init', {
      cluster: this.cluster,
      rpc: this.rpcUrl,
      program: this.programIdString,
      pyth: this.pythEnabled ? 'ENABLED(mock)' : 'DISABLED',
    });
  }

  // -------------------------------------------------------------------------
  // Validators & Sanitizers
  // -------------------------------------------------------------------------

  validatePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') { this.securityStats.validationFailures++; return false; }
    const p = normalizePhone(phone);
    // Nigerian local format 0XXXXXXXXXX with common leading digits, or general E.164 fallback
    const ok = /^0[789][01]\d{8}$/.test(p);
    if (!ok) this.securityStats.validationFailures++;
    return ok;
  }

  validatePin(pin) {
    if (typeof pin !== 'string') { this.securityStats.validationFailures++; return false; }
    const ok = /^\d{4,6}$/.test(pin);
    if (!ok) this.securityStats.validationFailures++;
    return ok;
  }

  validateAmount(amount) {
    const n = Number(amount);
    const ok = Number.isFinite(n) && n >= this.minTransactionAmount && n <= this.maxTransactionAmount;
    if (!ok) this.securityStats.validationFailures++;
    return ok;
  }

  sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>"'%;()&+\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, 100);
  }

  // -------------------------------------------------------------------------
  // Explorer & PDA helpers
  // -------------------------------------------------------------------------

  getExplorerUrl(signature = null) {
    const baseUrl = 'https://explorer.solana.com';
    const clusterParam = this.cluster === 'devnet'
      ? '?cluster=devnet'
      : '?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899';
    const address = signature || this.programIdString;
    const type = signature ? 'tx' : 'address';
    return `${baseUrl}/${type}/${address}${clusterParam}`;
  }

  getSystemAuthority() {
    const [authority] = PublicKey.findProgramAddressSync(
      [Buffer.from('system_authority')],
      this.programId
    );
    return authority;
  }

  async getUserPDA(phoneNumber, authority = null) {
    const key = normalizePhone(phoneNumber);
    const phoneHash = crypto.createHash('sha256').update(key + this.phoneHashSalt).digest();
    const auth = authority || this.getSystemAuthority();
    const [pda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('user_account'), auth.toBuffer(), Buffer.from(phoneHash), Buffer.from([1])],
      this.programId
    );
    return { pda, bump };
  }

  // -------------------------------------------------------------------------
  // PIN attempt rate limiting
  // -------------------------------------------------------------------------

  async checkPinRateLimit(phoneNumber) {
    const key = `pin:${normalizePhone(phoneNumber)}`;
    const now = Date.now();
    const entry = this.pinAttempts.get(key) || { count: 0, first: now, last: 0 };

    if (now - entry.first > this.pinAttemptWindow) {
      entry.count = 0; entry.first = now; entry.last = 0;
    }
    if (entry.count >= this.pinAttemptLimit) {
      const mins = Math.ceil((entry.first + this.pinAttemptWindow - now) / 60000);
      this.securityStats.pinAttemptViolations++;
      throw new Error(`Too many PIN attempts. Try again in ${mins} minutes.`);
    }
    return true;
  }

  incrementPinAttempts(phoneNumber) {
    const key = `pin:${normalizePhone(phoneNumber)}`;
    const now = Date.now();
    const entry = this.pinAttempts.get(key) || { count: 0, first: now, last: 0 };
    entry.count++; entry.last = now;
    this.pinAttempts.set(key, entry);
    console.log(`⚠️ PIN attempt ${entry.count}/${this.pinAttemptLimit} for ${maskPhone(phoneNumber)}`);
  }

  resetPinAttempts(phoneNumber) {
    const key = `pin:${normalizePhone(phoneNumber)}`;
    this.pinAttempts.delete(key);
    console.log(`✅ Reset PIN attempts for ${maskPhone(phoneNumber)}`);
  }

  // -------------------------------------------------------------------------
  // Pyth (Mock) — Rates
  // -------------------------------------------------------------------------

  async getPythPrice() {
    // Mock a multi-publisher price board
    await new Promise(r => setTimeout(r, 30));
    const sources = [
      { publisher: 'Binance P2P', price: 1528, confidence: 0.95 },
      { publisher: 'Quidax',      price: 1535, confidence: 0.92 },
      { publisher: 'Yellow Card', price: 1531, confidence: 0.94 },
      { publisher: 'Luno',        price: 1532, confidence: 0.90 },
      { publisher: 'Busha',       price: 1530, confidence: 0.88 },
      { publisher: 'Bundle',      price: 1529, confidence: 0.91 },
    ];
    return {
      id: 'usdc-ngn-mock-feed',
      price: 1531,
      status: 'trading',
      publishTime: Date.now(),
      numPublishers: sources.length,
      sources,
    };
  }

  async getBestRate() {
    try {
      if (!this.pythEnabled) {
        const rate = parseFloat(process.env.DEFAULT_EXCHANGE_RATE || '1531');
        return { rate, source: 'Default Rate', allSources: [], timestamp: Date.now(), pythEnabled: false };
      }
      const data = await this.getPythPrice();
      const best = data.sources.reduce((a, b) => (b.price < a.price ? b : a));
      return { rate: best.price, source: best.publisher, confidence: best.confidence, allSources: data.sources, timestamp: data.publishTime, pythEnabled: true };
    } catch {
      return { rate: 1531, source: 'Fallback', allSources: [], timestamp: Date.now(), pythEnabled: false };
    }
  }

  // -------------------------------------------------------------------------
  // Wallet resolution & existence
  // -------------------------------------------------------------------------

  async getWalletAddress(phoneNumber) {
    const key = normalizePhone(phoneNumber);

    // 1) Registry cache
    const data = userRegistry.getUserData(key);
    if (data?.walletAddress) return data.walletAddress;

    // 2) If simply registered, derive PDA and cache as addr (dev-mode convenience)
    if (userRegistry.isRegistered(key)) {
      try {
        const { pda } = await this.getUserPDA(key);
        const addr = pda.toString();
        userRegistry.upsert(key, { walletAddress: addr, refreshedAt: Date.now() });
        return addr;
      } catch (_) {}
    }

    // 3) Optional: probe chain for PDA existence and cache (kept minimal)
    try {
      const { pda } = await this.getUserPDA(key);
      const info = await this.connection.getAccountInfo(pda);
      if (info) {
        const addr = pda.toString();
        userRegistry.upsert(key, { walletAddress: addr, refreshedAt: Date.now() });
        return addr;
      }
    } catch (_) {}

    return null;
  }

  async userExists(phoneNumber) {
    const key = normalizePhone(phoneNumber);
    if (!this.validatePhoneNumber(key)) return false;
    const wa = await this.getWalletAddress(key);
    const exists = !!wa;
    console.log('👤 userExists', { phone: maskPhone(key), exists });
    return exists;
  }

  // -------------------------------------------------------------------------
  // Registration & Linking
  // -------------------------------------------------------------------------

  hashPhoneNumber(phoneNumber) {
    return crypto.createHash('sha256').update(normalizePhone(phoneNumber) + this.phoneHashSalt).digest();
  }

  hashPin(pin, phoneNumber) {
    const salt = crypto.createHash('sha256').update(normalizePhone(phoneNumber) + this.pinHashSalt).digest();
    const buf = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256');
    return Array.from(buf);
  }

  generateAlias(phoneNumber) {
    const e164 = normalizePhone(phoneNumber).replace(/^0/, '+234');
    return crypto.createHash('sha256').update(e164 + this.regionSalt).digest('hex');
  }

  generateTransactionNonce() {
    let nonce;
    do { nonce = crypto.randomBytes(16).toString('hex'); } while (this.transactionNonces.has(nonce));
    this.transactionNonces.add(nonce);
    if (this.transactionNonces.size > 1000) {
      // prune
      for (const n of Array.from(this.transactionNonces).slice(0, 500)) this.transactionNonces.delete(n);
    }
    return nonce;
  }

  async verifyWalletSignature(walletPubkey, signature, message) {
    try {
      const msg = Buffer.from(message, 'utf8');
      const sig = Buffer.from(signature, 'base64');
      const pub = new PublicKey(walletPubkey).toBytes();
      return nacl.sign.detached.verify(msg, sig, pub);
    } catch { return false; }
  }

  async writeOnChainRegistry({ alias, walletPubkey, linkedAt, signatureHash }) {
    // TODO: Replace with real program interaction; keep returned signature shape.
    const mockSig = crypto.randomBytes(32).toString('base64');
    console.log('⛓️ registry.write', { alias: alias.slice(0, 8) + '...', wallet: walletPubkey.slice(0, 8) + '...', linkedAt });
    return mockSig;
  }

  async registerUser(phoneNumber, pin) {
    const cleanPhone = normalizePhone(this.sanitizeInput(phoneNumber));
    const cleanPin = this.sanitizeInput(pin);

    if (!this.validatePhoneNumber(cleanPhone)) throw new Error('Invalid phone number format');
    if (!this.validatePin(cleanPin)) throw new Error('PIN must be 4-6 digits');

    await this.checkPinRateLimit(cleanPhone);

    // Derive PDA (acts as wallet address in dev-mode)
    const { pda, bump } = await this.getUserPDA(cleanPhone);
    const phoneHash = this.hashPhoneNumber(cleanPhone);

    // If already exists in registry with wallet, treat as duplicate
    const existing = await this.getWalletAddress(cleanPhone);
    if (existing) throw new Error('User already registered with this phone number');

    // Persist in registry immediately so downstream flows can resolve wallet
    userRegistry.registerUser(cleanPhone, {
      phoneHash: Buffer.from(phoneHash).toString('hex'),
      walletAddress: pda.toString(),
      walletType: 'new',
      registeredAt: Date.now(),
      cluster: this.cluster,
    });

    this.resetPinAttempts(cleanPhone);
    this.securityStats.registrationAttempts++;

    const res = {
      success: true,
      userPDA: pda.toString(),
      phoneHash: Buffer.from(phoneHash).toString('hex'),
      cluster: this.cluster,
      bump,
      nonce: this.generateTransactionNonce(),
      explorerUrl: this.getExplorerUrl(),
      timestamp: new Date().toISOString(),
      securityLevel: 'enhanced',
      version: '2.0.0',
    };

    console.log('✅ registerUser', { phone: maskPhone(cleanPhone), pda: res.userPDA.slice(0, 8) + '...' });
    return res;
  }

  async linkWallet(phoneNumber, pin, walletAddress, options = {}) {
    const cleanPhone = normalizePhone(this.sanitizeInput(phoneNumber));
    const cleanPin = this.sanitizeInput(pin);
    const cleanWallet = this.sanitizeInput(walletAddress);

    if (!this.validatePhoneNumber(cleanPhone)) return { success: false, error: 'Invalid phone number format' };
    if (!this.validatePin(cleanPin)) return { success: false, error: 'Invalid PIN format' };
    if (!SOL_ADDR_RE.test(cleanWallet)) return { success: false, error: 'Invalid Solana wallet address' };

    // Optional signature check
    if (options.signature && options.message) {
      const ok = await this.verifyWalletSignature(cleanWallet, options.signature, options.message);
      if (!ok) {
        // In production you might reject here
        console.warn('⚠️ Wallet signature invalid; continuing (dev mode)');
      }
    }

    // Disallow relinking if already registered with full data
    const already = await this.getWalletAddress(cleanPhone);
    if (already) return { success: false, error: 'Phone number already registered. Use *789*AMOUNT*PIN# to transact.' };

    const alias = this.generateAlias(cleanPhone);
    const txSig = await this.writeOnChainRegistry({
      alias,
      walletPubkey: cleanWallet,
      linkedAt: Date.now(),
      signatureHash: options.signature ? crypto.createHash('sha256').update(options.signature).digest('hex') : null,
    });

    // Persist in registry
    userRegistry.registerUser(cleanPhone, {
      walletAddress: cleanWallet,
      walletType: 'linked',
      alias,
      linkedAt: Date.now(),
      onChainTx: txSig,
      registeredAt: Date.now(),
      cluster: this.cluster,
    });

    this.securityStats.walletsLinked++;
    console.log('✅ linkWallet', { phone: maskPhone(cleanPhone), wallet: cleanWallet.slice(0, 8) + '...' });

    return { success: true, walletAddress: cleanWallet, alias, txSignature: txSig, message: 'Wallet linked successfully' };
  }

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  async createTransaction(phoneNumber, pin, amount, type = 'crypto') {
    const cleanPhone = normalizePhone(this.sanitizeInput(phoneNumber));
    const cleanPin = this.sanitizeInput(pin);

    if (!this.validatePhoneNumber(cleanPhone)) throw new Error('Invalid phone number format');
    if (!this.validatePin(cleanPin)) throw new Error('Invalid PIN format');
    if (!this.validateAmount(amount)) throw new Error('Invalid transaction amount');
    if (!['crypto', 'airtime'].includes(type)) throw new Error('Invalid transaction type');

    await this.checkPinRateLimit(cleanPhone);

    const exists = await this.userExists(cleanPhone);
    if (!exists) throw new Error('User not registered');

    // TODO: replace below with real charge + on-chain transfer / airtime call
    const txId = crypto.randomBytes(16).toString('hex');
    const nonce = this.generateTransactionNonce();

    this.resetPinAttempts(cleanPhone);
    this.securityStats.transactionAttempts++;

    return {
      success: true,
      transactionId: txId,
      signature: txId,
      amount: Number(amount),
      type,
      timestamp: Date.now(),
      nonce,
      explorerUrl: this.getExplorerUrl(txId),
      securityLevel: 'enhanced',
      version: '2.0.0',
    };
  }

  // -------------------------------------------------------------------------
  // Health / Analytics
  // -------------------------------------------------------------------------

  async healthCheck() {
    try {
      const version = await this.connection.getVersion();
      let pythStatus = 'disabled';
      let pythRateCheck = null;
      if (this.pythEnabled) {
        try {
          const r = await this.getBestRate();
          pythStatus = 'operational';
          pythRateCheck = { rate: r.rate, source: r.source, sources: r.allSources?.length || 0 };
        } catch (e) {
          pythStatus = 'error';
          pythRateCheck = { error: e.message };
        }
      }
      return {
        status: 'OK',
        cluster: this.cluster,
        rpcUrl: this.rpcUrl,
        programId: this.programIdString,
        solanaVersion: version['solana-core'],
        pythIntegration: { enabled: this.pythEnabled, status: pythStatus, network: this.pythNetwork, lastCheck: pythRateCheck },
        registeredUsers: userRegistry.getAll().length,
        timestamp: new Date().toISOString(),
        version: '2.0.0',
      };
    } catch (error) {
      return { status: 'ERROR', error: error.message, timestamp: new Date().toISOString() };
    }
  }

  getSecurityAnalytics() {
    return {
      securityStats: this.securityStats,
      activeRateLimits: this.pinAttempts.size,
      registeredUsers: userRegistry.getAll().length,
      timestamp: new Date().toISOString(),
      securityLevel: 'ENHANCED',
    };
  }
}

module.exports = new SolanaService();
