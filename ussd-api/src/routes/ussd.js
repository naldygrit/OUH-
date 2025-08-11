const express = require('express');
const router = express.Router();
const solanaService = require('../services/solanaService');

// In-memory session storage (for demo purposes)
const sessions = new Map();

// Utility functions
const normalizePhoneNumber = (phone) => {
  // Convert +234... to 0... format
  return phone.replace(/^\+234/, '0');
};

// Session cleanup (remove sessions older than 5 minutes)
const cleanupSessions = () => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minutes
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.createdAt > timeout) {
      console.log('🧹 Cleaning up expired session:', sessionId.slice(-8));
      sessions.delete(sessionId);
    }
  }
};

// Run cleanup every minute
setInterval(cleanupSessions, 60000);

// Start a new USSD session
router.post('/start', async (req, res) => {
  try {
    const { sessionId, phoneNumber } = req.body;
    console.log('🚀 USSD Start Request:', { sessionId: sessionId?.slice(-8), phoneNumber });

    // Validation
    if (!sessionId || !phoneNumber) {
      return res.status(400).json({
        error: 'Missing required fields: sessionId and phoneNumber'
      });
    }

    const displayNumber = normalizePhoneNumber(phoneNumber);

    // Route based on session ID pattern
    if (sessionId.includes('registration')) {
      console.log('📝 Starting REGISTRATION flow for:', displayNumber);
      
      // Check if user already exists on Solana
      const userExists = await solanaService.userExists(displayNumber);
      if (userExists) {
        return res.json({
          message: `Phone number ${displayNumber} is already registered!\n\nDial *789*AMOUNT# to make purchases.`,
          end: true
        });
      }

      const session = {
        sessionId,
        phoneNumber,
        displayNumber,
        flowType: 'registration',
        stage: 'wallet_type_selection',
        createdAt: Date.now(),
        attempts: 0
      };

      sessions.set(sessionId, session);

      res.json({
        message: `OUH! Welcome\nPhone: ${displayNumber}\n\n1. New Wallet (Basic phone)\n2. Link Existing (Smartphone)`,
        end: false,
        sessionId: sessionId
      });

    } else if (sessionId.includes('purchase')) {
      console.log('💰 Starting PURCHASE flow for:', displayNumber);
      
      // Check if user is registered on Solana
      const userExists = await solanaService.userExists(displayNumber);
      if (!userExists) {
        return res.json({
          message: `Phone number ${displayNumber} not registered.\nPlease dial *789# first to create your wallet.\n\nRegistration is free and takes 2 minutes.`,
          end: true
        });
      }

      // Extract amount from session ID
      const amountMatch = sessionId.match(/purchase_(\d+)_/);
      const amount = amountMatch ? parseInt(amountMatch[1]) : 0;

      if (amount <= 0 || amount < 100 || amount > 50000) {
        return res.status(400).json({
          error: 'Invalid purchase amount. Must be between N100 and N50,000.'
        });
      }

      const session = {
        sessionId,
        phoneNumber,
        displayNumber,
        flowType: 'purchase',
        stage: 'service_selection',
        amount: amount,
        createdAt: Date.now(),
        attempts: 0
      };

      sessions.set(sessionId, session);

      res.json({
        message: `Purchase Request\nAmount: N${amount.toLocaleString()}\nPhone: ${displayNumber}\n\n1. Load Wallet (USDC)\n2. Buy Airtime\n\nSelect service:`,
        end: false,
        sessionId: sessionId
      });

    } else {
      return res.status(400).json({
        error: 'Invalid session type. Must be registration or purchase.'
      });
    }
  } catch (error) {
    console.error('❌ Error in /start:', error);
    res.status(500).json({
      error: 'Failed to start USSD session'
    });
  }
});

// Continue an existing USSD session
router.post('/continue', async (req, res) => {
  try {
    const { sessionId, phoneNumber, text } = req.body;
    console.log('🔄 USSD Continue:', {
      sessionId: sessionId?.slice(-8),
      phoneNumber,
      text
    });

    // Validation
    if (!sessionId || !phoneNumber || text === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: sessionId, phoneNumber, and text'
      });
    }

    // Get session
    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({
        error: 'Session not found or expired'
      });
    }

    console.log('📋 Session State:', {
      flowType: session.flowType,
      stage: session.stage,
      attempts: session.attempts
    });

    let message = '';
    let end = false;

    if (session.flowType === 'registration') {
      // REGISTRATION FLOW LOGIC
      switch (session.stage) {
        case 'wallet_type_selection':
          if (text === '1') {
            console.log('📱 New Wallet selected');
            session.stage = 'new_wallet_confirm';
            session.walletType = 'new';
            message = `New Wallet Creation\nPhone: ${session.displayNumber}\n\n1. Confirm\n2. Change number`;
          } else if (text === '2') {
            console.log('🔗 Link Existing selected');
            session.stage = 'link_wallet_confirm';
            session.walletType = 'link';
            message = `Link Existing Wallet\nPhone: ${session.displayNumber}\n\n1. Confirm\n2. Change number`;
          } else {
            message = `Invalid option.\n\nOUH! Welcome\nPhone: ${session.displayNumber}\n\n1. New Wallet (Basic phone)\n2. Link Existing (Smartphone)`;
          }
          break;

        case 'new_wallet_confirm':
          if (text === '1') {
            session.stage = 'new_wallet_pin_setup';
            message = `Create 4-digit PIN for your wallet\nThis PIN will secure your transactions\n\nPIN:`;
          } else if (text === '2') {
            session.stage = 'new_wallet_change_number';
            message = `Enter Phone Number\nExample: 08031234567\n\nNumber:`;
          } else {
            message = `New Wallet Creation\nPhone: ${session.displayNumber}\n\n1. Confirm\n2. Change number`;
          }
          break;

        case 'new_wallet_change_number':
          if (text.length === 11 && text.match(/^0\d{10}$/)) {
            session.displayNumber = text;
            session.stage = 'new_wallet_confirm';
            message = `New Wallet Creation\nPhone: ${text}\n\n1. Confirm\n2. Change number`;
          } else {
            message = `Invalid phone number format.\nMust be 11 digits starting with 0\n\nEnter Phone Number:`;
          }
          break;

        case 'new_wallet_pin_setup':
          if (text.length === 4 && text.match(/^\d+$/)) {
            session.stage = 'new_wallet_pin_confirm';
            session.tempPin = text;
            message = `Re-enter your 4-digit PIN to confirm:\n\nPIN:`;
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many invalid attempts.\nRegistration cancelled.\n\nDial *789# to try again.`;
              end = true;
              sessions.delete(sessionId);
            } else {
              message = `PIN must be exactly 4 digits.\nCreate 4-digit PIN for your wallet\n\nPIN:`;
            }
          }
          break;

        case 'new_wallet_pin_confirm':
          if (text === session.tempPin) {
            console.log('🔗 Registering user on Solana blockchain...');
            
            // Register user on Solana
            const registrationResult = await solanaService.registerUser(
              session.displayNumber,
              session.tempPin
            );

            if (registrationResult.success) {
              console.log('🎉 NEW WALLET CREATED ON SOLANA');
              message = `SUCCESS!\n\nWallet created on Solana blockchain!\n${session.displayNumber} is now your wallet address.\n\nWallet PDA created on devnet.\n\nDial *789*AMOUNT# to purchase crypto.`;
            } else {
              console.error('❌ Solana registration failed:', registrationResult.error);
              message = `Registration failed:\n${registrationResult.error}\n\nPlease try again later.`;
            }
            
            end = true;
            sessions.delete(sessionId);
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 2) {
              message = `PIN mismatch limit reached.\nRegistration cancelled.\n\nDial *789# to try again.`;
              end = true;
              sessions.delete(sessionId);
            } else {
              message = `PINs do not match.\nRe-enter your 4-digit PIN:\n\nPIN:`;
            }
          }
          break;

        case 'link_wallet_confirm':
          if (text === '1') {
            session.stage = 'link_wallet_pin_setup';
            message = `Create 4-digit PIN to secure your linked wallet:\n\nPIN:`;
          } else if (text === '2') {
            session.stage = 'link_wallet_change_number';
            message = `Enter Phone Number\nExample: 08031234567\n\nNumber:`;
          } else {
            message = `Link Existing Wallet\nPhone: ${session.displayNumber}\n\n1. Confirm\n2. Change number`;
          }
          break;

        case 'link_wallet_change_number':
          if (text.length === 11 && text.match(/^0\d{10}$/)) {
            session.displayNumber = text;
            session.stage = 'link_wallet_confirm';
            message = `Link Existing Wallet\nPhone: ${text}\n\n1. Confirm\n2. Change number`;
          } else {
            message = `Invalid phone number format.\nEnter Phone Number\nExample: 08031234567\n\nNumber:`;
          }
          break;

        case 'link_wallet_pin_setup':
          if (text.length === 4 && text.match(/^\d+$/)) {
            session.stage = 'link_wallet_pin_confirm';
            session.tempPin = text;
            message = `Re-enter your 4-digit PIN to confirm:\n\nPIN:`;
          } else {
            message = `PIN must be exactly 4 digits.\nCreate 4-digit PIN to secure your linked wallet:\n\nPIN:`;
          }
          break;

        case 'link_wallet_pin_confirm':
          if (text === session.tempPin) {
            console.log('🔗 Linking existing wallet on Solana...');
            
            // Register linked wallet on Solana
            const linkResult = await solanaService.registerUser(
              session.displayNumber,
              session.tempPin
            );

            if (linkResult.success) {
              const linkToken = Math.random().toString(36).substring(2, 8).toUpperCase();
              session.stage = 'link_wallet_sms_sent';
              session.linkToken = linkToken;
              message = `SMS sent to ${session.displayNumber}!\n\nClick link to connect wallet:\nouh.app/link/${linkToken}\n\nWallet PDA created on devnet.\n\nPress any key when done.`;
            } else {
              message = `Wallet linking failed:\n${linkResult.error}\n\nPlease try again.`;
            }
          } else {
            message = `PINs do not match.\nRe-enter your 4-digit PIN:\n\nPIN:`;
          }
          break;

        case 'link_wallet_sms_sent':
          console.log('🎉 EXISTING WALLET LINKED ON SOLANA');
          message = `SUCCESS!\n\nWallet linked on Solana blockchain!\n${session.displayNumber} is now your wallet address.\n\nDial *789*AMOUNT# to purchase crypto.`;
          end = true;
          sessions.delete(sessionId);
          break;

        default:
          message = `Session expired.\nDial *789# to register.`;
          end = true;
          sessions.delete(sessionId);
      }

    } else if (session.flowType === 'purchase') {
      // PURCHASE FLOW LOGIC
      switch (session.stage) {
        case 'service_selection':
          if (text === '1') {
            console.log('💰 Load Wallet selected');
            
            // Calculate crypto purchase using Solana service
            const calculation = await solanaService.calculateCryptoPurchase(session.amount);
            
            session.stage = 'load_wallet_confirm';
            session.serviceType = 'wallet';
            session.calculation = calculation;
            
            message = `Load Crypto Wallet\n\nAmount: N${session.amount.toLocaleString()}\nFee: N${calculation.fee.toLocaleString()}\nYou get: ~${(calculation.usdcAmount / 1000000).toFixed(2)} USDC\nRate: N${calculation.rate}/USDC\n\n1. Confirm transaction\n0. Cancel`;
          } else if (text === '2') {
            console.log('📞 Airtime selected');
            session.stage = 'airtime_confirm';
            session.serviceType = 'airtime';
            message = `Buy Airtime\n\nAmount: N${session.amount.toLocaleString()}\nPhone: ${session.displayNumber}\nNo fees!\n\n1. Confirm transaction\n0. Cancel`;
          } else {
            message = `Invalid selection.\n\nPurchase Request\nAmount: N${session.amount.toLocaleString()}\n\n1. Load Wallet (USDC)\n2. Buy Airtime\n\nSelect service:`;
          }
          break;

        case 'load_wallet_confirm':
          if (text === '1') {
            session.stage = 'load_wallet_pin';
            message = `Enter your 4-digit PIN to confirm transaction:\n\nPIN:`;
          } else if (text === '0') {
            message = `Transaction cancelled.\nThank you for using OUH!`;
            end = true;
            sessions.delete(sessionId);
          } else {
            const calc = session.calculation;
            message = `Load Crypto Wallet\n\nAmount: N${session.amount.toLocaleString()}\nFee: N${calc.fee.toLocaleString()}\nYou get: ~${(calc.usdcAmount / 1000000).toFixed(2)} USDC\n\n1. Confirm transaction\n0. Cancel`;
          }
          break;

        case 'load_wallet_pin':
          if (text.length === 4 && text.match(/^\d+$/)) {
            console.log('🔗 Processing crypto transaction on Solana...');
            
            // Create transaction on Solana
            const txResult = await solanaService.createTransaction(
              session.displayNumber,
              'Crypto',
              session.amount,
              session.calculation.usdcAmount
            );

            if (txResult.success) {
              console.log('🎉 CRYPTO LOADED ON SOLANA');
              const usdcAmount = (session.calculation.usdcAmount / 1000000).toFixed(2);
              const txIdDisplay = txResult.txId ? txResult.txId.slice(0, 8) : 'pending';
              message = `SUCCESS!\n\nN${session.amount.toLocaleString()} → ${usdcAmount} USDC\nLoaded to: ${session.displayNumber}\n\nTransaction ID: ${txIdDisplay}...\n\nView on Solana Explorer for details.`;
            } else {
              message = `Transaction failed:\n${txResult.error}\n\nPlease try again.`;
            }
            
            end = true;
            sessions.delete(sessionId);
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many invalid PIN attempts.\nTransaction cancelled for security.\n\nDial *789*AMOUNT# to try again.`;
              end = true;
              sessions.delete(sessionId);
            } else {
              message = `PIN must be 4 digits.\nEnter your 4-digit PIN:\n\nPIN:`;
            }
          }
          break;

        case 'airtime_confirm':
          if (text === '1') {
            session.stage = 'airtime_pin';
            message = `Enter your 4-digit PIN to confirm airtime purchase:\n\nPIN:`;
          } else if (text === '0') {
            message = `Transaction cancelled.\nThank you for using OUH!`;
            end = true;
            sessions.delete(sessionId);
          } else {
            message = `Buy Airtime\n\nAmount: N${session.amount.toLocaleString()}\nPhone: ${session.displayNumber}\nNo fees!\n\n1. Confirm transaction\n0. Cancel`;
          }
          break;

        case 'airtime_pin':
          if (text.length === 4 && text.match(/^\d+$/)) {
            console.log('🔗 Processing airtime transaction on Solana...');
            
            // Create airtime transaction on Solana
            const airtimeResult = await solanaService.createTransaction(
              session.displayNumber,
              'Airtime',
              session.amount
            );

            if (airtimeResult.success) {
              console.log('🎉 AIRTIME PURCHASED ON SOLANA');
              const txIdDisplay = airtimeResult.txId ? airtimeResult.txId.slice(0, 8) : 'pending';
              message = `SUCCESS!\n\nN${session.amount.toLocaleString()} airtime loaded\nto ${session.displayNumber}\n\nTransaction ID: ${txIdDisplay}...\n\nBalance updated immediately.\nThank you for using OUH!`;
            } else {
              message = `Airtime purchase failed:\n${airtimeResult.error}\n\nPlease try again.`;
            }
            
            end = true;
            sessions.delete(sessionId);
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many invalid PIN attempts.\nTransaction cancelled for security.\n\nDial *789*AMOUNT# to try again.`;
              end = true;
              sessions.delete(sessionId);
            } else {
              message = `PIN must be 4 digits.\nEnter your 4-digit PIN:\n\nPIN:`;
            }
          }
          break;

        default:
          message = `Session expired.\nDial *789*AMOUNT# to try again.`;
          end = true;
          sessions.delete(sessionId);
      }
    }

    // Update session if not ending
    if (!end) {
      sessions.set(sessionId, session);
    }

    res.json({ message, end });

  } catch (error) {
    console.error('❌ Error in /continue:', error);
    res.status(500).json({
      error: 'Failed to continue USSD session'
    });
  }
});

// End a USSD session
router.post('/end', (req, res) => {
  try {
    const { sessionId } = req.body;
    console.log('🔚 USSD End:', sessionId?.slice(-8));

    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
      console.log('✅ Session cleaned up');
    }

    res.json({
      message: 'Session ended',
      end: true
    });
  } catch (error) {
    console.error('❌ Error in /end:', error);
    res.status(500).json({
      error: 'Failed to end session'
    });
  }
});

// Debug endpoint to view active sessions
router.get('/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([id, session]) => ({
    id: id.slice(-8),
    flowType: session.flowType,
    stage: session.stage,
    displayNumber: session.displayNumber,
    createdAt: new Date(session.createdAt).toISOString(),
    ageMinutes: Math.floor((Date.now() - session.createdAt) / 60000)
  }));

  res.json({
    totalSessions: sessions.size,
    sessions: sessionList
  });
});

// Health check for Solana connection
router.get('/health/solana', async (req, res) => {
  try {
    const health = await solanaService.healthCheck();
    res.json({
      solana: 'OK',
      connection: health.connected,
      programId: health.programId,
      cluster: health.cluster
    });
  } catch (error) {
    res.status(500).json({
      solana: 'FAIL',
      error: error.message
    });
  }
});

module.exports = router;
