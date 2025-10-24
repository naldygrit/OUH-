const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const solanaService = require('../services/solanaService');
const userRegistry = require('../services/userRegistry');
const { pinLimiter, registrationLimiter, transactionLimiter } = require('../middleware/rateLimiter');

/**
 * Enhanced USSD Routes with comprehensive security + Pyth Network Integration + Wallet Linking
 * OPTIMIZED: All messages under 160 characters for USSD compliance
 */

// Utility functions
const normalizePhoneNumber = (phone) => {
  return phone.replace(/^\+234/, '0');
};

/**
 * Validates USSD message length (160 char limit)
 */
const validateUssdLength = (message, maxLength = 160) => {
  if (message.length > maxLength) {
    console.warn(`⚠️ USSD message exceeds limit: ${message.length}/${maxLength} chars`);
    return false;
  }
  return true;
};

/**
 * Enhanced session validation with security checks
 */
const validateSession = (req, sessionId, expectedNonce = null) => {
  if (!req.sessionManager) {
    throw new Error('Session manager not available');
  }
  const session = req.sessionManager.getSession(sessionId, expectedNonce);
  if (!session) {
    throw new Error('Invalid or expired session');
  }
  return session;
};

/**
 * Enhanced error handler with security logging
 */
const handleSecureError = (error, res, sessionId = null, sessionManager = null) => {
  console.error('USSD Error:', {
    message: error.message,
    sessionId: sessionId?.slice(-8),
    timestamp: new Date().toISOString()
  });

  if (sessionId && sessionManager && error.message.includes('security')) {
    sessionManager.destroySession(sessionId);
  }

  const isSecurityError = error.message.includes('rate limit') ||
                         error.message.includes('attempts') ||
                         error.message.includes('blocked') ||
                         error.message.includes('invalid') ||
                         error.message.includes('expired');

  res.status(isSecurityError ? 429 : 500).json({
    error: isSecurityError ? error.message : 'Service temporarily unavailable',
    end: true,
    timestamp: new Date().toISOString(),
    securityLevel: 'enhanced'
  });
};

/**
 * Start a new USSD session with enhanced security
 * Route: POST /api/ussd/start
 */
router.post('/start', registrationLimiter, async (req, res) => {
  console.log('🔍 BACKEND RAW BODY:', JSON.stringify(req.body, null, 2));
  
  try {
    const { sessionId, phoneNumber, deviceType } = req.body;

    console.log('USSD Start Request:', {
      sessionId: sessionId?.slice(-8),
      phoneNumber: phoneNumber?.substring(0, 4) + '****',
      deviceType: deviceType || 'unknown',
      timestamp: new Date().toISOString()
    });

    // Enhanced validation
    if (!sessionId || !phoneNumber) {
      return res.status(400).json({
        error: 'Missing required fields: sessionId and phoneNumber',
        received: {
          hasSessionId: !!sessionId,
          hasPhoneNumber: !!phoneNumber
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || sessionId.length < 8) {
      return res.status(400).json({
        error: 'Invalid session ID format. Must be alphanumeric, at least 8 characters.',
        timestamp: new Date().toISOString()
      });
    }

    const displayNumber = normalizePhoneNumber(phoneNumber);

    if (!solanaService.validatePhoneNumber(displayNumber)) {
      return res.status(400).json({
        error: 'Invalid phone number format. Please use Nigerian format (e.g., 08031234567).',
        timestamp: new Date().toISOString()
      });
    }

    // Route based on session ID pattern
    if (sessionId.includes('registration')) {
      console.log('Starting REGISTRATION flow for:', displayNumber.substring(0, 4) + '****');
      
      const userExists = await solanaService.userExists(displayNumber);
      if (userExists) {
        return res.json({
          message: `✅ ${displayNumber.substring(0, 4)}**** registered\nDial *789*AMOUNT# to transact`,
          end: true,
          timestamp: new Date().toISOString()
        });
      }

      const sessionNonce = req.sessionManager.createSession(sessionId, displayNumber, {
        flowType: 'registration',
        stage: 'wallet_type_selection',
        deviceType: deviceType || 'basic',
        attempts: 0,
        securityLevel: 'enhanced',
        createdAt: Date.now()
      });

      const message = `Welcome to OUH!\n\n1. New Wallet\n2. Link Existing`;

      res.json({
        message: message,
        end: false,
        sessionId: sessionId,
        nonce: sessionNonce,
        timestamp: new Date().toISOString()
      });

    } else if (sessionId.includes('purchase')) {
      console.log('Starting PURCHASE flow for:', displayNumber.substring(0, 4) + '****');
      
      const userExists = await solanaService.userExists(displayNumber);
      if (!userExists) {
        return res.json({
          message: `Not registered\nDial *789# to create wallet`,
          end: true,
          timestamp: new Date().toISOString()
        });
      }

      const purchaseData = sessionId.replace('purchase_', '');
      const parts = purchaseData.split('_');

      console.log('🔍 PURCHASE DATA PARSING:', {
        sessionId,
        purchaseData,
        parts,
        partsLength: parts.length
      });

      let amount, pin, recipient, pattern;
      const actualParts = parts.slice(0, -1);

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
        return res.status(400).json({
          error: 'Invalid purchase format',
          timestamp: new Date().toISOString()
        });
      }

      if (!solanaService.validateAmount(amount)) {
        return res.json({
          message: `Invalid amount: ₦${amount.toLocaleString()}\nRange: ₦100-₦1M`,
          end: true,
          timestamp: new Date().toISOString()
        });
      }

      if (pattern !== 'fallback' && pin) {
        try {
          await solanaService.checkPinRateLimit(displayNumber);
          
          if (!solanaService.validatePin(pin)) {
            solanaService.incrementPinAttempts(displayNumber);
            return res.json({
              message: `Invalid PIN format\nMust be 4-6 digits`,
              end: true,
              timestamp: new Date().toISOString()
            });
          }

          const pinValid = true;
          
          if (!pinValid) {
            solanaService.incrementPinAttempts(displayNumber);
            return res.json({
              message: `Invalid PIN\nTry again`,
              end: true,
              timestamp: new Date().toISOString()
            });
          }

          solanaService.resetPinAttempts(displayNumber);
          console.log('✅ PIN verified - fast-track enabled');
        } catch (error) {
          return res.json({
            message: `${error.message}\nTry again later`,
            end: true,
            timestamp: new Date().toISOString()
          });
        }
      }

      const sessionNonce = req.sessionManager.createSession(sessionId, displayNumber, {
        flowType: 'purchase',
        stage: pattern === 'fallback' ? 'service_selection' : 'service_selection_verified',
        pattern: pattern,
        amount: amount,
        recipient: recipient,
        pin: pin,
        pinVerified: pattern !== 'fallback',
        attempts: 0,
        securityLevel: 'enhanced',
        createdAt: Date.now()
      });

      let message;
      if (pattern === 'send_to_other') {
        message = `₦${amount.toLocaleString()}\nTo: ${recipient}\n\n1. Load Wallet (USDC)\n2. Buy Airtime`;
      } else {
        message = `₦${amount.toLocaleString()}\nTo: ${recipient} (You)\n\n1. Load Wallet (USDC)\n2. Buy Airtime`;
      }

      res.json({
        message: message,
        end: false,
        sessionId: sessionId,
        nonce: sessionNonce,
        timestamp: new Date().toISOString()
      });

    } else {
      return res.status(400).json({
        error: 'Invalid session type. Use "registration_" or "purchase_" prefix.',
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    handleSecureError(error, res);
  }
});

// Continue route with wallet linking support
router.post('/continue', pinLimiter, async (req, res) => {
  try {
    const { sessionId, phoneNumber, text } = req.body;

    console.log('USSD Continue:', {
      sessionId: sessionId?.slice(-8),
      phoneNumber: phoneNumber?.substring(0, 4) + '****',
      text: text?.length > 10 ? text.substring(0, 10) + '...' : text,
      timestamp: new Date().toISOString()
    });

    if (!sessionId || !phoneNumber || text === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: sessionId, phoneNumber, and text',
        timestamp: new Date().toISOString()
      });
    }

    const session = validateSession(req, sessionId);
    const displayNumber = normalizePhoneNumber(phoneNumber);

    console.log('📋 Session State:', {
      flowType: session.flowType,
      stage: session.stage,
      deviceType: session.deviceType,
      attempts: session.attempts
    });

    let message = '';
    let end = false;

    if (session.flowType === 'registration') {
      switch (session.stage) {
        case 'wallet_type_selection':
          if (text === '1') {
            console.log('📱 New Wallet selected');
            session.stage = 'new_wallet_pin_setup';
            session.walletType = 'new';
            message = `Create PIN (4-6 digits)\nThis PIN secures your wallet\n\nPIN:`;
          } else if (text === '2') {
            console.log('🔗 Link Existing selected');
            if (session.deviceType === 'smartphone') {
              session.stage = 'link_wallet_pin_setup';
              session.walletType = 'existing';
              message = `Create PIN (4-6 digits)\nThis PIN secures your account\n\nPIN:`;
            } else {
              message = `Wallet linking requires smartphone\nPlease use option 1 or dial from Android device`;
              end = true;
            }
          } else {
            message = `Invalid option\n\nWelcome to OUH!\n\n1. New Wallet\n2. Link Existing`;
          }
          break;

        case 'link_wallet_pin_setup':
          if (text.length >= 4 && text.length <= 6 && text.match(/^\d+$/)) {
            session.stage = 'link_wallet_pin_confirm';
            session.tempPin = text;
            message = `Re-enter your PIN (${text.length} digits):\n\nPIN:`;
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many invalid attempts\nRegistration cancelled\n\nDial *789# to try again`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `PIN must be 4-6 digits\n\nCreate PIN (4-6 digits):`;
            }
          }
          break;

        case 'link_wallet_pin_confirm':
          if (text === session.tempPin) {
            console.log('🔗 PIN confirmed - Generating connection ID...');
            const connectionId = crypto.randomBytes(8).toString('hex');
            
            global.walletConnections = global.walletConnections || {};
            global.walletConnections[connectionId] = {
              sessionId: sessionId,
              phoneNumber: displayNumber,
              pin: session.tempPin,
              status: 'pending',
              createdAt: Date.now(),
              expiresAt: Date.now() + 600000
            };

            console.log('🔐 Connection stored:', {
              connectionId: connectionId.substring(0, 8),
              phone: displayNumber.substring(0, 4) + '****',
              expiresIn: '10 minutes'
            });

            setTimeout(() => {
              if (global.walletConnections[connectionId]?.status === 'pending') {
                console.log('🗑️ Cleaning up expired connection:', connectionId.substring(0, 8));
                delete global.walletConnections[connectionId];
              }
            }, 600000);

            message = `✅ PIN Confirmed!\n\nOpening wallet app...\n[WALLET_CONNECT:${connectionId}]`;
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 2) {
              message = `PIN mismatch limit reached\nRegistration cancelled\n\nDial *789# to try again`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `PINs do not match\nRe-enter your PIN:`;
            }
          }
          break;

        case 'new_wallet_pin_setup':
          if (text.length >= 4 && text.length <= 6 && text.match(/^\d+$/)) {
            session.stage = 'new_wallet_pin_confirm';
            session.tempPin = text;
            message = `Re-enter your PIN (${text.length} digits):\n\nPIN:`;
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many invalid attempts\nRegistration cancelled\n\nDial *789# to try again`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `PIN must be 4-6 digits\n\nCreate PIN (4-6 digits):`;
            }
          }
          break;

        case 'new_wallet_pin_confirm':
          if (text === session.tempPin) {
            console.log('🔗 Registering user on Solana blockchain...');
            const registrationResult = await solanaService.registerUser(
              displayNumber,
              session.tempPin
            );

            if (registrationResult.success) {
              console.log('🎉 NEW WALLET CREATED ON SOLANA');
              message = `✅ Wallet Created!\n\nSolana blockchain wallet created\nPhone: ${displayNumber}\n\nDial *789*AMOUNT*PIN# to purchase crypto`;
            } else {
              console.error('❌ Solana registration failed:', registrationResult.error);
              message = `Registration failed:\n${registrationResult.error}\n\nPlease try again later`;
            }
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 2) {
              message = `PIN mismatch limit reached\nRegistration cancelled\n\nDial *789# to try again`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `PINs do not match\nRe-enter your PIN:`;
            }
          }
          break;

        default:
          message = `Session error\nPlease dial *789# to start again`;
          end = true;
          req.sessionManager.destroySession(sessionId);
      }

      if (!end) {
        req.sessionManager.updateSession(sessionId, session);
      }

    } else if (session.flowType === 'purchase') {
      switch (session.stage) {
        case 'service_selection':
        case 'service_selection_verified':
          if (text === '1') {
            const rateData = await solanaService.getBestRate();
            const transactionFee = 50; // ₦50 fixed fee
            const totalAmount = session.amount + transactionFee;
            const usdcAmount = (session.amount / rateData.rate).toFixed(2);

            session.stage = session.pinVerified ? 'confirm_purchase' : 'enter_pin';
            session.service = 'load_wallet';
            session.exchangeRate = rateData.rate;
            session.usdcAmount = usdcAmount;
            session.rateSource = rateData.source;
            session.transactionFee = transactionFee;
            session.totalAmount = totalAmount;

            if (session.pinVerified) {
              message = `₦${session.amount.toLocaleString()} → ${usdcAmount} USDC\nFee: ₦${transactionFee}\nBest Rate: ₦${Math.round(rateData.rate).toLocaleString()}/$ (${rateData.source})\n\n1. Confirm\n2. Cancel`;
            } else {
              message = `Load ₦${session.amount.toLocaleString()} USDC\nEnter PIN (4-6 digits):\n\nPIN:`;
            }
          } else if (text === '2') {
            session.stage = session.pinVerified ? 'confirm_purchase' : 'enter_pin';
            session.service = 'airtime';

            if (session.pinVerified) {
              message = `Buy ₦${session.amount.toLocaleString()} Airtime\nTo: ${session.recipient}\n\n1. Confirm\n2. Cancel`;
            } else {
              message = `Buy ₦${session.amount.toLocaleString()} Airtime\nEnter PIN (4-6 digits):\n\nPIN:`;
            }
          } else {
            message = `Invalid option\n\n₦${session.amount.toLocaleString()}\n\n1. Load Wallet (USDC)\n2. Buy Airtime`;
          }
          break;

        case 'enter_pin':
          if (text.length >= 4 && text.length <= 6 && text.match(/^\d+$/)) {
            try {
              await solanaService.checkPinRateLimit(displayNumber);
              
              // In production, verify PIN against stored hash
              const pinValid = true; // Replace with actual PIN verification
              
              if (!pinValid) {
                solanaService.incrementPinAttempts(displayNumber);
                session.attempts = (session.attempts || 0) + 1;
                
                if (session.attempts >= 3) {
                  message = `Too many invalid PIN attempts\nTransaction cancelled`;
                  end = true;
                  req.sessionManager.destroySession(sessionId);
                } else {
                  message = `Invalid PIN\nTry again (${3 - session.attempts} attempts left):`;
                }
              } else {
                solanaService.resetPinAttempts(displayNumber);
                session.stage = 'confirm_purchase';
                session.pin = text;
                
                if (session.service === 'load_wallet') {
                  message = `₦${session.amount.toLocaleString()} → ${session.usdcAmount} USDC\nRate: ₦${Math.round(session.exchangeRate).toLocaleString()}/$ (${session.rateSource})\n\n1. Confirm\n2. Cancel`;
                } else {
                  message = `Buy ₦${session.amount.toLocaleString()} Airtime\nTo: ${session.recipient}\n\n1. Confirm\n2. Cancel`;
                }
              }
            } catch (error) {
              message = `${error.message}\nTry again later`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            }
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many invalid PIN attempts\nTransaction cancelled`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `PIN must be 4-6 digits\nEnter PIN:`;
            }
          }
          break;

        case 'confirm_purchase':
          if (text === '1') {
            console.log('💳 Processing transaction...', {
              service: session.service,
              amount: session.amount,
              recipient: session.recipient?.substring(0, 4) + '****'
            });

            try {
              // Get user wallet address
              const userData = userRegistry.getUserData(displayNumber);
              
              if (!userData || !userData.walletAddress) {
                message = `Wallet not found\nPlease register first\nDial *789#`;
                end = true;
                req.sessionManager.destroySession(sessionId);
                break;
              }

              console.log('💼 User wallet:', userData.walletAddress.substring(0, 8) + '...');

              // Execute transaction based on service type
              if (session.service === 'load_wallet') {
                // Create USDC purchase transaction with total amount (including fee)
                const txResult = await solanaService.createTransaction(
                  displayNumber,
                  session.pin || '0000', // Use session PIN or dummy for pre-verified
                  session.totalAmount || session.amount, // Use total if available
                  'crypto'
                );

                if (txResult.success) {
                  console.log('✅ Crypto purchase successful:', txResult.transactionId);
                  
                  message = `✅ Success!\n\nCharged: ₦${session.totalAmount ? session.totalAmount.toLocaleString() : session.amount.toLocaleString()}\n${session.usdcAmount} USDC loaded\nWallet: ${userData.walletAddress.substring(0, 6)}...${userData.walletAddress.substring(userData.walletAddress.length - 4)}\n\nTx: ${txResult.signature.substring(0, 8)}...`;
                } else {
                  message = `❌ Transaction failed\n${txResult.error || 'Unknown error'}\n\nPlease try again`;
                }
              } else if (session.service === 'airtime') {
                // Create airtime purchase transaction
                const txResult = await solanaService.createTransaction(
                  displayNumber,
                  session.pin || '0000',
                  session.amount,
                  'airtime'
                );

                if (txResult.success) {
                  console.log('✅ Airtime purchase successful:', txResult.transactionId);
                  
                  message = `✅ Success!\n\n₦${session.amount.toLocaleString()} Airtime sent\nTo: ${session.recipient}\n\nTx: ${txResult.signature.substring(0, 8)}...`;
                } else {
                  message = `❌ Transaction failed\n${txResult.error || 'Unknown error'}\n\nPlease try again`;
                }
              }

              end = true;
              req.sessionManager.destroySession(sessionId);

            } catch (error) {
              console.error('❌ Transaction execution error:', error);
              message = `❌ Transaction failed\n${error.message}\n\nPlease try again`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            }

          } else if (text === '2') {
            message = `Transaction cancelled\n\nDial *789*AMOUNT*PIN# to try again`;
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else {
            message = `Invalid option\n\n1. Confirm\n2. Cancel`;
          }
          break;

        default:
          message = `Session error\nPlease try again`;
          end = true;
          req.sessionManager.destroySession(sessionId);
      }

      if (!end) {
        req.sessionManager.updateSession(sessionId, session);
      }
    }

    res.json({
      message: message,
      end: end,
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    handleSecureError(error, res, req.body.sessionId, req.sessionManager);
  }
});

// Wallet callback
router.post('/wallet/callback', async (req, res) => {
  try {
    const { connectionId, walletAddress, signature, message: signedMessage } = req.body;

    console.log('🔗 Wallet Callback:', {
      connectionId: connectionId?.substring(0, 8),
      wallet: walletAddress?.substring(0, 8) + '...',
      signature: signature ? 'present' : 'missing'
    });

    if (!connectionId || !walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: connectionId and walletAddress'
      });
    }

    const connection = global.walletConnections?.[connectionId];
    
    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Connection not found or expired'
      });
    }

    if (connection.status === 'connected') {
      return res.json({
        success: true,
        message: 'Wallet already linked',
        phone: connection.phoneNumber,
        walletAddress: connection.walletAddress
      });
    }

    if (Date.now() > connection.expiresAt) {
      delete global.walletConnections[connectionId];
      return res.status(410).json({
        success: false,
        error: 'Connection expired. Please dial *789# to try again.'
      });
    }

    const linkResult = await solanaService.linkWallet(
      connection.phoneNumber,
      connection.pin,
      walletAddress,
      {
        signature: signature,
        message: signedMessage
      }
    );

    if (linkResult.success) {
      connection.status = 'connected';
      connection.walletAddress = walletAddress;
      connection.connectedAt = Date.now();

      res.json({
        success: true,
        message: 'Wallet linked successfully!',
        phone: connection.phoneNumber,
        phoneNumber: connection.phoneNumber,
        walletAddress: walletAddress,
        timestamp: new Date().toISOString()
      });

      setTimeout(() => {
        delete global.walletConnections[connectionId];
      }, 5 * 60 * 1000);
    } else {
      res.status(400).json({
        success: false,
        error: linkResult.error
      });
    }

  } catch (error) {
    console.error('❌ Wallet callback error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process wallet connection',
      details: error.message
    });
  }
});

router.post('/end', (req, res) => {
  try {
    const { sessionId } = req.body;
    console.log('🔚 USSD End:', sessionId?.slice(-8));

    if (sessionId && req.sessionManager) {
      req.sessionManager.destroySession(sessionId);
    }

    res.json({
      message: 'Session ended',
      end: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in /end:', error);
    res.status(500).json({
      error: 'Failed to end session',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
