const axios = require('axios');
const crypto = require('crypto');

class FlutterwaveService {
  constructor() {
    this.baseURL = process.env.FLUTTERWAVE_BASE_URL;
    this.secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
    this.publicKey = process.env.FLUTTERWAVE_PUBLIC_KEY;
    this.encryptionKey = process.env.FLUTTERWAVE_ENCRYPTION_KEY;
  }

  // Initialize USSD payment
  async initiateUSSDPayment({ amount, phoneNumber, email, txRef }) {
    try {
      const payload = {
        tx_ref: txRef,
        amount: amount,
        currency: 'NGN',
        payment_options: 'ussd',
        customer: {
          email: email,
          phonenumber: phoneNumber,
          name: `OUH User ${phoneNumber}`
        },
        customizations: {
          title: 'OUH! Crypto Onramp',
          description: 'Buy crypto or airtime via USSD',
          logo: 'https://your-logo-url.com/logo.png'
        },
        redirect_url: `${process.env.BASE_URL}/payment/callback`,
        meta: {
          phoneNumber,
          source: 'ussd'
        }
      };

      const response = await axios.post(
        `${this.baseURL}/payments`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Flutterwave USSD Payment Error:', error.response?.data);
      throw new Error('Failed to initiate USSD payment');
    }
  }

  // Buy airtime via Flutterwave
  async buyAirtime({ phoneNumber, amount, network }) {
    try {
      const payload = {
        phone_number: phoneNumber,
        amount: amount,
        recurrence: 'ONCE',
        type: network.toUpperCase(), // MTN, AIRTEL, GLO, 9MOBILE
        reference: `OUH_AIRTIME_${Date.now()}`
      };

      const response = await axios.post(
        `${this.baseURL}/bills`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Flutterwave Airtime Error:', error.response?.data);
      throw new Error('Failed to buy airtime');
    }
  }

  // Verify transaction
  async verifyTransaction(transactionId) {
    try {
      const response = await axios.get(
        `${this.baseURL}/transactions/${transactionId}/verify`,
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Transaction Verification Error:', error.response?.data);
      throw new Error('Failed to verify transaction');
    }
  }

  // Validate webhook signature
  validateWebhook(payload, signature) {
    const expectedSignature = crypto
      .createHmac('sha256', process.env.FLUTTERWAVE_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return signature === expectedSignature;
  }
}

module.exports = new FlutterwaveService();
