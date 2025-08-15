const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Import security middleware
const { generalLimiter, ussdLimiter, suspiciousActivityLimiter } = require('./middleware/rateLimiter');
const sessionManager = require('./security/sessionManager');

// Import routes
const ussdRoutes = require('./routes/ussd');

/**
 * Enhanced OUH! USSD API Application
 * Version: 2.0.0
 * Security Level: ENHANCED
 * Features:
 * - Multi-tier rate limiting
 * - Session encryption with nonce validation
 * - Comprehensive security monitoring
 * - Real-time threat detection
 * - Graceful shutdown handling
 */

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3002;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security configuration
const SECURITY_CONFIG = {
  enabled: process.env.SECURITY_MONITORING_ENABLED === 'true',
  level: 'ENHANCED',
  version: '2.0.0'
};

console.log('🚀 Initializing OUH! USSD API...');
console.log(`   Environment: ${NODE_ENV}`);
console.log(`   Security Level: ${SECURITY_CONFIG.level}`);
console.log(`   Port: ${PORT}`);

// Enhanced security middleware stack
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true
}));

// Enhanced CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('🚨 CORS blocked origin:', origin);
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'X-Request-ID',
    'User-Agent'
  ],
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours
}));

// Request logging and security monitoring
app.use(morgan('combined', {
  skip: (req, res) => {
    // Skip logging for health checks to reduce noise
    return req.path.includes('/health') && req.method === 'GET';
  }
}));

// Security monitoring middleware
app.use((req, res, next) => {
  // Add security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'X-API-Version': '2.0.0',
    'X-Security-Level': 'ENHANCED'
  });

  // Generate unique request ID for tracking
  req.requestId = require('crypto').randomBytes(8).toString('hex');
  res.set('X-Request-ID', req.requestId);

  // Log security-relevant requests
  if (req.path.includes('/ussd') || req.path.includes('/api')) {
    console.log(`🔍 API Request:`, {
      id: req.requestId,
     method: req.method,
     path: req.path,
     ip: req.ip,
     userAgent: req.get('User-Agent')?.substring(0, 100),
     contentType: req.get('Content-Type'),
     contentLength: req.get('Content-Length'),
     timestamp: new Date().toISOString()
   });
 }

 // Detect suspicious patterns
 if (SECURITY_CONFIG.enabled) {
   const suspiciousPatterns = [
     /[<>\"'%;()&+\x00-\x1f\x7f-\x9f]/g, // Potential injection
     /union.*select/i, // SQL injection
     /<script/i, // XSS
     /javascript:/i, // XSS
     /eval\(/i, // Code injection
   ];

   const userAgent = req.get('User-Agent') || '';
   const referer = req.get('Referer') || '';
   const url = req.originalUrl;

   for (const pattern of suspiciousPatterns) {
     if (pattern.test(userAgent) || pattern.test(referer) || pattern.test(url)) {
       console.warn('🚨 Suspicious request detected:', {
         pattern: pattern.toString(),
         ip: req.ip,
         userAgent: userAgent.substring(0, 100),
         url: url,
         timestamp: new Date().toISOString()
       });
       
       // Apply aggressive rate limiting for suspicious requests
       return suspiciousActivityLimiter(req, res, next);
     }
   }
 }

 next();
});

// Apply rate limiting with proper order
console.log('🛡️ Applying security rate limiting...');
app.use('/api/', generalLimiter);
app.use('/api/ussd', ussdLimiter);

// Body parsing middleware with security limits
app.use(express.json({ 
 limit: '1mb',
 strict: true,
 type: 'application/json',
 verify: (req, res, buf, encoding) => {
   // Additional validation for JSON payload
   if (buf.length === 0) return;
   
   try {
     JSON.parse(buf);
   } catch (err) {
     console.warn('🚨 Invalid JSON detected:', {
       ip: req.ip,
       error: err.message,
       timestamp: new Date().toISOString()
     });
     throw new Error('Invalid JSON payload');
   }
 }
}));

app.use(express.urlencoded({ 
 extended: true, 
 limit: '1mb',
 parameterLimit: 100
}));

// Make session manager available to routes
app.use((req, res, next) => {
 req.sessionManager = sessionManager;
 next();
});

// Root endpoint with API information
app.get('/', (req, res) => {
 res.json({
   service: 'OUH! USSD API',
   version: '2.0.0',
   description: 'Secure Solana-based mobile money platform',
   security: 'ENHANCED',
   status: 'OPERATIONAL',
   timestamp: new Date().toISOString(),
   endpoints: {
     health: {
       general: 'GET /health',
       solana: 'GET /api/ussd/health/solana',
       security: 'GET /api/security/stats'
     },
     ussd: {
       start: 'POST /api/ussd/start',
       continue: 'POST /api/ussd/continue',
       end: 'POST /api/ussd/end',
       stats: 'GET /api/ussd/stats'
     }
   },
   documentation: {
     example_registration: {
       method: 'POST',
       url: '/api/ussd/start',
       body: {
         sessionId: 'registration_unique_id',
         phoneNumber: '08031234567'
       }
     },
     example_purchase: {
       method: 'POST',
       url: '/api/ussd/start',
       body: {
         sessionId: 'purchase_1000',
         phoneNumber: '08031234567'
       }
     }
   },
   features: [
     '🔐 End-to-end session encryption',
     '🛡️ Multi-tier rate limiting',
     '📱 Nigerian mobile number support',
     '💰 Solana blockchain integration',
     '⚡ Real-time crypto transactions',
     '📞 Instant airtime top-up',
     '🔍 Security monitoring',
     '🚀 High-performance architecture'
   ]
 });
});

// Enhanced health check endpoint
app.get('/health', (req, res) => {
 try {
   const healthData = {
     status: 'OK',
     timestamp: new Date().toISOString(),
     service: 'OUH! USSD API',
     version: '2.0.0',
     security: SECURITY_CONFIG.level,
     environment: NODE_ENV,
     uptime: {
       seconds: Math.floor(process.uptime()),
       human: formatUptime(process.uptime())
     },
     memory: {
       used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
       total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
       external: Math.round(process.memoryUsage().external / 1024 / 1024) + 'MB'
     },
     system: {
       nodeVersion: process.version,
       platform: process.platform,
       arch: process.arch,
       cpuUsage: process.cpuUsage()
     },
     features: {
       sessionEncryption: true,
       rateLimiting: true,
       inputValidation: true,
       pinHashing: true,
       nonceValidation: true,
       securityMonitoring: SECURITY_CONFIG.enabled,
       corsProtection: true,
       helmutSecurity: true
     },
     performance: {
       requestsHandled: 'Available in stats endpoint',
       averageResponseTime: 'Available in stats endpoint'
     }
   };

   res.json(healthData);
 } catch (error) {
   console.error('❌ Health check error:', error);
   res.status(500).json({
     status: 'ERROR',
     error: error.message,
     timestamp: new Date().toISOString()
   });
 }
});

// Enhanced security statistics endpoint
app.get('/api/security/stats', (req, res) => {
 try {
   const sessionReport = sessionManager.getSecurityReport();
   
   res.json({
     service: 'OUH! USSD API Security Analytics',
     version: '2.0.0',
     timestamp: new Date().toISOString(),
     security: {
       level: SECURITY_CONFIG.level,
       monitoring: SECURITY_CONFIG.enabled,
       sessions: sessionReport,
       server: {
         uptime: formatUptime(process.uptime()),
         environment: NODE_ENV,
         nodeVersion: process.version,
         memoryUsage: {
           heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
           external: Math.round(process.memoryUsage().external / 1024 / 1024) + 'MB'
         }
       },
       rateLimiting: {
         enabled: true,
         tiers: [
           'General API: 100 req/15min',
           'USSD: 15 req/5min',
           'PIN: 5 attempts/hour',
           'Registration: 3 req/day',
           'Suspicious: 10 req/min'
         ]
       },
       encryption: {
         algorithm: 'AES-256-GCM',
         sessionEncryption: true,
         pinHashing: 'PBKDF2-SHA256',
         iterations: 100000
       },
       headers: {
         hsts: true,
         csp: true,
         nosniff: true,
         xss: true,
         frameGuard: true,
         cors: true
       }
     },
     recommendations: [
       'Monitor security events regularly',
       'Review rate limiting logs',
       'Update security configurations',
       'Perform regular security audits'
     ]
   });
 } catch (error) {
   console.error('❌ Security stats error:', error);
   res.status(500).json({
     error: 'Failed to retrieve security statistics',
     timestamp: new Date().toISOString()
   });
 }
});

// System information endpoint (admin only)
app.get('/api/system/info', (req, res) => {
 // In production, add authentication here
 if (NODE_ENV === 'production') {
   return res.status(403).json({
     error: 'Access denied. Authentication required.',
     timestamp: new Date().toISOString()
   });
 }

 res.json({
   system: {
     nodeVersion: process.version,
     platform: process.platform,
     arch: process.arch,
     uptime: process.uptime(),
     memoryUsage: process.memoryUsage(),
     cpuUsage: process.cpuUsage(),
     pid: process.pid,
     ppid: process.ppid,
     execPath: process.execPath,
     version: process.version,
     versions: process.versions
   },
   environment: process.env,
   timestamp: new Date().toISOString()
 });
});

// API routes
app.use('/api/ussd', ussdRoutes);

// Enhanced 404 handler with security logging
app.use((req, res) => {
 console.log(`❌ 404 Not Found:`, {
   method: req.method,
   url: req.originalUrl,
   ip: req.ip,
   userAgent: req.get('User-Agent')?.substring(0, 100),
   referer: req.get('Referer'),
   timestamp: new Date().toISOString()
 });

 res.status(404).json({
   error: 'Endpoint not found',
   message: 'The requested resource does not exist',
   path: req.originalUrl,
   method: req.method,
   timestamp: new Date().toISOString(),
   available_endpoints: {
     general: [
       'GET /',
       'GET /health',
       'GET /api/security/stats'
     ],
     ussd: [
       'POST /api/ussd/start',
       'POST /api/ussd/continue', 
       'POST /api/ussd/end',
       'GET /api/ussd/health/solana',
       'GET /api/ussd/stats'
     ]
   },
   documentation: 'See GET / for API documentation'
 });
});

// Enhanced global error handler
app.use((err, req, res, next) => {
 // Determine error severity
 const isSecurityError = err.message.includes('rate') || 
                        err.message.includes('block') || 
                        err.message.includes('suspicious') ||
                        err.message.includes('invalid') ||
                        err.message.includes('unauthorized');

 const isCriticalError = err.status >= 500 || 
                        err.message.includes('database') ||
                        err.message.includes('connection') ||
                        err.message.includes('timeout');

 // Log error with appropriate level
 const logLevel = isCriticalError ? '🚨 CRITICAL' : 
                 isSecurityError ? '🔒 SECURITY' : '❌ ERROR';

 console.error(`${logLevel} Server Error:`, {
   message: err.message,
   stack: NODE_ENV === 'development' ? err.stack : undefined,
   url: req.originalUrl,
   method: req.method,
   ip: req.ip,
   userAgent: req.get('User-Agent')?.substring(0, 100),
   requestId: req.requestId,
   timestamp: new Date().toISOString(),
   severity: isCriticalError ? 'CRITICAL' : isSecurityError ? 'HIGH' : 'MEDIUM'
 });

 // Enhanced error response
 const status = err.status || (isCriticalError ? 500 : isSecurityError ? 429 : 400);
 
 res.status(status).json({
   error: NODE_ENV === 'development' 
     ? err.message 
     : getPublicErrorMessage(status),
   timestamp: new Date().toISOString(),
   requestId: req.requestId || 'unknown',
   status: status,
   ...(isSecurityError && { 
     securityLevel: 'enhanced',
     retryAfter: '300'
   }),
   ...(isCriticalError && {
     severity: 'high',
     support: 'Contact technical support if this persists'
   })
 });
});

// Utility functions
function formatUptime(seconds) {
 const days = Math.floor(seconds / 86400);
 const hours = Math.floor((seconds % 86400) / 3600);
 const minutes = Math.floor((seconds % 3600) / 60);
 const secs = Math.floor(seconds % 60);
 
 return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function getPublicErrorMessage(status) {
 const messages = {
   400: 'Bad request. Please check your input.',
   401: 'Authentication required.',
   403: 'Access forbidden.',
   404: 'Resource not found.',
   429: 'Too many requests. Please slow down.',
   500: 'Internal server error. Please try again later.',
   502: 'Service temporarily unavailable.',
   503: 'Service maintenance in progress.'
 };
 
 return messages[status] || 'An error occurred. Please try again.';
}

// Start server with enhanced logging and error handling
const server = app.listen(PORT, () => {
 console.log('\n🎉 OUH! USSD API Server Started Successfully!');
 console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
 console.log('📊 Server Configuration:');
 console.log(`   🌐 Port: ${PORT}`);
 console.log(`   🔧 Environment: ${NODE_ENV}`);
 console.log(`   🛡️ Security Level: ${SECURITY_CONFIG.level}`);
 console.log(`   📡 Health Check: http://localhost:${PORT}/health`);
 console.log(`   🔒 Security Stats: http://localhost:${PORT}/api/security/stats`);
 console.log(`   📖 Documentation: http://localhost:${PORT}/`);
 console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
 console.log('🚀 Security Features Enabled:');
 console.log('   ✅ Multi-tier Rate Limiting');
 console.log('   ✅ Session Encryption (AES-256-GCM)');
 console.log('   ✅ Input Validation & Sanitization');
 console.log('   ✅ PIN Security (PBKDF2-SHA256)');
 console.log('   ✅ Anti-replay Nonce Validation');
 console.log('   ✅ Real-time Security Monitoring');
 console.log('   ✅ CORS & Header Protection');
 console.log('   ✅ Comprehensive Error Handling');
 console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
 console.log(`⏰ Server started at: ${new Date().toISOString()}`);
 console.log('🎯 Ready to serve secure USSD transactions!\n');
});

// Enhanced graceful shutdown handling
const gracefulShutdown = (signal) => {
 console.log(`\n🛑 ${signal} received, initiating graceful shutdown...`);
 
 // Stop accepting new connections
 server.close((err) => {
   if (err) {
     console.error('❌ Error during server shutdown:', err);
     process.exit(1);
   }
   
   console.log('🔄 HTTP server closed successfully');
   
   // Clean up resources
   console.log('🧹 Cleaning up application resources...');
   
   try {
     // Clean up session manager
     if (sessionManager && sessionManager.destroy) {
       sessionManager.destroy();
       console.log('✅ Session manager cleaned up');
     }
     
     // Clean up other resources here if needed
     console.log('✅ All resources cleaned up successfully');
     
     console.log('🎉 Graceful shutdown completed');
     process.exit(0);
   } catch (cleanupError) {
     console.error('❌ Error during cleanup:', cleanupError);
     process.exit(1);
   }
 });

 // Force close after 30 seconds
 setTimeout(() => {
   console.error('⚠️ Could not close connections in time, forcefully shutting down');
   process.exit(1);
 }, 30000);
};

// Register graceful shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
 console.error('💥 Uncaught Exception:', {
   message: err.message,
   stack: err.stack,
   timestamp: new Date().toISOString()
 });
 gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
 console.error('💥 Unhandled Rejection:', {
   reason: reason,
   promise: promise,
   timestamp: new Date().toISOString()
 });
 gracefulShutdown('UNHANDLED_REJECTION');
});

// Export app for testing
module.exports = app;
