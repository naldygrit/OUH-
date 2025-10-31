/**
 * Enhanced in-memory User Registry for development
 * ------------------------------------------------
 * - Normalizes phone numbers to local Nigerian format (e.g., 0803...)
 * - Single source of truth for per-user metadata
 * - Backward-compatible simple registration set (registeredUsers)
 * - Convenient upsert() + safe updateUser() semantics
 * - Useful stats + debug helpers
 *
 * In production, replace the Map/Set with a durable database layer while
 * keeping this exact public interface to avoid touching callers.
 */

'use strict';

/** Normalize a phone to local format: "+234xxxxxxxxxx" -> "0xxxxxxxxxx" */
const normalizePhone = (p) => String(p || '').replace(/^\+234/, '0');

/** Mask a phone for logs */
const maskPhone = (p) => {
  const s = String(p || '');
  return s.length >= 4 ? `${s.slice(0, 4)}****` : '****';
};

class UserRegistry {
  constructor() {
    /**
     * Back-compat: callers might only care that a phone is "registered".
     * We still maintain this Set for quick membership queries.
     */
    this.registeredUsers = new Set();

    /**
     * Primary store for structured user data.
     * Key: normalized phone (e.g., 0803xxxxxxx)
     * Value: object { phone, walletAddress?, pinHash?, alias?, registeredAt, updatedAt, ... }
     */
    this.userData = new Map();

    console.log('📋 Enhanced User Registry initialized (in-memory)');
  }

  // ---------------------------------------------------------------------------
  // Core helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensure a phone is present in the simple membership Set.
   */
  #ensureMembership(key) {
    if (!this.registeredUsers.has(key)) this.registeredUsers.add(key);
  }

  /**
   * Return an existing record or a new base record (without saving).
   */
  #baseRecord(key) {
    const existing = this.userData.get(key);
    if (existing) return existing;
    return { phone: key, registeredAt: Date.now(), updatedAt: Date.now() };
  }

  // ---------------------------------------------------------------------------
  // Public API (stable)
  // ---------------------------------------------------------------------------

  /**
   * Simple registration (backward compatible).
   * Adds the phone to membership and creates a base record if none exists.
   */
  register(phoneNumber) {
    const key = normalizePhone(phoneNumber);
    this.#ensureMembership(key);
    if (!this.userData.has(key)) {
      this.userData.set(key, this.#baseRecord(key));
    }
    console.log(`✅ User registered: ${maskPhone(key)}`);
  }

  /**
   * Rich registration with initial data payload (e.g., walletAddress, alias).
   * Always normalizes phone and guarantees a stored record.
   */
  registerUser(phoneNumber, data = {}) {
    const key = normalizePhone(phoneNumber);
    this.#ensureMembership(key);

    const next = {
      ...this.#baseRecord(key),
      ...data,
      phone: key,
      registeredAt: data.registeredAt || Date.now(),
      updatedAt: Date.now(),
    };

    this.userData.set(key, next);
    console.log(`✅ User registered with data: ${maskPhone(key)}`, {
      hasWallet: !!next.walletAddress,
      walletType: next.walletType || null,
    });
    return next;
  }

  /**
   * Upsert convenience: creates a record if missing, or merges with existing.
   * Returned object is the current stored value after merge.
   */
  upsert(phoneNumber, data = {}) {
    const key = normalizePhone(phoneNumber);
    this.#ensureMembership(key);

    const existing = this.userData.get(key) || this.#baseRecord(key);
    const next = {
      ...existing,
      ...data,
      phone: key,
      // keep earliest registeredAt; prefer provided value if explicitly set
      registeredAt: data.registeredAt ?? existing.registeredAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    this.userData.set(key, next);
    console.log(`📝 User upserted: ${maskPhone(key)}`);
    return next;
  }

  /**
   * Safe partial update; throws if phone is not registered.
   */
  updateUser(phoneNumber, updates = {}) {
    const key = normalizePhone(phoneNumber);
    if (!this.isRegistered(key)) {
      throw new Error('User not registered');
    }

    const existing = this.userData.get(key) || this.#baseRecord(key);
    const next = {
      ...existing,
      ...updates,
      phone: key,
      updatedAt: Date.now(),
    };

    this.userData.set(key, next);
    console.log(`📝 User data updated: ${maskPhone(key)}`);
    return next;
  }

  /**
   * Returns whether a phone is known to the registry (simple membership).
   */
  isRegistered(phoneNumber) {
    const key = normalizePhone(phoneNumber);
    return this.registeredUsers.has(key);
  }

  /**
   * Fetch the full stored record (or null if missing).
   */
  getUserData(phoneNumber) {
    const key = normalizePhone(phoneNumber);
    return this.userData.get(key) || null;
  }

  /**
   * Return a list of all registered (normalized) phone numbers.
   */
  getAll() {
    return Array.from(this.registeredUsers);
  }

  /**
   * Human-friendly listing for debugging / dashboards.
   * Wallets are masked to avoid leaking full addresses in logs.
   */
  getAllUsersWithData() {
    return Array.from(this.userData.entries()).map(([phone, data]) => ({
      phoneNumber: maskPhone(phone),
      ...data,
      walletAddress: data.walletAddress
        ? `${data.walletAddress.slice(0, 4)}...${data.walletAddress.slice(-4)}`
        : null,
    }));
  }

  /**
   * Find the normalized phone number by an exact wallet address.
   */
  findByWallet(walletAddress) {
    if (!walletAddress) return null;
    for (const [phone, data] of this.userData.entries()) {
      if (data.walletAddress === walletAddress) return phone;
    }
    return null;
  }

  /**
   * True if any user is linked to this exact wallet address.
   */
  isWalletLinked(walletAddress) {
    return this.findByWallet(walletAddress) !== null;
  }

  /**
   * Clear all state (useful for tests/dev reset).
   */
  clear() {
    this.registeredUsers.clear();
    this.userData.clear();
    console.log('🗑️ User registry cleared');
  }

  /**
   * Aggregate statistics for monitoring.
   */
  getStats() {
    const usersWithWallets = Array.from(this.userData.values()).filter(u => u.walletAddress).length;
    return {
      totalUsers: this.registeredUsers.size,
      usersWithData: this.userData.size,
      usersWithWallets,
      linkedWallets: usersWithWallets,
      simpleRegistrations: Math.max(this.registeredUsers.size - this.userData.size, 0),
      updatedAt: Date.now(),
    };
  }

  /**
   * Debug-only dump of the raw Map content (unmasked). Do not expose in prod APIs.
   */
  _debugDump() {
    return Object.fromEntries(this.userData.entries());
  }
}

module.exports = new UserRegistry();
