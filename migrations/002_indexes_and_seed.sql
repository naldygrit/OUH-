-- Performance indexes
CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_registered_at ON users(registered_at);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_tx_type ON transactions(tx_type);
CREATE INDEX idx_transactions_solana_sig ON transactions(solana_signature);

CREATE INDEX idx_price_cache_pair ON price_cache(currency_pair);
CREATE INDEX idx_price_cache_expires ON price_cache(expires_at);

-- Add triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Initial price data
INSERT INTO price_cache (currency_pair, rate, source, expires_at) VALUES
('NGN/USD', 0.0013, 'seed', now() + INTERVAL '1 hour'),
('USD/NGN', 770.0, 'seed', now() + INTERVAL '1 hour')
ON CONFLICT (currency_pair) DO NOTHING;

-- Test user for development (remove in production)
INSERT INTO users (phone_number, wallet_address, pin_hash, status) VALUES
('+2348012345678', '11111111111111111111111111111111', E'\\x0000', 'active')
ON CONFLICT (phone_number) DO NOTHING;
