const express = require('express');
const router = express.Router();
const flutterwaveService = require('../integrations/flutterwave/flutterwaveService');
const sessionService = require('../services/sessionService');
const userService = require('../services/userService');
const PhoneUtils = require('../utils/phoneUtils');
const CryptoUtils = require('../utils/cryptoUtils');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Main USSD handler - Following exact OUH! flow design
router.post('/', async (req, res) => {
  try {
    const { sessionId, phoneNumber, text } = req.body;
    
    // Clean phone number
    const cleanPhone = PhoneUtils.cleanPhoneNumber(phoneNumber);
    
    // Validate phone number
    if (!PhoneUtils.isValidNigerianPhone(cleanPhone)) {
      return res.json({
        message: `Invalid phone number format.`,
        continueSession: false
      });
    }

    console.log(`USSD Request: ${cleanPhone} | Session: ${sessionId} | Text: "${text}"`);

    // Step 1: Initial *789# dial
    if (!text || text === '') {
      return await handleInitialDial(cleanPhone, sessionId, res);
    }

    // Get session data for multi-step flows
    const session = await sessionService.getUserSession(sessionId);

    // Handle registration flow
    if (await handleRegistrationFlow(text, session, sessionId, cleanPhone, res)) {
      return;
    }

    // Handle transaction flow (amount-based: *789*5000#)
    if (await handleTransactionFlow(text, session, sessionId, cleanPhone, res)) {
      return;
    }

    // Default fallback
    return res.json({
      message: `Invalid input. Dial *789# to start.`,
      continueSession: false
    });

  } catch (error) {
    console.error('USSD Error:', error);
    return res.json({
      message: 'Service temporarily unavailable. Please try again.',
      continueSession: false
    });
  }
});

// Handle initial *789# dial
async function handleInitialDial(phoneNumber, sessionId, res) {
  const user = await userService.getUserByPhone(phoneNumber);
  
  if (!user) {
    // New user - registration flow
    await sessionService.setUserSession(sessionId, { 
      step: 'registration_choice',
      phone: phoneNumber 
    });
    
    return res.json({
      message: `OUH! Welcome. Choose your journey:
1-Create Wallet
2-Link Wallet`,
      continueSession: true
    });
  } else {
    // Existing user - show instructions
    return res.json({
      message: `Welcome back to OUH!
Dial *789*AMOUNT# to continue.
Example: *789*5000#`,
      continueSession: false
    });
  }
}

// Handle registration flow
async function handleRegistrationFlow(text, session, sessionId, phoneNumber, res) {
  if (!session || session.step !== 'registration_choice') return false;

  // Step 1: Choose registration type
  if (text === '1') {
    // Create Wallet
    await sessionService.updateUserSession(sessionId, { 
      step: 'create_pin',
      action: 'create_wallet'
    });
    
    res.json({
      message: `Set up 4-digit PIN for payment authorization:`,
      continueSession: true
    });
    return true;
  }

  if (text === '2') {
    // Link Wallet
    await sessionService.updateUserSession(sessionId, { 
      step: 'enter_wallet',
      action: 'link_wallet'
    });
    
    res.json({
      message: `Enter your wallet address:`,
      continueSession: true
    });
    return true;
  }

  // Step 2: Handle PIN setup for create wallet
  if (session.action === 'create_wallet' && session.step === 'create_pin') {
    if (/^\d{4}$/.test(text)) {
      if (!session.pin) {
        // First PIN entry
        await sessionService.updateUserSession(sessionId, { 
          step: 'confirm_pin',
          pin: text 
        });
        
        res.json({
          message: `Confirm PIN:`,
          continueSession: true
        });
        return true;
      }
    } else {
      res.json({
        message: `PIN must be 4 digits. Try again:`,
        continueSession: true
      });
      return true;
    }
  }

  // Step 3: Confirm PIN for create wallet
  if (session.action === 'create_wallet' && session.step === 'confirm_pin') {
    if (/^\d{4}$/.test(text)) {
      if (session.pin === text) {
        // Create user account
        const user = await userService.createUser(phoneNumber, text);
        
        if (user) {
          await sessionService.clearUserSession(sessionId);
          
          res.json({
            message: `PIN set successfully. Wallet created!
Dial *789*AMOUNT# anytime to buy crypto or airtime.`,
            continueSession: false
          });
          return true;
        } else {
          res.json({
            message: `Account creation failed. Please try again.`,
            continueSession: false
          });
          return true;
        }
      } else {
        await sessionService.updateUserSession(sessionId, { 
          step: 'create_pin',
          pin: null 
        });
        
        res.json({
          message: `PINs don't match. Set up 4-digit PIN:`,
          continueSession: true
        });
        return true;
      }
    } else {
      res.json({
        message: `PIN must be 4 digits. Confirm PIN:`,
        continueSession: true
      });
      return true;
    }
  }

  // Step 2: Handle wallet address for link wallet
  if (session.action === 'link_wallet' && session.step === 'enter_wallet') {
    // Basic wallet address validation (Solana addresses are base58, 32-44 chars)
    if (text.length >= 32 && text.length <= 44) {
      await sessionService.updateUserSession(sessionId, { 
        step: 'set_pin',
        wallet_address: text 
      });
      
      res.json({
        message: `Set up 4-digit PIN for payment authorization:`,
        continueSession: true
      });
      return true;
    } else {
      res.json({
        message: `Invalid wallet address. Enter valid Solana address:`,
        continueSession: true
      });
      return true;
    }
  }

  // Step 3: Set PIN for link wallet
  if (session.action === 'link_wallet' && session.step === 'set_pin') {
    if (/^\d{4}$/.test(text)) {
      // Create user with wallet address
      const user = await userService.createUser(phoneNumber, text, session.wallet_address);
      
      if (user) {
        await sessionService.clearUserSession(sessionId);
        
        res.json({
          message: `Wallet linked successfully!
Dial *789*AMOUNT# anytime to buy crypto or airtime.`,
          continueSession: false
        });
        return true;
      } else {
        res.json({
          message: `Wallet linking failed. Please try again.`,
          continueSession: false
        });
        return true;
      }
    } else {
      res.json({
        message: `PIN must be 4 digits. Try again:`,
        continueSession: true
      });
      return true;
    }
  }

  return false;
}

// Handle transaction flow
async function handleTransactionFlow(text, session, sessionId, phoneNumber, res) {
  // Parse amount from *789*5000# format
  const amount = parseInt(text) || 0;
  
  if (amount > 0) {
    // Check if user exists
    const user = await userService.getUserByPhone(phoneNumber);
    if (!user) {
      res.json({
        message: `Please register first by dialing *789#`,
        continueSession: false
      });
      return true;
    }

    // Validate amount
    const minAmount = parseInt(process.env.MIN_TRANSACTION_AMOUNT);
    const maxAmount = parseInt(process.env.MAX_TRANSACTION_AMOUNT);
    
    if (amount < minAmount) {
      res.json({
        message: `Minimum amount is ₦${minAmount.toLocaleString()}.
Try *789*${minAmount}#`,
        continueSession: false
      });
      return true;
    }
    
    if (amount > maxAmount) {
      res.json({
        message: `Maximum amount is ₦${maxAmount.toLocaleString()}.
Try a smaller amount.`,
        continueSession: false
      });
      return true;
    }

    // Show service selection
    const usdcAmount = CryptoUtils.formatUSDC(CryptoUtils.calculateUSDCAmount(amount));
    
    await sessionService.setUserSession(sessionId, { 
      step: 'service_selection',
      amount: amount,
      phone: phoneNumber 
    });
    
    res.json({
      message: `₦${amount.toLocaleString()} confirmed. Choose:
1-USDC (crypto, $${usdcAmount})
2-Airtime (₦${amount.toLocaleString()} credit)
Select:`,
      continueSession: true
    });
    return true;
  }

  // Handle service selection
  if (session && session.step === 'service_selection' && (text === '1' || text === '2')) {
    await sessionService.updateUserSession(sessionId, { 
      step: 'pin_verification',
      choice: text 
    });
    
    res.json({
      message: `Enter 4-digit PIN to authorize payment:`,
      continueSession: true
    });
    return true;
  }

  // Handle PIN verification
  if (session && session.step === 'pin_verification' && /^\d{4}$/.test(text)) {
    const auth = await userService.authenticateUser(session.phone, text);
    
    if (!auth.success) {
      res.json({
        message: `Incorrect PIN. Try again:`,
        continueSession: true
      });
      return true;
    }

    // Process transaction based on choice
    if (session.choice === '1') {
      await processCryptoTransaction(session, sessionId, res);
    } else {
      await processAirtimeTransaction(session, sessionId, res);
    }
    return true;
  }

  return false;
}

// Process crypto transaction
async function processCryptoTransaction(session, sessionId, res) {
  try {
    const txRef = CryptoUtils.generateTxRef('crypto', session.phone);
    const usdcAmount = CryptoUtils.calculateUSDCAmount(session.amount);
    
    const payment = await flutterwaveService.initiateUSSDPayment({
      amount: session.amount,
      phoneNumber: session.phone,
      email: `${session.phone.replace('0', '')}@ouh.app`,
      txRef: txRef,
      description: `OUH! Crypto Purchase - $${CryptoUtils.formatUSDC(usdcAmount)} USDC`
    });
    
    if (payment.status === 'success') {
      // Store transaction in database
      await pool.query(
        `INSERT INTO transactions (tx_id, user_phone, tx_type, amount_ngn, amount_usdc, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [txRef, session.phone, 'crypto', session.amount, Math.floor(parseFloat(usdcAmount) * 1000000), 'pending']
      );
      
      await sessionService.clearUserSession(sessionId);
      
      res.json({
        message: `Processing payment...
You'll get $${CryptoUtils.formatUSDC(usdcAmount)} USDC
Dial: ${payment.payment_code}
Ref: ${txRef.substring(0, 12)}...`,
        continueSession: false
      });
    } else {
      res.json({
        message: `Payment initialization failed. Please try again.`,
        continueSession: false
      });
    }
    
  } catch (error) {
    console.error('Crypto transaction error:', error);
    res.json({
      message: `Transaction failed. Please try again.`,
      continueSession: false
    });
  }
}

// Process airtime transaction
async function processAirtimeTransaction(session, sessionId, res) {
  try {
    const network = PhoneUtils.detectNetwork(session.phone);
    const txRef = CryptoUtils.generateTxRef('airtime', session.phone);
    
    const airtimeResult = await flutterwaveService.buyAirtime({
      phoneNumber: session.phone,
      amount: session.amount,
      network: network
    });
    
    if (airtimeResult.status === 'success') {
      // Store successful transaction
      await pool.query(
        `INSERT INTO transactions (tx_id, user_phone, tx_type, amount_ngn, status, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [airtimeResult.reference, session.phone, 'airtime', session.amount, 'completed']
      );
      
      await sessionService.clearUserSession(sessionId);
      
      res.json({
        message: `Success! ₦${session.amount.toLocaleString()} ${network} airtime sent to ${PhoneUtils.formatForDisplay(session.phone)}.
Thank you for using OUH!`,
        continueSession: false
      });
    } else {
      res.json({
        message: `Airtime purchase failed: ${airtimeResult.message}
Please try again.`,
        continueSession: false
      });
    }
    
  } catch (error) {
    console.error('Airtime transaction error:', error);
    res.json({
      message: `Airtime purchase failed. Please try again.`,
      continueSession: false
    });
  }
}

module.exports = router;
