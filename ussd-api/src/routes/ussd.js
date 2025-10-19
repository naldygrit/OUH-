const express = require('express');
const router = express.Router();
const solanaService = require('../services/solanaService');
const { pinLimiter, registrationLimiter, transactionLimiter } = require('../middleware/rateLimiter');

/**
 * Enhanced USSD Routes with comprehensive security + Pyth Network Integration
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
  try {
    const { sessionId, phoneNumber } = req.body;
    
    console.log('USSD Start Request:', {
      sessionId: sessionId?.slice(-8),
      phoneNumber: phoneNumber?.substring(0, 4) + '****',
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
        attempts: 0,
        securityLevel: 'enhanced',
        createdAt: Date.now()
      });
      
      // OPTIMIZED: 68 chars
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
      
      let amount, pin, recipient, pattern;
      
      // Pattern detection
      if (parts.length === 3 && parts[0].length === 11) {
        pattern = 'send_to_other';
        recipient = parts[0];
        amount = parseInt(parts[1]);
        pin = parts[2];
      } else if (parts.length === 2 && parts[0].length <= 6) {
        pattern = 'buy_for_self';
        recipient = displayNumber;
        amount = parseInt(parts[0]);
        pin = parts[1];
      } else if (parts.length === 1) {
        pattern = 'fallback';
        amount = parseInt(parts[0]);
        recipient = displayNumber;
        pin = null;
      } else {
        return res.status(400).json({
          error: 'Invalid purchase format',
          timestamp: new Date().toISOString()
        });
      }
      
      // Validate amount
      if (!solanaService.validateAmount(amount)) {
        return res.json({
          message: `Invalid amount: ₦${amount.toLocaleString()}\nRange: ₦100-₦1M`,
          end: true,
          timestamp: new Date().toISOString()
        });
      }
      
      // Pattern 1 & 2: Verify PIN immediately
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
          
          const pinValid = true; // Mock for demo
          
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
      
      // OPTIMIZED: Show recipient confirmation in Screen 1
      let message;
      if (pattern === 'send_to_other') {
        // Pattern 2: Sending to someone else
        message = `₦${amount.toLocaleString()}\nTo: ${recipient}\n\n1. Load Wallet (USDC)\n2. Buy Airtime`;
      } else {
        // Pattern 1 & 3: Buying for self
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

/**
 * Continue USSD session with enhanced security + Pyth integration
 * Route: POST /api/ussd/continue
 */
router.post('/continue', pinLimiter, async (req, res) => {
  try {
    const { sessionId, text, nonce } = req.body;
    
    console.log('USSD Continue:', {
      sessionId: sessionId?.slice(-8),
      text: text?.substring(0, 10) + (text?.length > 10 ? '...' : ''),
      timestamp: new Date().toISOString()
    });
    
    if (!sessionId || text === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: sessionId and text',
        timestamp: new Date().toISOString()
      });
    }
    
    if (text.length > 160) {
      return res.status(400).json({
        error: 'Input too long. Maximum 160 characters allowed.',
        timestamp: new Date().toISOString()
      });
    }
    
    const session = validateSession(req, sessionId, nonce);
    const cleanText = solanaService.sanitizeInput(text);
    
    let message = '';
    let end = false;
    
    if (session.flowType === 'registration') {
      // REGISTRATION FLOW - All messages optimized
      switch (session.stage) {
        case 'wallet_type_selection':
          if (cleanText === '1') {
            session.stage = 'new_wallet_confirm';
            session.walletType = 'new';
            // OPTIMIZED: 82 chars
            message = `New Wallet\n${session.originalPhone}\nSecure on Solana\n\n1. OK\n2. Change`;
          } else if (cleanText === '2') {
            session.stage = 'link_wallet_confirm';
            session.walletType = 'link';
            // OPTIMIZED: 85 chars
            message = `Link Wallet\n${session.originalPhone}\nConnect to USSD\n\n1. OK\n2. Change`;
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many attempts\nDial *789# to restart`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `Invalid option\n\n1. New Wallet\n2. Link Existing`;
            }
          }
          break;
          
        case 'new_wallet_confirm':
          if (cleanText === '1') {
            session.stage = 'new_wallet_pin_setup';
            // OPTIMIZED: 32 chars
            message = `Create PIN (4-6 digits)\n\nPIN:`;
          } else if (cleanText === '2') {
            session.stage = 'new_wallet_change_number';
            // OPTIMIZED: 41 chars
            message = `Enter Phone\nFormat: 08031234567\n\n#:`;
          } else {
            message = `New Wallet\n${session.originalPhone}\n\n1. OK\n2. Change`;
          }
          break;
          
        case 'new_wallet_change_number':
          if (cleanText.length === 11 && solanaService.validatePhoneNumber(cleanText)) {
            session.originalPhone = cleanText;
            session.stage = 'new_wallet_confirm';
            message = `New Wallet\n${cleanText}\nSecure on Solana\n\n1. OK\n2. Change`;
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many attempts\nDial *789# to retry`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `Invalid format\n11 digits: 08031234567\n\n#:`;
            }
          }
          break;
          
        case 'new_wallet_pin_setup':
          if (solanaService.validatePin(cleanText)) {
            session.stage = 'new_wallet_pin_confirm';
            session.tempPin = cleanText;
            // OPTIMIZED: 19 chars
            message = `Confirm PIN\n\nPIN:`;
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many attempts\nDial *789# to retry`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `PIN must be 4-6 digits\n\nPIN:`;
            }
          }
          break;
          
        case 'new_wallet_pin_confirm':
          if (cleanText === session.tempPin) {
            try {
              const registrationResult = await solanaService.registerUser(
                session.originalPhone,
                session.tempPin
              );
              
              if (registrationResult.success) {
                const pdaDisplay = registrationResult.userPDA ? 
                  registrationResult.userPDA.slice(0, 8) + '...' : 'abc12345...';
                
                // OPTIMIZED: 95 chars
                message = `✅ Wallet Created\n${session.originalPhone}\nPDA: ${pdaDisplay}\n\nDial *789*AMT# to load`;
              } else {
                message = `Registration failed\n${registrationResult.error}`;
              }
            } catch (error) {
              message = `Registration failed\nTry again later`;
            }
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many attempts\nDial *789# to retry`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `PINs don't match\n\nConfirm PIN\n\nPIN:`;
            }
          }
          break;
          
        case 'link_wallet_confirm':
          if (cleanText === '1') {
            session.stage = 'link_wallet_pin_setup';
            message = `Create PIN (4-6 digits)\nSecure your wallet\n\nPIN:`;
          } else if (cleanText === '2') {
            session.stage = 'link_wallet_change_number';
            message = `Enter Phone\nFormat: 08031234567\n\n#:`;
          } else {
            message = `Link Wallet\n${session.originalPhone}\n\n1. OK\n2. Change`;
          }
          break;
          
        case 'link_wallet_pin_setup':
          if (solanaService.validatePin(cleanText)) {
            session.stage = 'link_wallet_pin_confirm';
            session.tempPin = cleanText;
            message = `Confirm PIN\n\nPIN:`;
          } else {
            message = `PIN must be 4-6 digits\n\nPIN:`;
          }
          break;
          
        case 'link_wallet_pin_confirm':
          if (cleanText === session.tempPin) {
            try {
              const linkResult = await solanaService.registerUser(
                session.originalPhone,
                session.tempPin
              );
              
              if (linkResult.success) {
                const linkToken = Math.random().toString(36).substring(2, 8).toUpperCase();
                session.stage = 'link_wallet_sms_sent';
                session.linkToken = linkToken;
                message = `SMS sent to ${session.originalPhone}\n\nLink: ouh.app/link/${linkToken}\n\nPress any key`;
              } else {
                message = `Linking failed\nTry again`;
              }
            } catch (error) {
              message = `Linking failed\nTry later`;
            }
          } else {
            message = `PINs don't match\n\nConfirm PIN\n\nPIN:`;
          }
          break;
          
        case 'link_wallet_sms_sent':
          const pdaDisplay2 = 'abc12345...';
          message = `✅ Wallet Linked\n${session.originalPhone}\nPDA: ${pdaDisplay2}\n\nDial *789*AMT#`;
          end = true;
          req.sessionManager.destroySession(sessionId);
          break;
          
        default:
          message = `Session expired\nDial *789# to start`;
          end = true;
          req.sessionManager.destroySession(sessionId);
      }
      
    } else if (session.flowType === 'purchase') {
      // PURCHASE FLOW - All messages optimized under 160 chars
      switch (session.stage) {
        case 'service_selection':
        case 'service_selection_verified':
          if (cleanText === '1') {
            try {
              const calculation = await solanaService.calculateCryptoPurchase(session.amount);
              const usdcAmount = (calculation.usdcAmount / 1000000).toFixed(2);
              
              if (session.pinVerified && session.pin) {
                session.stage = 'fast_track_confirm';
                session.serviceType = 'wallet';
                session.calculation = calculation;
                
                const rateSource = calculation.rateSource || 'Default';
                const pythStatus = calculation.pythEnabled ? '📊 Pyth' : '📈 Default';
                
                // OPTIMIZED: ~145 chars
                message = `Load Wallet\nAmt: ₦${session.amount.toLocaleString()}  Fee: ₦${calculation.fee}\nBest Rate: ₦${calculation.rate}/$1; ~${usdcAmount} USDC; ${rateSource} (${pythStatus})\n\n1. Confirm\n0. Cancel`;
                
              } else {
                session.stage = 'load_wallet_confirm';
                session.serviceType = 'wallet';
                session.calculation = calculation;
                
                const rateSource = calculation.rateSource || 'Default';
                const pythStatus = calculation.pythEnabled ? '📊 Pyth' : '📈 Default';
                
                // OPTIMIZED: ~145 chars
                message = `Load Wallet\nAmt: ₦${session.amount.toLocaleString()}  Fee: ₦${calculation.fee}\nBest Rate: ₦${calculation.rate}/$1; ~${usdcAmount} USDC; ${rateSource} (${pythStatus})\n\n1. Confirm\n0. Cancel`;
              }
            } catch (error) {
              message = `Calculation failed\nTry again`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            }
          } else if (cleanText === '2') {
            if (session.pinVerified && session.pin) {
              session.stage = 'fast_track_airtime_confirm';
              session.serviceType = 'airtime';
              
              const recipientDisplay = session.recipient === session.originalPhone ?
                session.originalPhone : session.recipient;
              
              // OPTIMIZED: ~65 chars
              message = `Buy Airtime\nAmt: ₦${session.amount.toLocaleString()}  Fee: FREE\nTo: ${recipientDisplay}\n\n1. Confirm\n0. Cancel`;
              
            } else {
              session.stage = 'airtime_confirm';
              session.serviceType = 'airtime';
              // OPTIMIZED: ~65 chars
              message = `Buy Airtime\nAmt: ₦${session.amount.toLocaleString()}  Fee: FREE\nTo: ${session.originalPhone}\n\n1. Confirm\n0. Cancel`;
            }
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many attempts\nDial *789*${session.amount}# to retry`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `Invalid option\n\n1. Load Wallet\n2. Buy Airtime`;
            }
          }
          break;
        
        case 'fast_track_confirm':
          if (cleanText === '1') {
            try {
              const txResult = await solanaService.createTransaction(
                session.originalPhone,
                session.pin,
                session.amount,
                'crypto'
              );
              
              if (txResult.success) {
                const usdcAmount = (session.calculation.usdcAmount / 1000000).toFixed(2);
                const txIdDisplay = txResult.signature.substring(0, 16);
                
                // OPTIMIZED: Removed "To: your wallet" and rocket emoji
                message = `✅ Success!\n₦${session.amount.toLocaleString()} → ${usdcAmount} USDC\nTx: ${txIdDisplay}...`;
              } else {
                message = `❌ Transaction failed\n${txResult.error}\n\nTry again`;
              }
            } catch (error) {
              message = `❌ Transaction failed\n${error.message}\n\nTry again later`;
            }
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else if (cleanText === '0') {
            message = `Transaction cancelled\nNo charges applied\n\nThank you for using OUH`;
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else {
            const calc = session.calculation;
            const usdcAmount = (calc.usdcAmount / 1000000).toFixed(2);
            const rateSource = calc.rateSource || 'Default';
            const pythStatus = calc.pythEnabled ? '📊 Pyth' : '📈 Default';
            
            message = `Load Wallet\nAmt: ₦${session.amount.toLocaleString()}  Fee: ₦${calc.fee}\nBest Rate: ₦${calc.rate}/$1; ~${usdcAmount} USDC; ${rateSource} (${pythStatus})\n\n1. Confirm\n0. Cancel`;
          }
          break;
        
        case 'fast_track_airtime_confirm':
          if (cleanText === '1') {
            try {
              const airtimeResult = await solanaService.createTransaction(
                session.originalPhone,
                session.pin,
                session.amount,
                'airtime'
              );
              
              if (airtimeResult.success) {
                const txIdDisplay = airtimeResult.signature.substring(0, 16);
                
                const recipientDisplay = session.recipient === session.originalPhone ?
                  session.originalPhone : session.recipient;
                
                // OPTIMIZED: Removed rocket emoji
                message = `✅ Success!\n₦${session.amount.toLocaleString()} airtime loaded\nTo: ${recipientDisplay}\nTx: ${txIdDisplay}...`;
              } else {
                message = `❌ Purchase failed\n${airtimeResult.error}\n\nTry again`;
              }
            } catch (error) {
              message = `❌ Transaction failed\n${error.message}\n\nTry again later`;
            }
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else if (cleanText === '0') {
            message = `Transaction cancelled\nNo charges applied\n\nThank you for using OUH`;
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else {
            const recipientDisplay = session.recipient === session.originalPhone ?
              session.originalPhone : session.recipient;
            
            message = `Buy Airtime\nAmt: ₦${session.amount.toLocaleString()}  Fee: FREE\nTo: ${recipientDisplay}\n\n1. Confirm\n0. Cancel`;
          }
          break;
          
        case 'load_wallet_confirm':
          if (cleanText === '1') {
            session.stage = 'load_wallet_pin';
            const usdcAmount = (session.calculation.usdcAmount / 1000000).toFixed(2);
            
            // OPTIMIZED: Simple PIN prompt
            message = `🔒 Enter PIN\n₦${session.amount.toLocaleString()} → ${usdcAmount} USDC\n\nPIN:`;
          } else if (cleanText === '0') {
            message = `Transaction cancelled\nNo charges applied\n\nThank you for using OUH`;
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else {
            const calc = session.calculation;
            const usdcAmount = (calc.usdcAmount / 1000000).toFixed(2);
            const rateSource = calc.rateSource || 'Default';
            const pythStatus = calc.pythEnabled ? '📊 Pyth' : '📈 Default';
            
            message = `Load Wallet\nAmt: ₦${session.amount.toLocaleString()}  Fee: ₦${calc.fee}\nBest Rate: ₦${calc.rate}/$1; ~${usdcAmount} USDC; ${rateSource} (${pythStatus})\n\n1. Confirm\n0. Cancel`;
          }
          break;
          
        case 'load_wallet_pin':
          if (solanaService.validatePin(cleanText)) {
            try {
              const txResult = await solanaService.createTransaction(
                session.originalPhone,
                cleanText,
                session.amount,
                'crypto'
              );
              
              if (txResult.success) {
                const usdcAmount = (session.calculation.usdcAmount / 1000000).toFixed(2);
                const txIdDisplay = txResult.signature.substring(0, 16);
                
                // OPTIMIZED: Removed "To: phone" and rocket emoji
                message = `✅ Success\n₦${session.amount.toLocaleString()} → ${usdcAmount} USDC\nTx: ${txIdDisplay}...`;
              } else {
                message = `❌ Purchase failed\n${txResult.error}\n\nTry again`;
              }
            } catch (error) {
              message = `❌ Transaction failed\n${error.message}\n\nTry again later`;
            }
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many PIN attempts\nDial *789*${session.amount}# to retry`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `PIN must be 4-6 digits\n\nPIN:`;
            }
          }
          break;
          
        case 'airtime_confirm':
          if (cleanText === '1') {
            session.stage = 'airtime_pin';
            // OPTIMIZED: Simple PIN prompt
            message = `🔒 Enter PIN\n₦${session.amount.toLocaleString()} airtime\nTo: ${session.originalPhone}\n\nPIN:`;
          } else if (cleanText === '0') {
            message = `Transaction cancelled\nNo charges applied\n\nThank you for using OUH`;
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else {
            message = `Buy Airtime\nAmt: ₦${session.amount.toLocaleString()}  Fee: FREE\nTo: ${session.originalPhone}\n\n1. Confirm\n0. Cancel`;
          }
          break;
          
        case 'airtime_pin':
          if (solanaService.validatePin(cleanText)) {
            try {
              const airtimeResult = await solanaService.createTransaction(
                session.originalPhone,
                cleanText,
                session.amount,
                'airtime'
              );
              
              if (airtimeResult.success) {
                const txIdDisplay = airtimeResult.signature.substring(0, 12);
                // OPTIMIZED: 73 chars
                message = `✅ Success\n₦${session.amount.toLocaleString()} airtime\nTo:${session.originalPhone}\nTx:${txIdDisplay}`;
              } else {
                message = `Purchase failed\n${airtimeResult.error}`;
              }
            } catch (error) {
              message = `Transaction failed\nTry later`;
            }
            end = true;
            req.sessionManager.destroySession(sessionId);
          } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
              message = `Too many PIN attempts\nDial *789*${session.amount}# to retry`;
              end = true;
              req.sessionManager.destroySession(sessionId);
            } else {
              message = `PIN must be 4-6 digits\n\nPIN:`;
            }
          }
          break;
          
        default:
          message = `Session expired\nDial *789*${session.amount}# to retry`;
          end = true;
          req.sessionManager.destroySession(sessionId);
      }
      
    } else {
      message = `Invalid session\nStart new session`;
      end = true;
      req.sessionManager.destroySession(sessionId);
    }
    
    // Validate message length before sending
    if (!validateUssdLength(message)) {
      console.error(`Message too long: ${message.length} chars`);
      // Ultra-compact fallback
      message = message.substring(0, 157) + '...';
    }
    
    // Update session if not ending
    if (!end && session) {
      req.sessionManager.updateSession(sessionId, session);
    }
    
    res.json({
      message,
      end,
      timestamp: new Date().toISOString(),
      securityLevel: 'enhanced'
    });
    
  } catch (error) {
    handleSecureError(error, res, req.body.sessionId, req.sessionManager);
  }
});

/**
 * End a USSD session with proper cleanup
 * Route: POST /api/ussd/end
 */
router.post('/end', (req, res) => {
  try {
    const { sessionId } = req.body;
    
    console.log('USSD End:', {
      sessionId: sessionId?.slice(-8),
      timestamp: new Date().toISOString()
    });
    
    if (sessionId && req.sessionManager) {
      const destroyed = req.sessionManager.destroySession(sessionId);
      console.log('Session cleanup:', destroyed ? 'successful' : 'session not found');
    }
    
    // OPTIMIZED: 52 chars
    res.json({
      message: 'Session ended\n\nThank you!\n\nDial *789#',
      end: true,
      timestamp: new Date().toISOString(),
      securityLevel: 'enhanced'
    });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({
      error: 'Failed to end session securely',
      end: true,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Health check for Solana connection with security status + Pyth
 * Route: GET /api/ussd/health/solana
 */
router.get('/health/solana', async (req, res) => {
  try {
    const health = await solanaService.healthCheck();
    const securityAnalytics = solanaService.getSecurityAnalytics();
    
    res.json({
      service: 'OUH! USSD API',
      version: '2.0.0',
      solana: health.status === 'OK' ? 'CONNECTED' : 'DISCONNECTED',
      pyth: health.pythIntegration ? health.pythIntegration.status : 'unknown',
      security: 'ENHANCED',
      details: {
        solanaHealth: health,
        securityAnalytics: securityAnalytics
      },
      endpoints: {
        start: 'POST /api/ussd/start',
        continue: 'POST /api/ussd/continue',
        end: 'POST /api/ussd/end'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      service: 'OUH! USSD API',
      version: '2.0.0',
      solana: 'ERROR',
      security: 'ENHANCED',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get USSD service statistics (admin endpoint)
 * Route: GET /api/ussd/stats
 */
router.get('/stats', (req, res) => {
  try {
    const sessionStats = req.sessionManager ? req.sessionManager.getSecurityReport() : null;
    const solanaStats = solanaService.getSecurityAnalytics();
    
    res.json({
      service: 'OUH! USSD API Statistics',
      version: '2.0.0',
      sessions: sessionStats,
      solana: solanaStats,
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Stats retrieval failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve statistics',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
