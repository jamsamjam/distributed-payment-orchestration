'use strict';

const Redis = require('ioredis');
const pino = require('pino');
const { RollingMetrics } = require('./metrics');

const log = pino({ level: 'info' });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const STREAM_KEY = process.env.EVENTS_STREAM_KEY ?? 'pulsepay:events';
const STREAM_GROUP = 'analytics';
const CONSUMER_NAME = `analytics-${process.pid}`;
const WINDOW_SECONDS = parseInt(process.env.METRICS_WINDOW_SECONDS ?? '60');
const PUBLISH_INTERVAL_MS = parseInt(process.env.METRICS_PUBLISH_INTERVAL_MS ?? '5000');
const METRICS_HASH_KEY = 'pulsepay:metrics';

const redis = new Redis(REDIS_URL, { lazyConnect: true });
const streamRedis = new Redis(REDIS_URL, { lazyConnect: true });

const rollingMetrics = new RollingMetrics(WINDOW_SECONDS);

// ==============================
// Init consumer group
// ==============================
async function initGroup() {
  await redis.connect();
  await streamRedis.connect();

  try {
    await streamRedis.xgroup('CREATE', STREAM_KEY, STREAM_GROUP, '$', 'MKSTREAM');
    log.info('Created consumer group: %s', STREAM_GROUP);
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) {
      log.warn('xgroup: %s', err.message);
    }
  }
}

// ==============================
// Stream consumer loop
// ==============================
async function consumeStream() {
  log.info('Starting stream consumer group=%s consumer=%s', STREAM_GROUP, CONSUMER_NAME);

  while (true) {
    try {
      const results = await streamRedis.xreadgroup(
        'GROUP', STREAM_GROUP, CONSUMER_NAME,
        'COUNT', '100',
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
                rollingMetrics.record(event);
              }
              await streamRedis.xack(STREAM_KEY, STREAM_GROUP, id);
            } catch (parseErr) {
              log.warn('Failed to parse event: %s', parseErr.message);
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
// Publish metrics to Redis Hash every N seconds
// ==============================
async function publishMetrics() {
  while (true) {
    try {
      const snapshot = rollingMetrics.compute();
      const ts = Date.now();

      // Store in a flat hash for easy polling
      const hashData = {
        tps: snapshot.tps.toString(),
        approvalRate: snapshot.approvalRate.toString(),
        fraudFlagRate: snapshot.fraudFlagRate.toString(),
        p50: snapshot.p50.toString(),
        p95: snapshot.p95.toString(),
        p99: snapshot.p99.toString(),
        totalTransactions: snapshot.totalTransactions.toString(),
        settledCount: (snapshot.settledCount ?? 0).toString(),
        failedCount: (snapshot.failedCount ?? 0).toString(),
        windowSeconds: snapshot.windowSeconds.toString(),
        revenueByProvider: JSON.stringify(snapshot.revenueByProvider),
        updatedAt: ts.toString(),
      };

      await redis.hmset(METRICS_HASH_KEY, hashData);
      await redis.expire(METRICS_HASH_KEY, 120);

      // Also push the snapshot to a stream for SSE publishing
      await redis.xadd(
        'pulsepay:metrics-snapshots',
        'MAXLEN', '~', '100',
        '*',
        'data', JSON.stringify({ type: 'METRICS_SNAPSHOT', timestamp: new Date(ts).toISOString(), payload: snapshot })
      );

      log.debug('Metrics published: tps=%s approvalRate=%s%', snapshot.tps, snapshot.approvalRate);
    } catch (err) {
      log.error('Failed to publish metrics: %s', err.message);
    }

    await new Promise(r => setTimeout(r, PUBLISH_INTERVAL_MS));
  }
}

// ==============================
// Main
// ==============================
async function main() {
  log.info('Analytics worker starting...');
  await initGroup();
  log.info('Connected to Redis: %s', REDIS_URL);

  // Run consumer and publisher concurrently
  consumeStream().catch(err => {
    log.error('Consumer died: %s', err.message);
    process.exit(1);
  });

  publishMetrics().catch(err => {
    log.error('Publisher died: %s', err.message);
    process.exit(1);
  });
}

main().catch(err => {
  log.error('Fatal: %s', err.message);
  process.exit(1);
});
