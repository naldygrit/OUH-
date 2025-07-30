const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const redis = require('redis');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX),
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.connect();

// Health endpoints
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/health/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1 as status, now() as timestamp');
    res.json({ 
      db: 'OK', 
      timestamp: result.rows[0].timestamp
    });
  } catch (e) {
    res.status(500).json({ 
      db: 'FAIL', 
      error: e.message
    });
  }
});

app.get('/health/redis', async (req, res) => {
  try {
    const pong = await redisClient.ping();
    res.json({ 
      redis: 'OK', 
      response: pong
    });
  } catch (e) {
    res.status(500).json({ 
      redis: 'FAIL', 
      error: e.message
    });
  }
});

app.listen(port, () => {
  console.log(`OUH Backend listening on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});
