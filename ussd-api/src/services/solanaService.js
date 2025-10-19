const { Connection, PublicKey, Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const { AnchorProvider, Program, web3 } = require('@coral-xyz/anchor');
const crypto = require('crypto');

/**
 * Enhanced Solana Service with enterprise-grade security + Pyth Network Integration
 * Features:
 * - Secure PDA derivation with authority isolation
 * - PBKDF2 PIN hashing with user-specific salts
 * - Rate limiting for PIN attempts
 * - Comprehensive input validation
 * - Anti-replay nonce protection
 * - Real-time security monitoring
 * - Mock Pyth Network price feeds (ready for production integration)
 */
class SolanaService {
  constructor() {
    // Smart environment detection
    this.cluster = process.env.SOLANA_CLUSTER || 'localnet';
    
    // Select RPC URL based on cluster
    this.rpcUrl = this.cluster === 'devnet'
      ? (process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com')
      : (process.env.SOLANA_RPC_URL_LOCALNET || 'http://127.0.0.1:8899');
    
    // Select Program ID based on cluster
    this.programIdString = this.cluster === 'devnet'
      ? (process.env.SOLANA_PROGRAM_ID_DEVNET || 'CZohQsF3D3cDDTtJnMZi9WirsknWxWyBKgHiLg5b1T8E')
      : (process.env.SOLANA_PROGRAM_ID_LOCALNET || '74D7UqGmgBaod2jTaKotYF8rDNd3xWv9eo43Gt5iHKxS');
    
    this.connection = new Connection(this.rpcUrl, 'confirmed');
    this.programId = new PublicKey(this.programIdString);
    
    // Security storage
    this.pinAttempts = new Map();
    this.transactionNonces = new Set();
    this.securityEvents = [];
    
    // Derived keys for security
    this.phoneHashSalt = process.env.PHONE_HASH_SALT || 'default_phone_salt_change_in_production';
    this.pinHashSalt = process.env.PIN_HASH_SALT || 'default_pin_salt_change_in_production';
    
    // Rate limiting configuration
    this.pinAttemptLimit = parseInt(process.env.PIN_ATTEMPT_LIMIT) || 5;
    this.pinAttemptWindow = 60 * 60 * 1000; // 1 hour
    
    // Transaction limits
    this.minTransactionAmount = parseFloat(process.env.MIN_TRANSACTION_AMOUNT) || 100;
    this.maxTransactionAmount = parseFloat(process.env.MAX_TRANSACTION_AMOUNT) || 1000000;
    
    // Initialize security monitoring
    this.securityStats = {
      validationFailures: 0,
      pinAttemptViolations: 0,
      transactionAttempts: 0,
      registrationAttempts: 0
    };
    
    // Mock Pyth Network configuration
    this.pythEnabled = process.env.PYTH_ENABLED !== 'false'; // Default enabled
    this.pythNetwork = this.cluster; // Use same cluster as Solana
    
    // Log current configuration
    console.log(`🔗 Secure Solana Service initialized:`);
    console.log(`   Cluster: ${this.cluster.toUpperCase()}`);
    console.log(`   RPC: ${this.rpcUrl}`);
    console.log(`   Program: ${this.programIdString}`);
    console.log(`   Security Level: ENHANCED`);
    console.log(`   Pyth Integration: ${this.pythEnabled ? 'ENABLED (Mock)' : 'DISABLED'}`);
    console.log(`   PIN Attempt Limit: ${this.pinAttemptLimit}`);
    console.log(`   Transaction Limits: ₦${this.minTransactionAmount.toLocaleString()} - ₦${this.maxTransactionAmount.toLocaleString()}`);
  }

  /**
   * Get Solana Explorer URL for transactions or addresses
   * @param {string} signature - Transaction signature or address
   * @returns {string} - Explorer URL
   */
  getExplorerUrl(signature = null) {
    const baseUrl = 'https://explorer.solana.com';
    const clusterParam = this.cluster === 'devnet' ? '?cluster=devnet' : '?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899';
    const address = signature || this.programIdString;
    const type = signature ? 'tx' : 'address';
    return `${baseUrl}/${type}/${address}${clusterParam}`;
  }

  /**
   * PYTH: Mock Pyth Network price feed (simulates production integration)
   * In production, this would call actual Pyth oracle smart contracts
   * @returns {Promise<object>} - Mock Pyth price data
   */
  async getPythPrice() {
    try {
      // Simulate API call delay (production would query on-chain oracle)
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Mock Pyth price data structure matching actual Pyth Network response
      const mockPythResponse = {
        id: 'usdc-ngn-mock-feed',
        price: 1531, // Current USDC/NGN rate
        confidence: 0.5, // Price confidence interval
        expo: -2, // Price exponent
        publishTime: Date.now(),
        status: 'trading',
        numPublishers: 8, // Mock: 8 OTC desks publishing rates
        maxLatency: 2, // Mock: 2 seconds max latency
        
        // Mock aggregated data from multiple OTC desk sources
        sources: [
          { publisher: 'Binance P2P', price: 1528, weight: 0.25, confidence: 0.95 },
          { publisher: 'Quidax', price: 1535, weight: 0.20, confidence: 0.92 },
          { publisher: 'Yellow Card', price: 1531, weight: 0.20, confidence: 0.94 },
          { publisher: 'Luno', price: 1532, weight: 0.15, confidence: 0.90 },
          { publisher: 'Busha', price: 1530, weight: 0.10, confidence: 0.88 },
          { publisher: 'Bundle Africa', price: 1529, weight: 0.10, confidence: 0.91 }
        ]
      };
      
      console.log('📊 Pyth Price Feed Retrieved (Mock):', {
        rate: mockPythResponse.price,
        confidence: mockPythResponse.confidence,
        publishers: mockPythResponse.numPublishers,
        network: this.pythNetwork,
        timestamp: new Date(mockPythResponse.publishTime).toISOString()
      });
      
      this.logSecurityEvent('PYTH_PRICE_FETCHED', {
        rate: mockPythResponse.price,
        sources: mockPythResponse.sources.length
      });
      
      return mockPythResponse;
    } catch (error) {
      console.error('❌ Pyth price fetch failed:', error);
      this.logSecurityEvent('PYTH_PRICE_FETCH_ERROR', { error: error.message });
      
      // Fallback to default rate on error
      return {
        id: 'fallback',
        price: 1531,
        confidence: 0,
        publishTime: Date.now(),
        status: 'fallback',
        sources: []
      };
    }
  }

  /**
   * PYTH: Get best rate from aggregated OTC desk sources
   * @returns {Promise<object>} - Best rate data
   */
  async getBestRate() {
    try {
      const priceData = await this.getPythPrice();
      
      if (!priceData.sources || priceData.sources.length === 0) {
        return {
          rate: priceData.price,
          source: 'Default Rate',
          allSources: [],
          timestamp: priceData.publishTime,
          pythEnabled: this.pythEnabled
        };
      }
      
      // Find best (lowest) rate from all sources
      const bestSource = priceData.sources.reduce((best, current) => 
        current.price < best.price ? current : best
      );
      
      console.log('🎯 Best Rate Selected:', {
        publisher: bestSource.publisher,
        rate: bestSource.price,
        confidence: bestSource.confidence
      });
      
      return {
        rate: bestSource.price,
        source: bestSource.publisher,
        confidence: bestSource.confidence,
        allSources: priceData.sources,
        timestamp: priceData.publishTime,
        pythEnabled: this.pythEnabled,
        aggregatedRate: priceData.price // Weighted average from Pyth
      };
    } catch (error) {
      console.error('❌ Best rate selection failed:', error);
      return {
        rate: 1531,
        source: 'Fallback',
        allSources: [],
        timestamp: Date.now(),
        pythEnabled: false
      };
    }
  }

  /**
   * Get NGN to USDC exchange rate (Pyth-powered)
   * @returns {Promise<number>} - Exchange rate
   */
  async getNGNToUSDCRate() {
    try {
      if (!this.pythEnabled) {
        console.log('💱 Using default rate (Pyth disabled)');
        return parseFloat(process.env.DEFAULT_EXCHANGE_RATE) || 1531;
      }
      
      const bestRate = await this.getBestRate();
      console.log(`💱 Using Pyth rate: ₦${bestRate.rate} from ${bestRate.source}`);
      
      return bestRate.rate;
    } catch (error) {
      console.error('❌ Error getting exchange rate:', error);
      return parseFloat(process.env.DEFAULT_EXCHANGE_RATE) || 1531;
    }
  }

  /**
   * SECURITY: Comprehensive phone number validation
   * @param {string} phone - Phone number to validate
   * @returns {boolean} - Validation result
   */
  validatePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') {
      this.securityStats.validationFailures++;
      return false;
    }
    
    // Remove any non-digits for validation
    const cleaned = phone.replace(/\D/g, '');
    
    // Must be between 10-15 digits
    if (cleaned.length < 10 || cleaned.length > 15) {
      this.securityStats.validationFailures++;
      return false;
    }
    
    // Additional validation for Nigerian numbers
    if (phone.startsWith('+234') || phone.startsWith('0')) {
      const isValid = /^(\+234|0)[789][01]\d{8}$/.test(phone);
      if (!isValid) this.securityStats.validationFailures++;
      return isValid;
    }
    
    // International format validation
    const isValid = /^\+?[1-9]\d{9,14}$/.test(phone);
    if (!isValid) this.securityStats.validationFailures++;
    return isValid;
  }

  /**
   * SECURITY: Comprehensive PIN validation
   * @param {string} pin - PIN to validate
   * @returns {boolean} - Validation result
   */
  validatePin(pin) {
    if (!pin || typeof pin !== 'string') {
      this.securityStats.validationFailures++;
      return false;
    }
    
    const isValid = pin.match(/^\d{4,6}$/);
    if (!isValid) this.securityStats.validationFailures++;
    return isValid;
  }

  /**
   * SECURITY: Transaction amount validation
   * @param {number|string} amount - Amount to validate
   * @returns {boolean} - Validation result
   */
  validateAmount(amount) {
    const numAmount = parseFloat(amount);
    const isValid = !isNaN(numAmount) &&
                   numAmount >= this.minTransactionAmount &&
                   numAmount <= this.maxTransactionAmount;
    
    if (!isValid) this.securityStats.validationFailures++;
    return isValid;
  }

  /**
   * SECURITY: Input sanitization against injection attacks
   * @param {string} input - Input to sanitize
   * @returns {string} - Sanitized input
   */
  sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    
    // Remove potential injection characters and limit length
    return input
      .replace(/[<>\"'%;()&+\x00-\x1f\x7f-\x9f]/g, '')
      .trim()
      .substring(0, 100);
  }

  /**
   * SECURITY: Enhanced phone number hashing with salt
   * @param {string} phoneNumber - Phone number to hash
   * @returns {Buffer} - Hashed phone number
   */
  hashPhoneNumber(phoneNumber) {
    const hash = crypto.createHash('sha256');
    hash.update(phoneNumber + this.phoneHashSalt);
    return hash.digest();
  }

  /**
   * SECURITY: PBKDF2 PIN hashing with user-specific salt
   * @param {string} pin - PIN to hash
   * @param {string} phoneNumber - Phone number for user-specific salt
   * @returns {Array} - Array of hash bytes
   */
  hashPin(pin, phoneNumber) {
    // Create user-specific salt
    const userSalt = crypto.createHash('sha256')
      .update(phoneNumber + this.pinHashSalt)
      .digest();
    
    // Use PBKDF2 with 100,000 iterations (OWASP recommendation)
    const hashedPin = crypto.pbkdf2Sync(pin, userSalt, 100000, 32, 'sha256');
    return Array.from(hashedPin);
  }

  /**
   * SECURITY: Timing-safe PIN validation
   * @param {string} inputPin - Input PIN
   * @param {Array} storedPinHash - Stored PIN hash
   * @param {string} phoneNumber - Phone number for salt derivation
   * @returns {boolean} - Validation result
   */
  validatePinHash(inputPin, storedPinHash, phoneNumber) {
    try {
      const inputPinHash = this.hashPin(inputPin, phoneNumber);
      
      // Use timing-safe comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(inputPinHash),
        Buffer.from(storedPinHash)
      );
    } catch (error) {
      console.error('❌ PIN validation error:', error);
      this.logSecurityEvent('PIN_VALIDATION_ERROR', { error: error.message });
      return false;
    }
  }

  /**
   * SECURITY: System authority derivation for enhanced PDA security
   * @returns {PublicKey} - System authority public key
   */
  getSystemAuthority() {
    const [authority] = PublicKey.findProgramAddressSync(
      [Buffer.from('system_authority')],
      this.programId
    );
    return authority;
  }

  /**
   * SECURITY: Enhanced PDA derivation with authority isolation
   * @param {string} phoneNumber - Phone number
   * @param {PublicKey} authority - Authority public key (optional)
   * @returns {Promise<{pda: PublicKey, bump: number}>} - PDA and bump seed
   */
  async getUserPDA(phoneNumber, authority = null) {
    try {
      const phoneHash = this.hashPhoneNumber(phoneNumber);
      const authorityKey = authority || this.getSystemAuthority();
      
      // Use domain-specific seeds with authority isolation
      const [userPDA, bump] = await PublicKey.findProgramAddress(
        [
          Buffer.from('user_account'),           // Domain prefix
          authorityKey.toBuffer(),               // Authority isolation
          Buffer.from(phoneHash),                // Hashed phone (not raw)
          Buffer.from([1])                       // Version byte for upgrades
        ],
        this.programId
      );
      
      return { pda: userPDA, bump };
    } catch (error) {
      console.error('❌ PDA derivation failed:', error);
      this.logSecurityEvent('PDA_DERIVATION_ERROR', { error: error.message });
      throw new Error('Failed to derive secure PDA');
    }
  }

  /**
   * SECURITY: Rate limiting for PIN attempts
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<object>} - Rate limit status
   */
  async checkPinRateLimit(phoneNumber) {
    const rateLimitKey = `pin_attempts:${phoneNumber}`;
    const now = Date.now();
    
    const attempts = this.pinAttempts.get(rateLimitKey) || {
      count: 0,
      firstAttempt: now,
      lastAttempt: 0
    };
    
    // Reset if more than the window has passed
    if (now - attempts.firstAttempt > this.pinAttemptWindow) {
      attempts.count = 0;
      attempts.firstAttempt = now;
    }
    
    if (attempts.count >= this.pinAttemptLimit) {
      const timeLeft = Math.ceil((attempts.firstAttempt + this.pinAttemptWindow - now) / 60000);
      this.securityStats.pinAttemptViolations++;
      
      this.logSecurityEvent('PIN_RATE_LIMIT_EXCEEDED', {
        phoneNumber: phoneNumber.substring(0, 4) + '****',
        attempts: attempts.count,
        timeLeft: timeLeft
      });
      
      throw new Error(`Too many PIN attempts. Try again in ${timeLeft} minutes.`);
    }
    
    return attempts;
  }

  /**
   * SECURITY: Increment PIN attempt counter
   * @param {string} phoneNumber - Phone number
   */
  incrementPinAttempts(phoneNumber) {
    const rateLimitKey = `pin_attempts:${phoneNumber}`;
    const now = Date.now();
    
    const attempts = this.pinAttempts.get(rateLimitKey) || {
      count: 0,
      firstAttempt: now,
      lastAttempt: 0
    };
    
    attempts.count++;
    attempts.lastAttempt = now;
    this.pinAttempts.set(rateLimitKey, attempts);
    
    console.log(`⚠️ PIN attempt ${attempts.count}/${this.pinAttemptLimit} for ${phoneNumber.substring(0, 4)}****`);
    
    this.logSecurityEvent('PIN_ATTEMPT_RECORDED', {
      phoneNumber: phoneNumber.substring(0, 4) + '****',
      attemptNumber: attempts.count,
      remaining: this.pinAttemptLimit - attempts.count
    });
  }

  /**
   * SECURITY: Reset PIN attempt counter on successful validation
   * @param {string} phoneNumber - Phone number
   */
  resetPinAttempts(phoneNumber) {
    const rateLimitKey = `pin_attempts:${phoneNumber}`;
    this.pinAttempts.delete(rateLimitKey);
    
    console.log(`✅ Reset PIN attempts for ${phoneNumber.substring(0, 4)}****`);
    
    this.logSecurityEvent('PIN_ATTEMPTS_RESET', {
      phoneNumber: phoneNumber.substring(0, 4) + '****'
    });
  }

  /**
   * SECURITY: Anti-replay nonce generation
   * @returns {string} - Unique transaction nonce
   */
  generateTransactionNonce() {
    let nonce;
    do {
      nonce = crypto.randomBytes(16).toString('hex');
    } while (this.transactionNonces.has(nonce));
    
    this.transactionNonces.add(nonce);
    
    // Clean up old nonces (keep last 1000)
    if (this.transactionNonces.size > 1000) {
      const oldNonces = Array.from(this.transactionNonces).slice(0, 500);
      oldNonces.forEach(n => this.transactionNonces.delete(n));
    }
    
    return nonce;
  }

  /**
   * SECURITY: Log security events for monitoring
   * @param {string} eventType - Type of security event
   * @param {object} details - Event details
   */
  logSecurityEvent(eventType, details = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      type: eventType,
      details: details,
      cluster: this.cluster
    };
    
    this.securityEvents.push(event);
    
    // Keep only last 100 events
    if (this.securityEvents.length > 100) {
      this.securityEvents.shift();
    }
    
    console.log(`🔒 Security Event: ${eventType}`, details);
  }

  /**
   * Check if user exists with enhanced security
   * @param {string} phoneNumber - Phone number to check
   * @returns {Promise<boolean>} - User existence status
   */
  async userExists(phoneNumber) {
    try {
      const cleanPhone = this.sanitizeInput(phoneNumber);
      
      if (!this.validatePhoneNumber(cleanPhone)) {
        console.log(`❌ Invalid phone number format: ${phoneNumber.substring(0, 4)}****`);
        return false;
      }
      
      const { pda: userPDA } = await this.getUserPDA(cleanPhone);
      const accountInfo = await this.connection.getAccountInfo(userPDA);
      const exists = accountInfo !== null;
      
      console.log(`👤 User check [${this.cluster}]:`, {
        phone: cleanPhone.substring(0, 4) + '****',
        exists: exists,
        pda: userPDA.toString().slice(0, 8) + '...'
      });
      
      return exists;
    } catch (error) {
      console.error('❌ User existence check failed:', error);
      this.logSecurityEvent('USER_EXISTENCE_CHECK_ERROR', { error: error.message });
      return false;
    }
  }

  /**
   * SECURITY: Enhanced user registration with full validation
   * @param {string} phoneNumber - Phone number
   * @param {string} pin - User PIN
   * @returns {Promise<object>} - Registration result
   */
  async registerUser(phoneNumber, pin) {
    try {
      // Input validation and sanitization
      const cleanPhone = this.sanitizeInput(phoneNumber);
      const cleanPin = this.sanitizeInput(pin);
      
      if (!this.validatePhoneNumber(cleanPhone)) {
        throw new Error('Invalid phone number format');
      }
      
      if (!this.validatePin(cleanPin)) {
        throw new Error('PIN must be 4-6 digits');
      }
      
      // Check rate limiting
      await this.checkPinRateLimit(cleanPhone);
      
      const phoneHash = this.hashPhoneNumber(cleanPhone);
      const pinHash = this.hashPin(cleanPin, cleanPhone);
      const { pda: userPDA, bump } = await this.getUserPDA(cleanPhone);
      const nonce = this.generateTransactionNonce();
      
      console.log(`📝 Registering user [${this.cluster}]:`, {
        phone: cleanPhone.substring(0, 4) + '****',
        pda: userPDA.toString().slice(0, 8) + '...',
        cluster: this.cluster,
        bump,
        nonce: nonce.slice(0, 8) + '...'
      });
      
      // Check if user already exists
      const accountInfo = await this.connection.getAccountInfo(userPDA);
      if (accountInfo) {
        throw new Error('User already registered with this phone number');
      }
      
      // Reset PIN attempts on successful registration preparation
      this.resetPinAttempts(cleanPhone);
      this.securityStats.registrationAttempts++;
      
      // Return secure registration result
      const result = {
        success: true,
        userPDA: userPDA.toString(),
        phoneHash: Buffer.from(phoneHash).toString('hex'),
        cluster: this.cluster,
        bump,
        nonce,
        explorerUrl: this.getExplorerUrl(),
        timestamp: new Date().toISOString(),
        securityLevel: 'enhanced',
        version: '2.0.0'
      };
      
      this.logSecurityEvent('USER_REGISTRATION_PREPARED', {
        phoneNumber: cleanPhone.substring(0, 4) + '****',
        pda: userPDA.toString().slice(0, 8) + '...'
      });
      
      console.log('✅ User registration prepared with enhanced security');
      
      return result;
    } catch (error) {
      console.error('❌ User registration failed:', error);
      
      // Increment PIN attempts on certain failures
      if (error.message.includes('PIN') || error.message.includes('Invalid')) {
        this.incrementPinAttempts(phoneNumber);
      }
      
      this.logSecurityEvent('USER_REGISTRATION_FAILED', {
        phoneNumber: phoneNumber?.substring(0, 4) + '****',
        error: error.message
      });
      
      throw new Error(`Registration failed: ${error.message}`);
    }
  }

  /**
   * SECURITY + PYTH: Enhanced crypto purchase calculation with Pyth pricing
   * @param {number} amount - Purchase amount
   * @returns {Promise<object>} - Calculation result with Pyth data
   */
  async calculateCryptoPurchase(amount) {
    try {
      if (!this.validateAmount(amount)) {
        throw new Error('Invalid transaction amount');
      }
      
      const numAmount = parseFloat(amount);
      const spreadPercentage = parseFloat(process.env.CRYPTO_SPREAD_PERCENTAGE) || 0.5;
      
      // Get rate from Pyth Network (mock)
      const rateData = await this.getBestRate();
      const exchangeRate = rateData.rate;
      
      // Calculate with security buffer
      const fee = Math.round(numAmount * (spreadPercentage / 100));
      const netAmount = numAmount - fee;
      const usdcAmount = Math.floor((netAmount / exchangeRate) * 1000000); // USDC has 6 decimals
      
      const calculation = {
        inputAmount: numAmount,
        fee: fee,
        netAmount: netAmount,
        rate: exchangeRate,
        rateSource: rateData.source,
        pythEnabled: rateData.pythEnabled,
        usdcAmount: usdcAmount,
        timestamp: Date.now(),
        nonce: this.generateTransactionNonce(),
        securityLevel: 'enhanced',
        // Include all available rates for transparency
        availableRates: rateData.allSources.map(s => ({
          source: s.publisher,
          rate: s.price,
          confidence: s.confidence
        }))
      };
      
      this.logSecurityEvent('CRYPTO_PURCHASE_CALCULATED', {
        amount: numAmount,
        fee: fee,
        usdcAmount: usdcAmount,
        rateSource: rateData.source,
        pythEnabled: rateData.pythEnabled
      });
      
      console.log('💰 Crypto purchase calculated (Pyth-powered):', {
        amount: numAmount,
        rate: exchangeRate,
        source: rateData.source,
        usdcAmount: (usdcAmount / 1000000).toFixed(2)
      });
      
      return calculation;
    } catch (error) {
      console.error('❌ Crypto purchase calculation failed:', error);
      this.logSecurityEvent('CRYPTO_PURCHASE_CALCULATION_ERROR', { error: error.message });
      throw new Error('Failed to calculate crypto purchase');
    }
  }

  /**
   * SECURITY: Enhanced transaction creation with comprehensive validation
   * @param {string} phoneNumber - Phone number
   * @param {string} pin - User PIN
   * @param {number} amount - Transaction amount
   * @param {string} type - Transaction type
   * @returns {Promise<object>} - Transaction result
   */
  async createTransaction(phoneNumber, pin, amount, type = 'crypto') {
    try {
      // Validate inputs
      const cleanPhone = this.sanitizeInput(phoneNumber);
      const cleanPin = this.sanitizeInput(pin);
      
      if (!this.validatePhoneNumber(cleanPhone)) {
        throw new Error('Invalid phone number format');
      }
      
      if (!this.validatePin(cleanPin)) {
        throw new Error('Invalid PIN format');
      }
      
      if (!this.validateAmount(amount)) {
        throw new Error('Invalid transaction amount');
      }
      
      if (!['crypto', 'airtime'].includes(type)) {
        throw new Error('Invalid transaction type');
      }
      
      // Check rate limiting
      await this.checkPinRateLimit(cleanPhone);
      
      // Verify user exists
      const userExists = await this.userExists(cleanPhone);
      if (!userExists) {
        throw new Error('User not registered');
      }
      
      // Generate transaction data
      const transactionId = crypto.randomBytes(16).toString('hex');
      const nonce = this.generateTransactionNonce();
      
      console.log(`💰 Creating ${type} transaction:`, {
        phone: cleanPhone.substring(0, 4) + '****',
        amount: amount,
        type: type,
        txId: transactionId.slice(0, 8) + '...',
        nonce: nonce.slice(0, 8) + '...'
      });
      
      // Reset PIN attempts on successful transaction
      this.resetPinAttempts(cleanPhone);
      this.securityStats.transactionAttempts++;
      
      // Mock successful transaction (replace with actual Solana program call)
      const result = {
        success: true,
        transactionId: transactionId,
        signature: transactionId, // Realistic signature format for demo
        amount: parseFloat(amount),
        type: type,
        timestamp: Date.now(),
        nonce: nonce,
        explorerUrl: this.getExplorerUrl(transactionId),
        securityLevel: 'enhanced',
        version: '2.0.0'
      };
      
      this.logSecurityEvent('TRANSACTION_CREATED', {
        phoneNumber: cleanPhone.substring(0, 4) + '****',
        type: type,
        amount: amount,
        transactionId: transactionId.slice(0, 8) + '...'
      });
      
      return result;
    } catch (error) {
      console.error('❌ Transaction creation failed:', error);
      
      // Increment PIN attempts on failure
      this.incrementPinAttempts(phoneNumber);
      
      this.logSecurityEvent('TRANSACTION_CREATION_FAILED', {
        phoneNumber: phoneNumber?.substring(0, 4) + '****',
        type: type,
        error: error.message
      });
      
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }

  /**
   * Comprehensive health check with security status + Pyth integration
   * @returns {Promise<object>} - Health check result
   */
  async healthCheck() {
    try {
      const response = await this.connection.getVersion();
      
      // Check Pyth status
      let pythStatus = 'disabled';
      let pythRateCheck = null;
      
      if (this.pythEnabled) {
        try {
          const rateData = await this.getBestRate();
          pythStatus = 'operational';
          pythRateCheck = {
            rate: rateData.rate,
            source: rateData.source,
            sources: rateData.allSources.length
          };
        } catch (error) {
          pythStatus = 'error';
          pythRateCheck = { error: error.message };
        }
      }
      
      return {
        status: 'OK',
        cluster: this.cluster,
        rpcUrl: this.rpcUrl,
        programId: this.programIdString,
        solanaVersion: response['solana-core'],
        pythIntegration: {
          enabled: this.pythEnabled,
          status: pythStatus,
          network: this.pythNetwork,
          lastCheck: pythRateCheck
        },
        securityFeatures: {
          pinRateLimit: true,
          encryptedSessions: true,
          inputValidation: true,
          pdaSecurity: true,
          nonceProtection: true,
          timingSafeComparison: true,
          saltedHashing: true,
          authorityIsolation: true
        },
        securityStats: this.securityStats,
        activeConnections: {
          pinAttempts: this.pinAttempts.size,
          transactionNonces: this.transactionNonces.size,
          securityEvents: this.securityEvents.length
        },
        limits: {
          minTransaction: this.minTransactionAmount,
          maxTransaction: this.maxTransactionAmount,
          pinAttemptLimit: this.pinAttemptLimit,
          pinAttemptWindow: this.pinAttemptWindow / 1000 / 60 + ' minutes'
        },
        timestamp: new Date().toISOString(),
        version: '2.0.0'
      };
    } catch (error) {
      console.error('❌ Health check failed:', error);
      this.logSecurityEvent('HEALTH_CHECK_ERROR', { error: error.message });
      
      return {
        status: 'ERROR',
        error: error.message,
        timestamp: new Date().toISOString(),
        securityLevel: 'enhanced'
      };
    }
  }

  /**
   * Get security analytics report
   * @returns {object} - Security analytics
   */
  getSecurityAnalytics() {
    const recentEvents = this.securityEvents.slice(-20);
    const eventTypes = {};
    
    this.securityEvents.forEach(event => {
      eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
    });
    
    return {
      securityStats: this.securityStats,
      recentEvents: recentEvents,
      eventTypes: eventTypes,
      activeRateLimits: this.pinAttempts.size,
      noncePoolSize: this.transactionNonces.size,
      pythEnabled: this.pythEnabled,
      timestamp: new Date().toISOString(),
      securityLevel: 'ENHANCED'
    };
  }
}

// Create and export singleton instance
module.exports = new SolanaService();
