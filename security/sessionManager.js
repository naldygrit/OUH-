const crypto = require('crypto');

class SecureSessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionTimeout = 5 * 60 * 1000; // 5 minutes
    this.encryptionKey = this.deriveKey(process.env.SESSION_SECRET || 'default_session_secret_change_in_production');
    this.maxSessions = 10000; // Prevent memory exhaustion
    
    // Cleanup expired sessions every minute
    setInterval(() => this.cleanupExpiredSessions(), 60000);
    
    console.log(' Secure Session Manager initialized');
  }

  deriveKey(secret) {
    return crypto.scryptSync(secret, 'session_salt_ouh_2024', 32);
  }

  createSession(sessionId, phoneNumber, data = {}) {
    // Prevent session flooding
    if (this.sessions.size >= this.maxSessions) {
      this.cleanupExpiredSessions();
      if (this.sessions.size >= this.maxSessions) {
        throw new Error('Session limit reached. Please try again later.');
      }
    }

    const sessionData = {
      sessionId,
      phoneNumber: phoneNumber.substring(0, 4) + '****', // Mask for security
      originalPhone: phoneNumber, // Keep for validation
      ...data,
      createdAt: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
      lastActivity: Date.now(),
      attempts: 0,
      securityToken: crypto.randomBytes(32).toString('hex'),
      ipAddress: null, // Will be set by middleware
      userAgent: null, // Will be set by middleware
      securityLevel: data.securityLevel || 'standard'
    };

    // Encrypt session data
    const encryptedData = this.encrypt(JSON.stringify(sessionData));
    
    // Store with expiry and metadata
    this.sessions.set(sessionId, {
      data: encryptedData,
      expiry: Date.now() + this.sessionTimeout,
      nonce: sessionData.nonce,
      createdAt: sessionData.createdAt,
      phoneHash: crypto.createHash('sha256').update(phoneNumber).digest('hex').substring(0, 8)
    });

    console.log(` Created secure session: ${sessionId.slice(-8)} for ${sessionData.phoneNumber} (Level: ${sessionData.securityLevel})`);
    return sessionData.nonce;
  }

  getSession(sessionId, expectedNonce = null) {
    const sessionEntry = this.sessions.get(sessionId);
    
    if (!sessionEntry) {
      console.log(`❌ Session not found: ${sessionId?.slice(-8)}`);
      return null;
    }
    
    if (Date.now() > sessionEntry.expiry) {
      this.sessions.delete(sessionId);
      console.log(`⏰ Session expired: ${sessionId?.slice(-8)}`);
      return null;
    }

    // Validate nonce if provided (prevents replay attacks)
    if (expectedNonce && sessionEntry.nonce !== expectedNonce) {
      console.warn(`⚠️ Session nonce mismatch for ${sessionId?.slice(-8)} - potential replay attack`);
      this.destroySession(sessionId);
      return null;
    }

    try {
      const decryptedData = this.decrypt(sessionEntry.data);
      const session = JSON.parse(decryptedData);
      
      // Update last activity
      session.lastActivity = Date.now();
      
      // Extend session expiry on activity
      sessionEntry.expiry = Date.now() + this.sessionTimeout;
      
      // Re-encrypt and store updated session
      sessionEntry.data = this.encrypt(JSON.stringify(session));
      
      return session;
    } catch (error) {
      console.error(`❌ Session decryption failed for ${sessionId?.slice(-8)}:`, error);
      this.destroySession(sessionId);
      return null;
    }
  }

  updateSession(sessionId, sessionData) {
    const sessionEntry = this.sessions.get(sessionId);
    if (!sessionEntry) {
      console.log(`❌ Cannot update non-existent session: ${sessionId?.slice(-8)}`);
      return false;
    }

    try {
      // Update timestamp
      sessionData.lastActivity = Date.now();
      
      // Encrypt updated data
      const encryptedData = this.encrypt(JSON.stringify(sessionData));
      sessionEntry.data = encryptedData;
      sessionEntry.expiry = Date.now() + this.sessionTimeout;
      
      return true;
    } catch (error) {
      console.error(`❌ Session update failed for ${sessionId?.slice(-8)}:`, error);
      return false;
    }
  }

  destroySession(sessionId) {
    const sessionEntry = this.sessions.get(sessionId);
    if (!sessionEntry) {
      return false;
    }

    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      console.log(` Destroyed session: ${sessionId?.slice(-8)} (Hash: ${sessionEntry.phoneHash})`);
    }
    return deleted;
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, sessionEntry] of this.sessions.entries()) {
      if (now > sessionEntry.expiry) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired sessions (Total: ${this.sessions.size})`);
    }
  }

  // Security: Check for suspicious session patterns
  getSessionsByPhoneHash(phoneHash) {
    const sessions = [];
    for (const [sessionId, sessionEntry] of this.sessions.entries()) {
      if (sessionEntry.phoneHash === phoneHash) {
        sessions.push({
          sessionId: sessionId.slice(-8),
          createdAt: sessionEntry.createdAt,
          expiry: sessionEntry.expiry
        });
      }
    }
    return sessions;
  }

  // Enhanced encryption with authentication
  encrypt(text) {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('❌ Encryption error:', error);
      throw new Error('Session encryption failed');
    }
  }

  decrypt(text) {
    try {
      const textParts = text.split(':');
      if (textParts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }
      
      const iv = Buffer.from(textParts[0], 'hex');
      const authTag = Buffer.from(textParts[1], 'hex');
      const encryptedText = textParts[2];
      
      const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('❌ Decryption error:', error);
      throw new Error('Session decryption failed');
    }
  }

  getSessionStats() {
    const now = Date.now();
    let activeSessions = 0;
    let expiringSoon = 0;
    
    for (const sessionEntry of this.sessions.values()) {
      if (now < sessionEntry.expiry) {
        activeSessions++;
        if (sessionEntry.expiry - now < 60000) { // Expiring in 1 minute
          expiringSoon++;
        }
      }
    }
    
    return {
      totalSessions: this.sessions.size,
      activeSessions,
      expiringSoon,
      maxSessions: this.maxSessions,
      memoryUsage: Math.round((this.sessions.size * 1024) / 1024) + 'KB', // Rough estimate
      timestamp: new Date().toISOString()
    };
  }

  // Security monitoring
  getSecurityReport() {
    const stats = this.getSessionStats();
    const phoneHashes = new Set();
    
    for (const sessionEntry of this.sessions.values()) {
      phoneHashes.add(sessionEntry.phoneHash);
    }
    
    return {
      ...stats,
      uniquePhones: phoneHashes.size,
      avgSessionsPerPhone: Math.round(stats.activeSessions / Math.max(phoneHashes.size, 1) * 100) / 100,
      securityLevel: 'ENHANCED',
      encryptionEnabled: true,
      nonceValidation: true
    };
  }
}

module.exports = new SecureSessionManager();
