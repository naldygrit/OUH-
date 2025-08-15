const rateLimit = require('express-rate-limit');

/**
 * Enhanced rate limiter factory with comprehensive security features
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} max - Maximum requests per window
 * @param {string} message - Error message for rate limit exceeded
 * @param {function} keyGenerator - Function to generate rate limit key
 * @param {object} options - Additional options
 * @returns {function} Express middleware function
 */
const createSecureRateLimiter = (windowMs, max, message, keyGenerator = null, options = {}) => {
  return rateLimit({
    windowMs,
    max,
    message: { 
      error: message,
      retryAfter: Math.ceil(windowMs / 1000),
      securityLevel: 'enhanced',
      timestamp: () => new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyGenerator || ((req) => req.ip),
    skip: (req) => {
      // Skip rate limiting for health checks and monitoring endpoints
      return req.path.includes('/health') || 
             req.path.includes('/metrics') || 
             req.path.includes('/status');
    },
    handler: (req, res) => {
      const identifier = (keyGenerator ? keyGenerator(req) : req.ip);
      const maskedIdentifier = identifier.substring(0, 8) + '****';
      
      console.warn(`⚠️ Rate limit exceeded:`, {
        identifier: maskedIdentifier,
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent')?.substring(0, 50),
        timestamp: new Date().toISOString(),
        windowMs: windowMs,
        maxRequests: max
      });
      
      // Log security event for monitoring
      console.log(` Security Event: Rate Limit Violation`, {
        type: 'RATE_LIMIT_EXCEEDED',
        identifier: maskedIdentifier,
        path: req.path,
        method: req.method,
        userAgent: req.get('User-Agent')?.substring(0, 50),
        timestamp: new Date().toISOString(),
        severity: 'MEDIUM'
      });
      
      res.status(429).json({
        error: message,
        retryAfter: Math.ceil(windowMs / 1000),
        securityLevel: 'enhanced',
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] || 'unknown'
      });
    },
    ...options
  });
};

// General API rate limiting (generous for normal use)
const generalLimiter = createSecureRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests per window
  'Too many requests. Please try again later.',
  null,
  {
    message: {
      error: 'Too many requests from this IP. Please try again later.',
      type: 'GENERAL_RATE_LIMIT'
    }
  }
);

// USSD-specific rate limiting (more restrictive for sensitive operations)
const ussdLimiter = createSecureRateLimiter(
  5 * 60 * 1000, // 5 minutes
  15, // 15 USSD requests per 5 minutes
  'Too many USSD requests. Please wait before trying again.',
  (req) => {
    // Rate limit by phone number if available, otherwise IP
    const phone = req.body?.phoneNumber;
    return phone ? `phone:${phone}` : `ip:${req.ip}`;
  },
  {
    message: {
      error: 'Too many USSD requests. Please wait before trying again.',
      type: 'USSD_RATE_LIMIT'
    }
  }
);

// PIN attempt rate limiting (very restrictive for security)
const pinLimiter = createSecureRateLimiter(
  60 * 60 * 1000, // 1 hour
  5, // 5 PIN attempts per hour
  'Too many PIN attempts. Account temporarily locked for security.',
  (req) => {
    const phone = req.body?.phoneNumber;
    return phone ? `pin:${phone}` : `pin_ip:${req.ip}`;
  },
  {
    skipSuccessfulRequests: true, // Only count failed attempts
    message: {
      error: 'Too many PIN attempts. Account temporarily locked for security.',
      type: 'PIN_RATE_LIMIT',
      severity: 'HIGH'
    }
  }
);

// Registration rate limiting (prevent spam registrations)
const registrationLimiter = createSecureRateLimiter(
  24 * 60 * 60 * 1000, // 24 hours
  3, // 3 registrations per day per identifier
  'Too many registration attempts. Please try again tomorrow.',
  (req) => {
    const phone = req.body?.phoneNumber;
    return phone ? `reg:${phone}` : `reg_ip:${req.ip}`;
  },
  {
    message: {
      error: 'Too many registration attempts. Please try again tomorrow.',
      type: 'REGISTRATION_RATE_LIMIT'
    }
  }
);

// Transaction rate limiting (prevent rapid transactions)
const transactionLimiter = createSecureRateLimiter(
  10 * 60 * 1000, // 10 minutes
  5, // 5 transactions per 10 minutes
  'Too many transactions. Please wait before making another transaction.',
  (req) => {
    const phone = req.body?.phoneNumber;
    return phone ? `tx:${phone}` : `tx_ip:${req.ip}`;
  },
  {
    message: {
      error: 'Too many transactions. Please wait before making another transaction.',
      type: 'TRANSACTION_RATE_LIMIT'
    }
  }
);

// Aggressive rate limiting for suspicious activity
const suspiciousActivityLimiter = createSecureRateLimiter(
  60 * 1000, // 1 minute
  10, // 10 requests per minute
  'Suspicious activity detected. Access temporarily restricted.',
  (req) => `suspicious:${req.ip}`,
  {
    message: {
      error: 'Suspicious activity detected. Access temporarily restricted.',
      type: 'SUSPICIOUS_ACTIVITY_LIMIT',
      severity: 'CRITICAL'
    }
  }
);

// Export all rate limiters
module.exports = {
  generalLimiter,
  ussdLimiter,
  pinLimiter,
  registrationLimiter,
  transactionLimiter,
  suspiciousActivityLimiter,
  createSecureRateLimiter
};
