const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const solanaService = require('../services/solanaService');
const userRegistry = require('../services/userRegistry');
const { pinLimiter, registrationLimiter } = require('../middleware/rateLimiter');

/**
 * USSD Router (wired to canonical services)
 * - Normalizes phone numbers
 * - Persists on registration/linking
 * - Defensive wallet lookup on confirm
 * - Messages kept ≤160 chars where possible
 */

// Utils
const normalizePhone = (p) => String(p || '').replace(/^\+234/, '0');
const short = (s) => (s ? `${s.slice(0, 6)}...${s.slice(-4)}` : '');

function validateUssdLength(message, maxLength = 160) {
  if ((message || '').length > maxLength) {
    console.warn(`⚠️ USSD message exceeds limit: ${(message || '').length}/${maxLength}`);
    return false;
  }
  return true;
}

function handleSecureError(error, res, sessionId = null, sessionManager = null) {
  console.error('USSD Error:', { message: error.message, at: new Date().toISOString() });
  if (sessionId && sessionManager) sessionManager.destroySession(sessionId);
  const isSecurity = /(rate limit|attempts|blocked|invalid|expired)/i.test(error.message || '');
  res.status(isSecurity ? 429 : 500).json({ error: isSecurity ? error.message : 'Service temporarily unavailable', end: true, timestamp: new Date().toISOString() });
}

function validateSession(req, sessionId, expectedNonce = null) {
  if (!req.sessionManager) throw new Error('Session manager not available');
  const session = req.sessionManager.getSession(sessionId, expectedNonce);
  if (!session) throw new Error('Invalid or expired session');
  return session;
}

// -----------------------------------------------------------------------------
// START
// -----------------------------------------------------------------------------
router.post('/start', registrationLimiter, async (req, res) => {
  try {
    const { sessionId, phoneNumber, deviceType } = req.body;
    if (!sessionId || !phoneNumber) return res.status(400).json({ error: 'Missing sessionId or phoneNumber', timestamp: new Date().toISOString() });

    const displayNumber = normalizePhone(phoneNumber);

    // Registration flow
    if (sessionId.includes('registration')) {
      const exists = await solanaService.userExists(displayNumber);
      if (exists) {
        return res.json({ message: `✅ ${displayNumber.slice(0,4)}**** registered\nDial *789*AMOUNT# to transact`, end: true, timestamp: new Date().toISOString() });
      }

      const nonce = req.sessionManager.createSession(sessionId, displayNumber, {
        flowType: 'registration', stage: 'wallet_type_selection', deviceType: deviceType || 'basic', attempts: 0, createdAt: Date.now()
      });

      const message = `OUH! Welcome\nPhone: ${displayNumber}\n1. New Wallet (Any phone)\n2. Link Wallet (Smartphone)`;
      validateUssdLength(message);
      return res.json({ message, end: false, sessionId, nonce, timestamp: new Date().toISOString() });
    }

    // Purchase flow
    if (sessionId.includes('purchase')) {
      // Fast existence check; defensive later too
      const exists = await solanaService.userExists(displayNumber);
      if (!exists) return res.json({ message: `Not registered\nDial *789# to create wallet`, end: true, timestamp: new Date().toISOString() });

      const purchaseData = sessionId.replace('purchase_', '');
      const parts = purchaseData.split('_');
      const actualParts = parts.slice(0, -1); // last part is nonce stub from dialer

      let amount, pin, recipient, pattern;
      if (actualParts.length === 3 && actualParts[0].length === 11) {
        pattern = 'send_to_other';
        recipient = actualParts[0];
        amount = parseInt(actualParts[1]);
        pin = actualParts[2];
      } else if (actualParts.length === 2 && actualParts[0].length <= 6) {
        pattern = 'buy_for_self';
        recipient = displayNumber;
        amount = parseInt(actualParts[0]);
        pin = actualParts[1];
      } else if (actualParts.length === 1) {
        pattern = 'fallback';
        amount = parseInt(actualParts[0]);
        recipient = displayNumber;
        pin = null;
      } else {
        return res.status(400).json({ error: 'Invalid purchase format', timestamp: new Date().toISOString() });
      }

      if (!solanaService.validateAmount(amount)) {
        return res.json({ message: `Invalid amount: ₦${Number(amount).toLocaleString()}\nRange: ₦100-₦1M`, end: true, timestamp: new Date().toISOString() });
      }

      if (pattern !== 'fallback' && pin) {
        try {
          await solanaService.checkPinRateLimit(displayNumber);
          if (!solanaService.validatePin(pin)) {
            solanaService.incrementPinAttempts(displayNumber);
            return res.json({ message: `Invalid PIN format\nMust be 4-6 digits`, end: true, timestamp: new Date().toISOString() });
          }
          solanaService.resetPinAttempts(displayNumber);
        } catch (e) {
          return res.json({ message: `${e.message}\nTry again later`, end: true, timestamp: new Date().toISOString() });
        }
      }

      const sessionNonce = req.sessionManager.createSession(sessionId, displayNumber, {
        flowType: 'purchase', stage: pattern === 'fallback' ? 'service_selection' : 'service_selection_verified', pattern, amount, recipient, pin, pinVerified: pattern !== 'fallback', attempts: 0, createdAt: Date.now()
      });

      const header = `₦${Number(amount).toLocaleString()}`;
      const dest = pattern === 'send_to_other' ? `To: ${recipient}` : `To: ${recipient} (You)`;
      const message = `${header}\n${dest}\n\n1. Load Wallet (USDC)\n2. Buy Airtime`;
      validateUssdLength(message);
      return res.json({ message, end: false, sessionId, nonce: sessionNonce, timestamp: new Date().toISOString() });
    }

    return res.status(400).json({ error: 'Invalid session type. Use "registration_" or "purchase_" prefix.', timestamp: new Date().toISOString() });
  } catch (error) {
    handleSecureError(error, res);
  }
});

// -----------------------------------------------------------------------------
// CONTINUE
// -----------------------------------------------------------------------------
router.post('/continue', pinLimiter, async (req, res) => {
  try {
    const { sessionId, phoneNumber, text } = req.body;
    if (!sessionId || !phoneNumber || typeof text === 'undefined') return res.status(400).json({ error: 'Missing fields', timestamp: new Date().toISOString() });

    const session = validateSession(req, sessionId);
    const displayNumber = normalizePhone(phoneNumber);

    let message = ''; let end = false;

    if (session.flowType === 'registration') {
      switch (session.stage) {
        case 'wallet_type_selection':
          if (text === '1') { session.stage = 'new_wallet_pin_setup'; session.walletType = 'new'; message = `Create PIN (4-6 digits)\nPIN:`; }
          else if (text === '2') {
            if (session.deviceType === 'smartphone') { session.stage = 'link_wallet_pin_setup'; session.walletType = 'existing'; message = `Create PIN (4-6 digits)\nPIN:`; }
            else { message = `Wallet linking needs smartphone\nUse option 1 or dial on Android`; end = true; }
          } else { message = `Invalid option\n\nOUH! Welcome\nPhone: ${displayNumber}\n1. New Wallet\n2. Link Wallet`; }
          break;

        case 'new_wallet_pin_setup':
          if (/^\d{4,6}$/.test(text)) { session.stage = 'new_wallet_pin_confirm'; session.tempPin = text; message = `Re-enter your PIN (${text.length}):\nPIN:`; }
          else { session.attempts = (session.attempts || 0) + 1; if (session.attempts >= 3) { message = `Too many invalid attempts\nCancelled\nDial *789#`; end = true; req.sessionManager.destroySession(sessionId); } else { message = `PIN must be 4-6 digits\nCreate PIN:`; } }
          break;

        case 'new_wallet_pin_confirm':
          if (text === session.tempPin) {
            const reg = await solanaService.registerUser(displayNumber, session.tempPin);
            if (reg.success) {
              // ✅ Persist to registry (idempotent, but ensures cache)
              userRegistry.upsert(displayNumber, { walletAddress: reg.userPDA, registeredAt: Date.now(), phone: displayNumber });
              const shortWallet = short(reg.userPDA);
              message = `SUCCESS!\nWallet Created\n${displayNumber} linked to\n${shortWallet}\n\nDial *789*AMOUNT*PIN# to purchase`;
            } else {
              message = `Registration failed\nPlease try later`;
            }
            end = true; req.sessionManager.destroySession(sessionId);
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 2) { message = `PIN mismatch limit\nCancelled\nDial *789#`; end = true; req.sessionManager.destroySession(sessionId); }
            else { message = `PINs do not match\nRe-enter PIN:`; }
          }
          break;

        case 'link_wallet_pin_setup':
          if (/^\d{4,6}$/.test(text)) { session.stage = 'link_wallet_pin_confirm'; session.tempPin = text; message = `Re-enter your PIN (${text.length}):\nPIN:`; }
          else { session.attempts = (session.attempts || 0) + 1; if (session.attempts >= 3) { message = `Too many invalid attempts\nCancelled\nDial *789#`; end = true; req.sessionManager.destroySession(sessionId); } else { message = `PIN must be 4-6 digits\nCreate PIN:`; } }
          break;

        case 'link_wallet_pin_confirm':
          if (text === session.tempPin) {
            const connectionId = crypto.randomBytes(8).toString('hex');
            global.walletConnections = global.walletConnections || {};
            global.walletConnections[connectionId] = { sessionId, phoneNumber: displayNumber, pin: session.tempPin, status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600000 };
            setTimeout(() => { if (global.walletConnections[connectionId]?.status === 'pending') delete global.walletConnections[connectionId]; }, 600000);
            message = `✅ PIN Confirmed!\nOpening wallet...\n[WALLET_CONNECT:${connectionId}]`;
            end = true; req.sessionManager.destroySession(sessionId);
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 2) { message = `PIN mismatch limit\nCancelled\nDial *789#`; end = true; req.sessionManager.destroySession(sessionId); }
            else { message = `PINs do not match\nRe-enter PIN:`; }
          }
          break;

        default:
          message = `Session error\nDial *789#`; end = true; req.sessionManager.destroySession(sessionId);
      }

      if (!end) req.sessionManager.updateSession(sessionId, session);
    }

    else if (session.flowType === 'purchase') {
      switch (session.stage) {
        case 'service_selection':
        case 'service_selection_verified':
          if (text === '1') {
            const rate = await solanaService.getBestRate();
            const fee = 50; // ₦50 fixed
            const total = Number(session.amount) + fee;
            const usdc = (Number(session.amount) / rate.rate).toFixed(2);
            Object.assign(session, { stage: session.pinVerified ? 'confirm_purchase' : 'enter_pin', service: 'load_wallet', exchangeRate: rate.rate, rateSource: rate.source, transactionFee: fee, totalAmount: total, usdcAmount: usdc });
            message = session.pinVerified
              ? `₦${Number(session.amount).toLocaleString()} → ${usdc} USDC\nFee: ₦${fee}\nBest: ₦${Math.round(rate.rate).toLocaleString()}/$ (${rate.source})\n\n1. Confirm\n2. Cancel`
              : `Load ₦${Number(session.amount).toLocaleString()} USDC\nEnter PIN (4-6):\nPIN:`;
          } else if (text === '2') {
            session.stage = session.pinVerified ? 'confirm_purchase' : 'enter_pin';
            session.service = 'airtime';
            message = session.pinVerified
              ? `Buy ₦${Number(session.amount).toLocaleString()} Airtime\nTo: ${session.recipient}\n\n1. Confirm\n2. Cancel`
              : `Buy ₦${Number(session.amount).toLocaleString()} Airtime\nEnter PIN (4-6):\nPIN:`;
          } else {
            message = `Invalid option\n\n₦${Number(session.amount).toLocaleString()}\n1. Load Wallet (USDC)\n2. Buy Airtime`;
          }
          break;

        case 'enter_pin':
          if (/^\d{4,6}$/.test(text)) {
            try {
              await solanaService.checkPinRateLimit(displayNumber);
              solanaService.resetPinAttempts(displayNumber);
              session.stage = 'confirm_purchase';
              session.pin = text;
              message = session.service === 'load_wallet'
                ? `₦${Number(session.amount).toLocaleString()} → ${session.usdcAmount} USDC\nRate: ₦${Math.round(session.exchangeRate).toLocaleString()}/$ (${session.rateSource})\n\n1. Confirm\n2. Cancel`
                : `Buy ₦${Number(session.amount).toLocaleString()} Airtime\nTo: ${session.recipient}\n\n1. Confirm\n2. Cancel`;
            } catch (e) {
              message = `${e.message}\nTry again later`; end = true; req.sessionManager.destroySession(sessionId);
            }
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) { message = `Too many invalid PIN attempts\nCancelled`; end = true; req.sessionManager.destroySession(sessionId); }
            else { message = `PIN must be 4-6 digits\nEnter PIN:`; }
          }
          break;

        case 'confirm_purchase':
          if (text === '1') {
            try {
              // 🔐 Defensive resolution and caching
              let data = userRegistry.getUserData(displayNumber);
              if (!data?.walletAddress) {
                const fetched = await solanaService.getWalletAddress(displayNumber);
                if (fetched) {
                  userRegistry.upsert(displayNumber, { walletAddress: fetched, refreshedAt: Date.now(), phone: displayNumber });
                  data = { walletAddress: fetched };
                }
              }

              if (!data?.walletAddress) {
                message = `Wallet not found\nPlease register first\nDial *789#`;
                end = true; req.sessionManager.destroySession(sessionId); break;
              }

              const tx = await solanaService.createTransaction(
                displayNumber,
                session.pin || '0000',
                session.service === 'load_wallet' ? (session.totalAmount || session.amount) : session.amount,
                session.service === 'load_wallet' ? 'crypto' : 'airtime'
              );

              if (tx.success) {
                const w = data.walletAddress;
                const shortSig = (tx.signature || '').slice(0, 8);
                if (session.service === 'load_wallet') {
                  message = `✅ Success!\nCharged: ₦${Number(session.totalAmount || session.amount).toLocaleString()}\n${session.usdcAmount} USDC loaded\nWallet: ${short(w)}\nTx: ${shortSig}...`;
                } else {
                  message = `✅ Success!\n₦${Number(session.amount).toLocaleString()} Airtime sent\nTo: ${session.recipient}\nTx: ${shortSig}...`;
                }
              } else {
                message = `❌ Transaction failed\n${tx.error || 'Unknown error'}\n\nPlease try again`;
              }

              end = true; req.sessionManager.destroySession(sessionId);
            } catch (e) {
              message = `❌ Transaction failed\n${e.message}\n\nPlease try again`;
              end = true; req.sessionManager.destroySession(sessionId);
            }
          } else if (text === '2') {
            message = `Transaction cancelled\n\nDial *789*AMOUNT*PIN# to try again`;
            end = true; req.sessionManager.destroySession(sessionId);
          } else {
            message = `Invalid option\n\n1. Confirm\n2. Cancel`;
          }
          break;

        default:
          message = `Session error\nPlease try again`; end = true; req.sessionManager.destroySession(sessionId);
      }

      if (!end) req.sessionManager.updateSession(sessionId, session);
    }

    res.json({ message, end, sessionId, timestamp: new Date().toISOString() });
  } catch (error) {
    handleSecureError(error, res, req.body.sessionId, req.sessionManager);
  }
});

// -----------------------------------------------------------------------------
// WALLET CALLBACK — persist + respond with short wallet
// -----------------------------------------------------------------------------
router.post('/wallet/callback', async (req, res) => {
  try {
    const { connectionId, walletAddress, signature, message } = req.body;
    if (!connectionId || !walletAddress) return res.status(400).json({ success: false, error: 'Missing connectionId or walletAddress' });

    const connection = global.walletConnections?.[connectionId];
    if (!connection) return res.status(404).json({ success: false, error: 'Connection not found or expired' });
    if (connection.status === 'connected') return res.json({ success: true, message: 'Wallet already linked', phone: connection.phoneNumber, walletAddress: connection.walletAddress });
    if (Date.now() > connection.expiresAt) { delete global.walletConnections[connectionId]; return res.status(410).json({ success: false, error: 'Connection expired. Dial *789# again.' }); }

    const link = await solanaService.linkWallet(connection.phoneNumber, connection.pin, walletAddress, { signature, message });
    if (!link.success) return res.status(400).json({ success: false, error: link.error });

    connection.status = 'connected';
    connection.walletAddress = walletAddress;
    connection.connectedAt = Date.now();

    // ✅ Persist in registry for future purchase lookups
    userRegistry.upsert(connection.phoneNumber, { walletAddress, linkedAt: Date.now(), phone: connection.phoneNumber });

    const shortWallet = `${walletAddress.slice(0,4)}...${walletAddress.slice(-4)}`;
    res.json({ success: true, message: `SUCCESS!\nWallet Linked\n${connection.phoneNumber} linked to\n${shortWallet}\n\nDial *789*AMOUNT*PIN# to purchase`, phone: connection.phoneNumber, phoneNumber: connection.phoneNumber, walletAddress, timestamp: new Date().toISOString() });

    setTimeout(() => { delete global.walletConnections[connectionId]; }, 5 * 60 * 1000);
  } catch (error) {
    console.error('❌ Wallet callback error:', error);
    res.status(500).json({ success: false, error: 'Failed to process wallet connection', details: error.message });
  }
});

// -----------------------------------------------------------------------------
// END
// -----------------------------------------------------------------------------
router.post('/end', (req, res) => {
  try {
    const { sessionId } = req.body;
    if (sessionId && req.sessionManager) req.sessionManager.destroySession(sessionId);
    res.json({ message: 'Session ended', end: true, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to end session', timestamp: new Date().toISOString() });
  }
});

module.exports = router;
