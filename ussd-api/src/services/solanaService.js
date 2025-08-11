const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { AnchorProvider, Program, web3 } = require('@coral-xyz/anchor');
const crypto = require('crypto');

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
    
    this.connection = new Connection(this.rpcUrl);
    this.programId = new PublicKey(this.programIdString);
    
    // Log current configuration
    console.log(`🔗 Solana Service initialized:`);
    console.log(`   Cluster: ${this.cluster.toUpperCase()}`);
    console.log(`   RPC: ${this.rpcUrl}`);
    console.log(`   Program: ${this.programIdString}`);
    console.log(`   Explorer: ${this.getExplorerUrl()}`);
  }

  getExplorerUrl() {
    const clusterParam = this.cluster === 'devnet' ? '?cluster=devnet' : '?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899';
    return `https://explorer.solana.com/address/${this.programIdString}${clusterParam}`;
  }

  // Convert phone number to bytes[14] format
  phoneToBytes(phoneNumber) {
    const phone = phoneNumber.replace(/\D/g, ''); // Remove non-digits
    const buffer = Buffer.alloc(14);
    buffer.write(phone.substring(0, 14), 'utf8');
    return Array.from(buffer);
  }

  // Hash PIN securely
  hashPin(pin) {
    const hash = crypto.createHash('sha256');
    hash.update(pin);
    return Array.from(hash.digest());
  }

  // Get user PDA
  async getUserPDA(phoneNumber) {
    const phoneBytes = this.phoneToBytes(phoneNumber);
    const [userPDA] = await PublicKey.findProgramAddress(
      [Buffer.from('user'), Buffer.from(phoneBytes)],
      this.programId
    );
    return userPDA;
  }

  // Check if user exists
  async userExists(phoneNumber) {
    try {
      const userPDA = await this.getUserPDA(phoneNumber);
      const accountInfo = await this.connection.getAccountInfo(userPDA);
      const exists = accountInfo !== null;
      
      console.log(`👤 User check [${this.cluster}]:`, {
        phone: phoneNumber,
        exists: exists,
        pda: userPDA.toString().slice(0, 8) + '...'
      });
      
      return exists;
    } catch (error) {
      console.log('❌ Error checking user:', error.message);
      return false;
    }
  }

  // Register new user
  async registerUser(phoneNumber, pin) {
    try {
      const phoneBytes = this.phoneToBytes(phoneNumber);
      const pinHash = this.hashPin(pin);
      const userPDA = await this.getUserPDA(phoneNumber);
      
      console.log(`📝 Registering user [${this.cluster}]:`, {
        phone: phoneNumber,
        pda: userPDA.toString().slice(0, 8) + '...',
        cluster: this.cluster
      });
      
      // This would call your register_user instruction
      return {
        success: true,
        userPDA: userPDA.toString(),
        wallet: userPDA.toString(),
        cluster: this.cluster,
        explorerUrl: `https://explorer.solana.com/address/${userPDA.toString()}${this.cluster === 'devnet' ? '?cluster=devnet' : '?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899'}`
      };
    } catch (error) {
      console.error('❌ Registration error:', error);
      return { success: false, error: error.message };
    }
  }

  // Create transaction
  async createTransaction(phoneNumber, txType, amountNGN, amountUSDC = null) {
    try {
      const txId = crypto.randomBytes(16);
      const phoneBytes = this.phoneToBytes(phoneNumber);
      
      console.log(`💰 Creating transaction [${this.cluster}]:`, {
        phone: phoneNumber,
        type: txType,
        amountNGN,
        cluster: this.cluster
      });

      // This would call your create_transaction instruction
      return {
        success: true,
        txId: txId.toString('hex'),
        amountNGN,
        amountUSDC,
        cluster: this.cluster
      };
    } catch (error) {
      console.error('❌ Transaction creation error:', error);
      return { success: false, error: error.message };
    }
  }

  // Get current NGN to USDC rate (placeholder for Pyth integration)
  async getNGNToUSDCRate() {
    // TODO: Integrate with Pyth Network
    return parseInt(process.env.DEFAULT_EXCHANGE_RATE) || 1531; // Mock rate: 1 USDC = 1531 NGN
  }

  // Calculate crypto purchase
  async calculateCryptoPurchase(amountNGN) {
    const rate = await this.getNGNToUSDCRate();
    const fee = Math.floor(amountNGN * 0.05); // 5% fee
    const netAmount = amountNGN - fee;
    const usdcAmount = netAmount / rate;
    
    return {
      amountNGN,
      fee,
      netAmount,
      usdcAmount: Math.floor(usdcAmount * 1000000), // Convert to micro-USDC
      rate,
      cluster: this.cluster
    };
  }

  // Health check
  async healthCheck() {
    try {
      const accountInfo = await this.connection.getAccountInfo(this.programId);
      return {
        connected: accountInfo !== null,
        programId: this.programIdString,
        cluster: this.cluster,
        rpcUrl: this.rpcUrl,
        explorerUrl: this.getExplorerUrl()
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        cluster: this.cluster,
        rpcUrl: this.rpcUrl
      };
    }
  }
}

module.exports = new SolanaService();
