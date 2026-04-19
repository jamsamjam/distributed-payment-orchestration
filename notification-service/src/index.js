'use strict';

const Fastify = require('fastify');
const Redis = require('ioredis');
const { Pool } = require('pg');
const pino = require('pino');

const log = pino({ level: 'info' });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://pulsepay:pulsepay@localhost:5435/notification';
const STREAM_KEY = process.env.EVENTS_STREAM_KEY ?? 'pulsepay:events';
const STREAM_GROUP = 'notifications';
const CONSUMER_NAME = `notification-${process.pid}`;
const PORT = parseInt(process.env.PORT ?? '3001');

// Events that trigger a notification
const NOTIFY_EVENTS = new Set(['SETTLED', 'TRANSACTION_FAILED']);

const redis = new Redis(REDIS_URL);
const db = new Pool({ connectionString: DATABASE_URL });

// ==============================
// Notification dispatch (simulated)
// ==============================

function buildNotification(event) {
  const { type, payload } = event;
  if (type === 'SETTLED') {
    return {
      channel: 'webhook',
      recipient: payload.merchantId ?? 'unknown',
      message: `Payment ${payload.transactionId} settled — ${payload.amount} ${payload.currency} via ${payload.provider}`,
    };
  }
  if (type === 'TRANSACTION_FAILED') {
    return {
      channel: 'webhook',
      recipient: payload.merchantId ?? 'unknown',
      message: `Payment ${payload.transactionId} failed — ${payload.status}`,
    };
  }
  return null;
}

async function dispatch(event) {
  const notif = buildNotification(event);
  if (!notif) return;

  // Simulate sending (log it)
  log.info({ txn: event.transactionId, channel: notif.channel, recipient: notif.recipient }, notif.message);

  await db.query(
    `INSERT INTO notification_log (transaction_id, event_type, channel, recipient, status, payload)
     VALUES ($1, $2, $3, $4, 'SENT', $5)`,
    [event.transactionId, event.type, notif.channel, notif.recipient, JSON.stringify(event.payload)]
  );
}

// ==============================
// Redis Stream consumer
// ==============================

async function initGroup() {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, STREAM_GROUP, '$', 'MKSTREAM');
    log.info('Created consumer group: %s', STREAM_GROUP);
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) log.warn('xgroup: %s', err.message);
  }
}

async function consume() {
  log.info('Notification consumer started group=%s consumer=%s', STREAM_GROUP, CONSUMER_NAME);

  while (true) {
    try {
      const results = await redis.xreadgroup(
        'GROUP', STREAM_GROUP, CONSUMER_NAME,
        'COUNT', '50',
        'BLOCK', '1000',
        'STREAMS', STREAM_KEY, '>'
      );

      if (results) {
        for (const [, messages] of results) {
          for (const [id, fields] of messages) {
            try {
              const dataIdx = fields.indexOf('data');
              if (dataIdx !== -1 && fields[dataIdx + 1]) {
                const event = JSON.parse(fields[dataIdx + 1]);
                if (NOTIFY_EVENTS.has(event.type)) {
                  await dispatch(event);
                }
              }
              await redis.xack(STREAM_KEY, STREAM_GROUP, id);
            } catch (err) {
              log.error('Failed to process message %s: %s', id, err.message);
            }
          }
        }
      }
    } catch (err) {
      log.error('Stream error: %s', err.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ==============================
// Health endpoint
// ==============================

const app = Fastify({ logger: false });

app.get('/health', async () => {
  let redisOk = false;
  let dbOk = false;
  try { await redis.ping(); redisOk = true; } catch {}
  try { await db.query('SELECT 1'); dbOk = true; } catch {}
  const ok = redisOk && dbOk;
  return {
    status: ok ? 'ok' : 'degraded',
    service: 'notification-service',
    redis: redisOk ? 'ok' : 'unavailable',
    db: dbOk ? 'ok' : 'unavailable',
  };
});

// ==============================
// Start
// ==============================

async function main() {
  log.info('Notification service starting...');
  await initGroup();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  log.info('Health endpoint listening on port %d', PORT);
  consume().catch(err => {
    log.error('Consumer died: %s', err.message);
    process.exit(1);
  });
}

main().catch(err => {
  log.error('Fatal: %s', err.message);
  process.exit(1);
});
