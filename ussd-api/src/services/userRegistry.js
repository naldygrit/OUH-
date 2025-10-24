/**
 * Enhanced in-memory user registry for development
 * Stores both phone numbers and associated user data
 * In production, this would be replaced with a database
 */
class UserRegistry {
  constructor() {
    this.registeredUsers = new Set(); // For backward compatibility
    this.userData = new Map(); // Store full user data
    console.log('📋 Enhanced User Registry initialized (in-memory)');
  }

  /**
   * Register a user (simple registration - backward compatible)
   * @param {string} phoneNumber - User's phone number
   */
  register(phoneNumber) {
    this.registeredUsers.add(phoneNumber);
    console.log(`✅ User registered in registry: ${phoneNumber.substring(0, 4)}****`);
  }

  /**
   * Register a user with full data (for wallet linking)
   * @param {string} phoneNumber - User's phone number
   * @param {object} data - User data (phoneHash, pinHash, walletAddress, etc.)
   */
  registerUser(phoneNumber, data) {
    this.registeredUsers.add(phoneNumber);
    this.userData.set(phoneNumber, {
      ...data,
      registeredAt: data.registeredAt || Date.now(),
      updatedAt: Date.now()
    });
    console.log(`✅ User registered with data: ${phoneNumber.substring(0, 4)}****`, {
      walletType: data.walletType,
      hasWallet: !!data.walletAddress,
      cluster: data.cluster
    });
  }

  /**
   * Check if user is registered
   * @param {string} phoneNumber - User's phone number
   * @returns {boolean}
   */
  isRegistered(phoneNumber) {
    return this.registeredUsers.has(phoneNumber);
  }

  /**
   * Get user data
   * @param {string} phoneNumber - User's phone number
   * @returns {object|null} User data or null if not found
   */
  getUserData(phoneNumber) {
    return this.userData.get(phoneNumber) || null;
  }

  /**
   * Update user data
   * @param {string} phoneNumber - User's phone number
   * @param {object} updates - Data to update
   */
  updateUser(phoneNumber, updates) {
    if (!this.isRegistered(phoneNumber)) {
      throw new Error('User not registered');
    }

    const existingData = this.userData.get(phoneNumber) || {};
    this.userData.set(phoneNumber, {
      ...existingData,
      ...updates,
      updatedAt: Date.now()
    });

    console.log(`📝 User data updated: ${phoneNumber.substring(0, 4)}****`);
  }

  /**
   * Get all registered phone numbers
   * @returns {Array<string>}
   */
  getAll() {
    return Array.from(this.registeredUsers);
  }

  /**
   * Get all users with full data
   * @returns {Array<object>}
   */
  getAllUsersWithData() {
    return Array.from(this.userData.entries()).map(([phone, data]) => ({
      phoneNumber: phone.substring(0, 4) + '****',
      ...data,
      walletAddress: data.walletAddress 
        ? data.walletAddress.substring(0, 4) + '...' + data.walletAddress.substring(data.walletAddress.length - 4)
        : null
    }));
  }

  /**
   * Find user by wallet address
   * @param {string} walletAddress - Solana wallet address
   * @returns {string|null} Phone number or null
   */
  findByWallet(walletAddress) {
    for (const [phone, data] of this.userData.entries()) {
      if (data.walletAddress === walletAddress) {
        return phone;
      }
    }
    return null;
  }

  /**
   * Check if wallet is already linked
   * @param {string} walletAddress - Solana wallet address
   * @returns {boolean}
   */
  isWalletLinked(walletAddress) {
    return this.findByWallet(walletAddress) !== null;
  }

  /**
   * Clear all data
   */
  clear() {
    this.registeredUsers.clear();
    this.userData.clear();
    console.log('🗑️ User registry cleared');
  }

  /**
   * Get registry statistics
   * @returns {object}
   */
  getStats() {
    const usersWithWallets = Array.from(this.userData.values())
      .filter(data => data.walletAddress).length;

    return {
      totalUsers: this.registeredUsers.size,
      usersWithData: this.userData.size,
      usersWithWallets: usersWithWallets,
      linkedWallets: usersWithWallets,
      simpleRegistrations: this.registeredUsers.size - this.userData.size
    };
  }
}

module.exports = new UserRegistry();
