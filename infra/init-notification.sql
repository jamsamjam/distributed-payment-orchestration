-- Notification Service Database Initialization

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS notification_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id VARCHAR(64) NOT NULL,
  event_type     VARCHAR(64) NOT NULL,
  channel        VARCHAR(32) NOT NULL DEFAULT 'webhook',
  recipient      VARCHAR(128),
  status         VARCHAR(16) NOT NULL DEFAULT 'SENT',
  payload        JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_txn ON notification_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at DESC);
