const express = require('express');
const router = express.Router();
const solanaService = require('../services/solanaService');
const { pinLimiter, registrationLimiter, transactionLimiter } = require('../middleware/rateLimiter');

/**
 * Enhanced USSD Routes with comprehensive security
 * Features:
 * - Multi-tier rate limiting
 * - Session encryption with nonce validation
 * - Comprehensive input validation
 * - Real-time security monitoring
 * - Anti-replay protection
 */

// Utility functions
const normalizePhoneNumber = (phone) => {
  // Convert +234... to 0... format for consistency
  return phone.replace(/^\+234/, '0');
};

/**
 * Enhanced session validation with security checks
 * @param {object} req - Express request object
 * @param {string} sessionId - Session identifier
 * @param {string} expectedNonce - Expected nonce for replay protection
 * @returns {object} - Validated session object
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
 * @param {Error} error - Error object
 * @param {object} res - Express response object
 * @param {string} sessionId - Session ID (optional)
 * @param {object} sessionManager - Session manager (optional)
 */
const handleSecureError = (error, res, sessionId = null, sessionManager = null) => {
  console.error('❌ USSD Error:', {
    message: error.message,
    sessionId: sessionId?.slice(-8),
    timestamp: new Date().toISOString()
  });
  
  // Clean up session on security errors
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
    
    console.log('🚀 USSD Start Request:', { 
      sessionId: sessionId?.slice(-8), 
      phoneNumber: phoneNumber?.substring(0, 4) + '****',
      userAgent: req.get('User-Agent')?.substring(0, 50),
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

    // Validate session ID format (security)
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || sessionId.length < 8) {
      return res.status(400).json({
        error: 'Invalid session ID format. Must be alphanumeric, at least 8 characters.',
        timestamp: new Date().toISOString()
      });
    }

    const displayNumber = normalizePhoneNumber(phoneNumber);
    
    // Validate phone number using Solana service
    if (!solanaService.validatePhoneNumber(displayNumber)) {
      return res.status(400).json({
        error: 'Invalid phone number format. Please use Nigerian format (e.g., 08031234567).',
        timestamp: new Date().toISOString()
      });
    }

    // Route based on session ID pattern with enhanced security
    if (sessionId.includes('registration')) {
      console.log('📝 Starting REGISTRATION flow for:', displayNumber.substring(0, 4) + '****');
      
      // Check if user already exists on Solana
      const userExists = await solanaService.userExists(displayNumber);
      
      if (userExists) {
        return res.json({
          message: `✅ Phone number ${displayNumber} is already registered!\n\n🎯 Ready to transact!\nDial 789AMOUNT# to purchase crypto or airtime.\n\nExample: 7891000# for ₦1,000`,
          end: true,
          timestamp: new Date().toISOString()
        });
      }

      // Create secure session with enhanced metadata
      const sessionNonce = req.sessionManager.createSession(sessionId, displayNumber, {
        flowType: 'registration',
        stage: 'wallet_type_selection',
        attempts: 0,
        securityLevel: 'enhanced',
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip,
        createdAt: Date.now()
      });

      res.json({
        message: `🎉 OUH! Welcome to Crypto USSD!\nPhone: ${displayNumber}\n\n💰 Choose wallet type:\n1. New Wallet (Any phone)\n2. Link Existing (Smartphone)\n\n⚡ Fast • Secure • Simple`,
        end: false,
        sessionId: sessionId,
        nonce: sessionNonce,
        timestamp: new Date().toISOString()
      });

    } else if (sessionId.includes('purchase')) {
      console.log('💰 Starting PURCHASE flow for:', displayNumber.substring(0, 4) + '****');

      // Check if user is registered on Solana
      const userExists = await solanaService.userExists(displayNumber);
      if (!userExists) {
        return res.json({
          message: `❌ Phone number ${displayNumber} not registered.\n\n📱 Please dial *789# first to create your wallet.\n\n✨ Registration is FREE and takes 2 minutes!\n\n🚀 Start earning crypto today!`,
          end: true,
          timestamp: new Date().toISOString()
        });
      }

      // Extract and validate amount from session ID
      const amountMatch = sessionId.match(/purchase_(\d+)/);
      if (!amountMatch) {
        return res.status(400).json({
          error: 'Invalid purchase session format. Use format: purchase_AMOUNT',
          example: 'purchase_1000',
          timestamp: new Date().toISOString()
        });
      }

      const amount = parseInt(amountMatch[1]);
      if (!solanaService.validateAmount(amount)) {
        return res.json({
          message: `❌ Invalid amount: ₦${amount.toLocaleString()}\n\n💡 Valid range:\n   Minimum: ₦${process.env.MIN_TRANSACTION_AMOUNT || '100'}\n   Maximum: ₦${process.env.MAX_TRANSACTION_AMOUNT || '100,000'}\n\n📞 Try again with valid amount`,
          end: true,
          timestamp: new Date().toISOString()
        });
      }

      // Create secure session for purchase
      const sessionNonce = req.sessionManager.createSession(sessionId, displayNumber, {
        flowType: 'purchase',
        stage: 'service_selection',
        amount: amount,
        attempts: 0,
        securityLevel: 'enhanced',
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip,
        createdAt: Date.now()
      });

      res.json({
        message: `💳 Purchase Request\nAmount: ₦${amount.toLocaleString()}\nPhone: ${displayNumber}\n\n🎯 Choose service:\n1. Load Wallet (USDC) 🪙\n2. Buy Airtime 📞\n\n⚡ Fast • Secure • Instant`,
       end: false,
       sessionId: sessionId,
       nonce: sessionNonce,
       timestamp: new Date().toISOString()
     });

   } else {
     return res.status(400).json({
       error: 'Invalid session type. Use "registration_" or "purchase_" prefix.',
       examples: [
         'registration_unique_id',
         'purchase_1000'
       ],
       timestamp: new Date().toISOString()
     });
   }

 } catch (error) {
   handleSecureError(error, res);
 }
});

/**
* Continue USSD session with enhanced security
* Route: POST /api/ussd/continue
*/
router.post('/continue', pinLimiter, async (req, res) => {
 try {
   const { sessionId, text, nonce } = req.body;
   
   console.log('▶️ USSD Continue:', { 
     sessionId: sessionId?.slice(-8), 
     text: text?.substring(0, 10) + (text?.length > 10 ? '...' : ''),
     nonce: nonce?.slice(-8),
     timestamp: new Date().toISOString()
   });

   // Enhanced validation
   if (!sessionId || text === undefined) {
     return res.status(400).json({
       error: 'Missing required fields: sessionId and text',
       timestamp: new Date().toISOString()
     });
   }

   // Validate text input length
   if (text.length > 160) {
     return res.status(400).json({
       error: 'Input too long. Maximum 160 characters allowed.',
       timestamp: new Date().toISOString()
     });
   }

   // Retrieve and validate session with nonce
   const session = validateSession(req, sessionId, nonce);
   
   // Sanitize input
   const cleanText = solanaService.sanitizeInput(text);
   let message = '';
   let end = false;

   if (session.flowType === 'registration') {
     // REGISTRATION FLOW with enhanced security and UX
     switch (session.stage) {
       case 'wallet_type_selection':
         if (cleanText === '1') {
           console.log('📱 New Wallet selected');
           session.stage = 'new_wallet_confirm';
           session.walletType = 'new';
           message = `🆕 New Wallet Creation\nPhone: ${session.originalPhone}\n\n🔐 Your secure crypto wallet will be created on Solana blockchain\n\n1. ✅ Confirm\n2. 📝 Change number\n\n⚡ Takes 30 seconds`;
         } else if (cleanText === '2') {
           console.log('🔗 Link Existing selected');
           session.stage = 'link_wallet_confirm';
           session.walletType = 'link';
           message = `🔗 Link Existing Wallet\nPhone: ${session.originalPhone}\n\n📱 Connect your smartphone wallet to USSD\n\n1. ✅ Confirm\n2. 📝 Change number\n\n🌐 Cross-platform access`;
         } else {
           session.attempts = (session.attempts || 0) + 1;
           if (session.attempts >= 3) {
             message = `❌ Too many invalid attempts.\n\n🔒 Session locked for security.\n\nDial *789# to start fresh.`;
             end = true;
             req.sessionManager.destroySession(sessionId);
           } else {
             message = `❌ Invalid option. Please select:\n\n💰 Choose wallet type:\n1. New Wallet (Any phone)\n2. Link Existing (Smartphone)\n\n⚡ Fast • Secure • Simple`;
           }
         }
         break;

       case 'new_wallet_confirm':
         if (cleanText === '1') {
           session.stage = 'new_wallet_pin_setup';
           message = `🔐 Create Security PIN\n\n⚠️ IMPORTANT:\n• Use 4-6 digits\n• Don't share with anyone\n• Remember it securely\n\n🛡️ Enter your PIN:\n(PIN will be hidden)`;
         } else if (cleanText === '2') {
           session.stage = 'new_wallet_change_number';
           message = `📱 Enter Phone Number\n\nFormat: 08031234567\n(Nigerian mobile number)\n\n📞 Your number:`;
         } else {
           message = `🆕 New Wallet Creation\nPhone: ${session.originalPhone}\n\n🔐 Your secure crypto wallet will be created on Solana blockchain\n\n1. ✅ Confirm\n2. 📝 Change number`;
         }
         break;

       case 'new_wallet_change_number':
         if (cleanText.length === 11 && solanaService.validatePhoneNumber(cleanText)) {
           session.originalPhone = cleanText;
           session.stage = 'new_wallet_confirm';
           message = `🆕 New Wallet Creation\nPhone: ${cleanText}\n\n🔐 Your secure crypto wallet will be created on Solana blockchain\n\n1. ✅ Confirm\n2. 📝 Change number`;
         } else {
           session.attempts = (session.attempts || 0) + 1;
           if (session.attempts >= 3) {
             message = `❌ Too many invalid attempts.\n\nSession terminated for security.\n\nDial *789# to try again.`;
             end = true;
             req.sessionManager.destroySession(sessionId);
           } else {
             message = `❌ Invalid phone number format.\n\n✅ Must be 11 digits starting with 0\nExample: 08031234567\n\n📞 Enter phone number:`;
           }
         }
         break;

       case 'new_wallet_pin_setup':
         if (solanaService.validatePin(cleanText)) {
           session.stage = 'new_wallet_pin_confirm';
           session.tempPin = cleanText;
           message = `🔒 Confirm Security PIN\n\nRe-enter your ${cleanText.length}-digit PIN to confirm:\n\n🛡️ Confirm PIN:\n(PIN will be hidden)`;
         } else {
           session.attempts = (session.attempts || 0) + 1;
           if (session.attempts >= 3) {
             message = `🚨 Security Alert!\nToo many invalid PIN attempts.\n\n🔒 Registration cancelled for security.\n\nDial *789# to try again.`;
             end = true;
             req.sessionManager.destroySession(sessionId);
           } else {
             message = `❌ Invalid PIN format.\n\n✅ Requirements:\n• 4-6 digits only\n• No letters or symbols\n\n🔐 Create your PIN:\n(PIN will be hidden)`;
           }
         }
         break;

       case 'new_wallet_pin_confirm':
         if (cleanText === session.tempPin) {
           console.log('🔗 Registering user on Solana blockchain...');

           try {
             // Register user on Solana with enhanced security
             const registrationResult = await solanaService.registerUser(
               session.originalPhone,
               session.tempPin
             );

             if (registrationResult.success) {
               console.log('🎉 NEW WALLET CREATED ON SOLANA');
               message = `🎉 SUCCESS!\n\n✅ Secure wallet created on Solana!\n📱 Wallet ID: ${session.originalPhone}\n🔐 PDA: ${registrationResult.userPDA.slice(0, 8)}...\n🛡️ Security: Enhanced\n\n💰 Ready to transact!\nDial 789AMOUNT# to purchase crypto\n\nExample: 7891000# for ₦1,000\n\n🚀 Welcome to the future!`;
             } else {
               console.error('❌ Solana registration failed:', registrationResult.error);
               message = `❌ Registration failed:\n${registrationResult.error}\n\n🔄 Please try again later.\n\nFor support, contact our team.`;
             }
           } catch (error) {
             console.error('❌ Registration error:', error);
             message = `❌ Registration failed:\n${error.message}\n\n🔄 Please try again later.\n\nIf problem persists, contact support.`;
           }

           end = true;
           req.sessionManager.destroySession(sessionId);
         } else {
           session.attempts = (session.attempts || 0) + 1;
           if (session.attempts >= 3) {
             message = `🚨 Security Alert!\nToo many PIN attempts.\n\n🔒 Registration cancelled for security.\n\nDial *789# to try again.`;
             end = true;
             req.sessionManager.destroySession(sessionId);
           } else {
             message = `❌ PINs do not match.\n\n🔒 Re-enter your ${session.tempPin.length}-digit PIN to confirm:\n\n🛡️ Confirm PIN:\n(PIN will be hidden)`;
           }
         }
         break;

       // Link wallet flow (simplified for this example)
       case 'link_wallet_confirm':
         if (cleanText === '1') {
           session.stage = 'link_wallet_pin_setup';
           message = `🔗 Link Existing Wallet\n\n🔐 Create 4-digit PIN to secure your linked wallet:\n\n🛡️ Enter PIN:\n(PIN will be hidden)`;
         } else if (cleanText === '2') {
           session.stage = 'link_wallet_change_number';
           message = `📱 Enter Phone Number\nExample: 08031234567\n\n📞 Number:`;
         } else {
           message = `🔗 Link Existing Wallet\nPhone: ${session.originalPhone}\n\n📱 Connect your smartphone wallet to USSD\n\n1. ✅ Confirm\n2. 📝 Change number`;
         }
         break;

       case 'link_wallet_pin_setup':
         if (solanaService.validatePin(cleanText)) {
           session.stage = 'link_wallet_pin_confirm';
           session.tempPin = cleanText;
           message = `🔒 Confirm Security PIN\n\nRe-enter your 4-digit PIN:\n\n🛡️ Confirm PIN:\n(PIN will be hidden)`;
         } else {
           message = `❌ PIN must be 4-6 digits.\n\n🔐 Create PIN to secure your linked wallet:\n\n🛡️ Enter PIN:`;
         }
         break;

       case 'link_wallet_pin_confirm':
         if (cleanText === session.tempPin) {
           console.log('🔗 Linking existing wallet on Solana...');

           try {
             const linkResult = await solanaService.registerUser(
               session.originalPhone,
               session.tempPin
             );

             if (linkResult.success) {
               const linkToken = Math.random().toString(36).substring(2, 8).toUpperCase();
               session.stage = 'link_wallet_sms_sent';
               session.linkToken = linkToken;
               message = `📱 SMS sent to ${session.originalPhone}!\n\n🔗 Click link to connect wallet:\nouh.app/link/${linkToken}\n\n✅ Wallet PDA created on ${linkResult.cluster}\n\n⏳ Press any key when done.`;
             } else {
               message = `❌ Wallet linking failed:\n${linkResult.error}\n\n🔄 Please try again.`;
             }
           } catch (error) {
             message = `❌ Linking failed:\n${error.message}\n\n🔄 Please try again later.`;
           }
         } else {
           message = `❌ PINs do not match.\n\n🔒 Re-enter your 4-digit PIN:\n\n🛡️ Confirm PIN:`;
         }
         break;

       case 'link_wallet_sms_sent':
         console.log('🎉 EXISTING WALLET LINKED ON SOLANA');
         message = `🎉 SUCCESS!\n\n✅ Wallet linked on Solana blockchain!\n📱 Wallet ID: ${session.originalPhone}\n\n💰 Ready to transact!\nDial 789AMOUNT# to purchase crypto\n\n🚀 Cross-platform access enabled!`;
         end = true;
         req.sessionManager.destroySession(sessionId);
         break;

       default:
         message = `⏰ Session expired.\n\nDial *789# to start a new session.`;
         end = true;
         req.sessionManager.destroySession(sessionId);
     }

   } else if (session.flowType === 'purchase') {
     // PURCHASE FLOW with enhanced security and UX
     switch (session.stage) {
       case 'service_selection':
         if (cleanText === '1') {
           console.log('💰 Load Wallet selected');

           try {
             const calculation = await solanaService.calculateCryptoPurchase(session.amount);
             session.stage = 'load_wallet_confirm';
             session.serviceType = 'wallet';
             session.calculation = calculation;

             message = `💰 Load Crypto Wallet\n\n💵 Amount: ₦${session.amount.toLocaleString()}\n💸 Fee: ₦${calculation.fee.toLocaleString()}\n🪙 You get: ~${(calculation.usdcAmount / 1000000).toFixed(2)} USDC\n📈 Rate: ₦${calculation.rate.toLocaleString()}/USDC\n\n1. ✅ Confirm transaction\n0. ❌ Cancel\n\n⚡ Instant delivery`;
           } catch (error) {
             message = `❌ Calculation failed:\n${error.message}\n\n🔄 Please try again.`;
           }
         } else if (cleanText === '2') {
           console.log('📞 Airtime selected');
           session.stage = 'airtime_confirm';
           session.serviceType = 'airtime';
           message = `📞 Buy Airtime\n\n💵 Amount: ₦${session.amount.toLocaleString()}\n📱 Phone: ${session.originalPhone}\n💸 Fee: FREE! 🎉\n\n1. ✅ Confirm transaction\n0. ❌ Cancel\n\n⚡ Instant top-up`;
         } else {
           session.attempts = (session.attempts || 0) + 1;
           if (session.attempts >= 3) {
             message = `❌ Too many invalid attempts.\n\nSession terminated.\n\nDial 789${session.amount}# to try again.`;
             end = true;
             req.sessionManager.destroySession(sessionId);
           } else {
             message = `❌ Invalid selection.\n\n💳 Purchase Request\nAmount: ₦${session.amount.toLocaleString()}\n\n🎯 Choose service:\n1. Load Wallet (USDC) 🪙\n2. Buy Airtime 📞\n\n⚡ Select service:`;
           }
         }
         break;

       case 'load_wallet_confirm':
         if (cleanText === '1') {
           session.stage = 'load_wallet_pin';
           message = `🔐 Secure Transaction\n\nEnter your 4-digit PIN to confirm:\n💰 ₦${session.amount.toLocaleString()} → ${(session.calculation.usdcAmount / 1000000).toFixed(2)} USDC\n\n🛡️ Enter PIN:\n(PIN will be hidden for security)`;
         } else if (cleanText === '0') {
           message = `❌ Transaction cancelled.\n\n💡 No charges applied.\n\nThank you for using OUH! 🚀`;
           end = true;
           req.sessionManager.destroySession(sessionId);
         } else {
           const calc = session.calculation;
           message = `💰 Load Crypto Wallet\n\n💵 Amount: ₦${session.amount.toLocaleString()}\n💸 Fee: ₦${calc.fee.toLocaleString()}\n🪙 You get: ~${(calc.usdcAmount / 1000000).toFixed(2)} USDC\n\n1. ✅ Confirm transaction\n0. ❌ Cancel`;
         }
         break;

       case 'load_wallet_pin':
         if (solanaService.validatePin(cleanText)) {
           console.log('🔗 Processing crypto transaction on Solana...');

           try {
             const txResult = await solanaService.createTransaction(
               session.originalPhone,
               cleanText,
               session.amount,
               'crypto'
             );

             if (txResult.success) {
               const usdcAmount = session.calculation.usdcAmount / 1000000;
               const txIdDisplay = txResult.signature.substring(0, 16);
               console.log('🎉 CRYPTO LOADED ON SOLANA');
               message = `🎉 SUCCESS!\n\n✅ ₦${session.amount.toLocaleString()} → ${usdcAmount.toFixed(2)} USDC\n📱 Loaded to: ${session.originalPhone}\n\n🔐 Tx ID: ${txIdDisplay}...\n🛡️ Security: Enhanced\n🌐 View on Solana Explorer\n\n🚀 Crypto wallet loaded!\nTransaction completed securely.`;
             } else {
               message = `❌ Crypto purchase failed:\n${txResult.error}\n\n🔄 Please try again.\n\nIf problem persists, contact support.`;
             }
           } catch (error) {
             message = `❌ Transaction failed:\n${error.message}\n\n🔄 Please try again later.\n\nFor support, contact our team.`;
           }

           end = true;
           req.sessionManager.destroySession(sessionId);
         } else {
           session.attempts = (session.attempts || 0) + 1;
           if (session.attempts >= 3) {
             message = `🚨 Security Alert!\nToo many invalid PIN attempts.\n\n🔒 Transaction cancelled for security.\n\nDial 789${session.amount}# to try again.`;
             end = true;
             req.sessionManager.destroySession(sessionId);
           } else {
             message = `❌ Invalid PIN format.\n\n✅ PIN must be 4-6 digits.\n\n🔐 Enter your PIN:\n(PIN will be hidden for security)`;
           }
         }
         break;

       case 'airtime_confirm':
         if (cleanText === '1') {
           session.stage = 'airtime_pin';
           message = `🔐 Secure Transaction\n\nEnter your 4-digit PIN to confirm:\n📞 ₦${session.amount.toLocaleString()} airtime → ${session.originalPhone}\n\n🛡️ Enter PIN:\n(PIN will be hidden for security)`;
         } else if (cleanText === '0') {
           message = `❌ Transaction cancelled.\n\n💡 No charges applied.\n\nThank you for using OUH! 🚀`;
           end = true;
           req.sessionManager.destroySession(sessionId);
         } else {
           message = `📞 Buy Airtime\n\n💵 Amount: ₦${session.amount.toLocaleString()}\n📱 Phone: ${session.originalPhone}\n💸 Fee: FREE! 🎉\n\n1. ✅ Confirm transaction\n0. ❌ Cancel`;
         }
         break;

       case 'airtime_pin':
         if (solanaService.validatePin(cleanText)) {
           console.log('📞 Processing airtime transaction...');

           try {
             const airtimeResult = await solanaService.createTransaction(
               session.originalPhone,
               cleanText,
               session.amount,
               'airtime'
             );

             if (airtimeResult.success) {
               const txIdDisplay = airtimeResult.signature.substring(0, 16);
               console.log('🎉 AIRTIME PURCHASED SUCCESSFULLY');
               message = `🎉 SUCCESS!\n\n✅ ₦${session.amount.toLocaleString()} airtime loaded\n📱 To: ${session.originalPhone}\n\n🔐 Tx ID: ${txIdDisplay}...\n🛡️ Security: Enhanced\n\n⚡ Balance updated immediately!\nTransaction completed securely.`;
             } else {
               message = `❌ Airtime purchase failed:\n${airtimeResult.error}\n\n🔄 Please try again.\n\nIf problem persists, contact support.`;
             }
           } catch (error) {
             message = `❌ Transaction failed:\n${error.message}\n\n🔄 Please try again later.\n\nFor support, contact our team.`;
           }

           end = true;
           req.sessionManager.destroySession(sessionId);
         } else {
           session.attempts = (session.attempts || 0) + 1;
           if (session.attempts >= 3) {
             message = `🚨 Security Alert!\nToo many invalid PIN attempts.\n\n🔒 Transaction cancelled for security.\n\nDial 789${session.amount}# to try again.`;
             end = true;
             req.sessionManager.destroySession(sessionId);
           } else {
             message = `❌ Invalid PIN format.\n\n✅ PIN must be 4-6 digits.\n\n🔐 Enter your PIN:\n(PIN will be hidden for security)`;
           }
         }
         break;

       default:
         message = `⏰ Session expired.\n\nDial 789${session.amount}# to try again.`;
         end = true;
         req.sessionManager.destroySession(sessionId);
     }
   } else {
     message = `❌ Invalid session type.\n\nPlease start a new session.`;
     end = true;
     req.sessionManager.destroySession(sessionId);
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
   handleSecureError(error, res, sessionId, req.sessionManager);
 }
});

/**
* End a USSD session with proper cleanup
* Route: POST /api/ussd/end
*/
router.post('/end', (req, res) => {
 try {
   const { sessionId } = req.body;
   console.log('🔚 USSD End:', {
     sessionId: sessionId?.slice(-8),
     timestamp: new Date().toISOString()
   });
   
   if (sessionId && req.sessionManager) {
     const destroyed = req.sessionManager.destroySession(sessionId);
     console.log('✅ Session cleanup:', destroyed ? 'successful' : 'session not found');
   }
   
   res.json({ 
     message: '👋 Session ended securely.\n\nThank you for using OUH!\n\n🚀 Dial *789# anytime to transact.', 
     end: true,
     timestamp: new Date().toISOString(),
     securityLevel: 'enhanced'
   });
 } catch (error) {
   console.error('❌ Error ending session:', error);
   res.status(500).json({
     error: 'Failed to end session securely',
     end: true,
     timestamp: new Date().toISOString()
   });
 }
});

/**
* Health check for Solana connection with security status
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
   console.error('❌ Health check failed:', error);
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
   console.error('❌ Stats retrieval failed:', error);
   res.status(500).json({
     error: 'Failed to retrieve statistics',
     timestamp: new Date().toISOString()
   });
 }
});

module.exports = router;
