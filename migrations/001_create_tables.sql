-- Users table: optimized for Nigerian phone numbers and naira amounts
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  wallet_address VARCHAR(44) NOT NULL,
  pin_hash BYTEA NOT NULL,
  total_volume BIGINT NOT NULL DEFAULT 0,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(10) NOT NULL DEFAULT 'active'
);

-- Transactions table: handles both crypto and airtime transactions
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  tx_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tx_type VARCHAR(10) NOT NULL CHECK (tx_type IN ('crypto', 'airtime')),
  amount_ngn BIGINT NOT NULL CHECK (amount_ngn > 0),
  amount_usdc BIGINT CHECK (amount_usdc > 0),
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fee BIGINT NOT NULL DEFAULT 0,
  solana_signature VARCHAR(88),
  vtu_reference VARCHAR(100),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0
);

-- Price cache: stores real-time exchange rates
CREATE TABLE IF NOT EXISTS price_cache (
  id SERIAL PRIMARY KEY,
  currency_pair VARCHAR(7) NOT NULL UNIQUE,
  rate NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  source VARCHAR(20) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
