-- PulsePay Database Initialization
-- ====================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ====================================
-- Payment Orchestrator Tables
-- ====================================

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(64) UNIQUE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'INITIATED',
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  merchant_id VARCHAR(64),
  card_last4 VARCHAR(4),
  card_country VARCHAR(2),
  fraud_score INTEGER,
  fraud_decision VARCHAR(16),
  fraud_reasons TEXT[],
  provider VARCHAR(32),
  provider_txn_id VARCHAR(128),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saga_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id),
  step VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_idempotency ON transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saga_steps_transaction ON saga_steps(transaction_id);

-- ====================================
-- Ledger Service Tables
-- ====================================

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id VARCHAR(64) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  reserved DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT positive_balance CHECK (balance >= 0),
  CONSTRAINT positive_reserved CHECK (reserved >= 0)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(64) UNIQUE NOT NULL,
  account_id UUID REFERENCES accounts(id),
  type VARCHAR(32) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_idempotency ON ledger_entries(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_reference ON ledger_entries(reference_id);

-- ====================================
-- Seed Data
-- ====================================

-- Merchant accounts with initial balance
INSERT INTO accounts (id, owner_id, currency, balance, reserved) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'merchant_001', 'USD', 1000000.00, 0.00),
  ('a0000000-0000-0000-0000-000000000002', 'merchant_002', 'USD', 500000.00, 0.00),
  ('a0000000-0000-0000-0000-000000000003', 'merchant_003', 'EUR', 750000.00, 0.00),
  ('a0000000-0000-0000-0000-000000000004', 'merchant_demo', 'USD', 999999.99, 0.00)
ON CONFLICT DO NOTHING;

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
