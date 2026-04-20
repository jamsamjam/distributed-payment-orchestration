'use strict';

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { request: undiciRequest } = require('undici');
const Redis = require('ioredis');
const { TokenBucketRateLimiter } = require('./rateLimiter');
const { SseManager } = require('./sseManager');

// ==============================
// Config
// ==============================
const PORT = parseInt(process.env.PORT ?? '3000');
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:8080';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const API_KEY = process.env.API_KEY ?? 'dev-api-key-12345';
const MAX_TOKENS = parseInt(process.env.RATE_LIMIT_MAX_TOKENS ?? '100');
const REFILL_RATE = parseInt(process.env.RATE_LIMIT_REFILL_RATE ?? '100');
const STREAM_KEY = process.env.EVENTS_STREAM_KEY ?? 'dpo:events';
const STREAM_GROUP = 'gateway-sse';
const CONSUMER_NAME = `gateway-${process.pid}`;

// ==============================
// App setup
// ==============================
const app = Fastify({ logger: true });
app.register(cors);

const redis = new Redis(REDIS_URL);
const subRedis = new Redis(REDIS_URL); // separate connection for stream reading
const rateLimiter = new TokenBucketRateLimiter(redis, { maxTokens: MAX_TOKENS, refillRate: REFILL_RATE });
const sseManager = new SseManager();

// Prometheus counters (simple in-memory)
const metrics = {
  requestsTotal: 0,
  requestsRateLimited: 0,
  requestsUnauthorized: 0,
  paymentsInitiated: 0,
  sseClients: 0,
};

// ==============================
// Auth hook
// ==============================
app.addHook('preHandler', async (req, reply) => {
  // Skip auth for health, metrics, SSE
  const path = req.routerPath ?? req.url;
  if (['/health', '/metrics'].includes(path) || path.startsWith('/stream')) return;

  const key = req.headers['x-api-key'] ?? req.headers['authorization']?.replace('Bearer ', '');
  if (!key || key !== API_KEY) {
    metrics.requestsUnauthorized++;
    return reply.code(401).send({ error: 'Unauthorized', message: 'Valid API key required (X-Api-Key header)' });
  }
});

// ==============================
// Rate limiting hook
// ==============================
app.addHook('preHandler', async (req, reply) => {
  const path = req.routerPath ?? req.url;
  if (['/health', '/metrics'].includes(path) || path.startsWith('/stream')) return;

  const apiKey = req.headers['x-api-key'] ?? 'anonymous';
  const { allowed, retryAfterMs } = await rateLimiter.consume(apiKey);
  metrics.requestsTotal++;

  if (!allowed) {
    metrics.requestsRateLimited++;
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    reply.header('Retry-After', String(retryAfterSec));
    reply.header('X-RateLimit-Limit', String(MAX_TOKENS));
    return reply.code(429).send({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
      retryAfterMs,
    });
  }
});

// ==============================
// Payment endpoints
// ==============================

app.post('/api/v1/payments', async (req, reply) => {
  metrics.paymentsInitiated++;
  try {
    const { statusCode, body } = await undiciRequest(`${ORCHESTRATOR_URL}/api/v1/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const responseBody = await body.json();
    return reply.code(statusCode).send(responseBody);
  } catch (err) {
    app.log.error('Orchestrator error: %s', err.message);
    return reply.code(503).send({ error: 'Payment service unavailable' });
  }
});

app.get('/api/v1/payments/:id', async (req, reply) => {
  try {
    const { statusCode, body } = await undiciRequest(
      `${ORCHESTRATOR_URL}/api/v1/payments/${req.params.id}`,
      { method: 'GET' }
    );
    const responseBody = await body.json();
    return reply.code(statusCode).send(responseBody);
  } catch (err) {
    app.log.error('Orchestrator error: %s', err.message);
    return reply.code(503).send({ error: 'Payment service unavailable' });
  }
});

// ==============================
// SSE endpoint
// ==============================

app.get('/stream/transactions', async (req, reply) => {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('Access-Control-Allow-Origin', '*');
  reply.raw.flushHeaders();

  sseManager.addClient(reply);
  metrics.sseClients = sseManager.clientCount;

  // Send initial heartbeat
  reply.raw.write(': heartbeat\n\n');

  // Keep-alive ping every 15s
  const ping = setInterval(() => {
    try { reply.raw.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 15000);

  req.raw.on('close', () => {
    clearInterval(ping);
    metrics.sseClients = sseManager.clientCount;
  });

  return reply; // keep connection open
});

// ==============================
// Admin proxy endpoints (for UI failure injection + provider health)
// ==============================

const PROVIDER_MOCK_URL = process.env.PROVIDER_MOCK_URL ?? 'http://provider-mock:9000';
const PROVIDER_ROUTER_URL = process.env.PROVIDER_ROUTER_URL ?? 'http://provider-router:8081';

app.post('/api/v1/admin/inject-failure', async (req, reply) => {
  const { provider, duration = '30s', reason = 'DASHBOARD_INJECTION' } = req.query;
  try {
    const { statusCode, body } = await undiciRequest(
      `${PROVIDER_MOCK_URL}/admin/fail?provider=${provider}&duration=${duration}&reason=${reason}`,
      { method: 'POST' }
    );
    const responseBody = await body.json();
    return reply.code(statusCode).send(responseBody);
  } catch (err) {
    return reply.code(503).send({ error: err.message });
  }
});

app.post('/api/v1/admin/recover', async (req, reply) => {
  try {
    const { statusCode, body } = await undiciRequest(
      `${PROVIDER_MOCK_URL}/admin/recover`,
      { method: 'POST' }
    );
    const responseBody = await body.json();
    return reply.code(statusCode).send(responseBody);
  } catch (err) {
    return reply.code(503).send({ error: err.message });
  }
});

app.get('/api/v1/providers/health', async (req, reply) => {
  try {
    const { statusCode, body } = await undiciRequest(
      `${PROVIDER_ROUTER_URL}/router/health/providers`,
      { method: 'GET' }
    );
    const responseBody = await body.json();
    return reply.code(statusCode).send(responseBody);
  } catch (err) {
    return reply.code(503).send({ error: err.message });
  }
});

// ==============================
// Health + Metrics
// ==============================

app.get('/health', async (req, reply) => {
  let redisOk = false;
  try {
    await redis.ping();
    redisOk = true;
  } catch {}
  return reply.send({
    status: 'ok',
    service: 'api-gateway',
    redis: redisOk ? 'ok' : 'unavailable',
    sseClients: sseManager.clientCount,
    timestamp: new Date().toISOString(),
  });
});

app.get('/metrics', async (req, reply) => {
  const lines = [
    `# HELP gateway_requests_total Total HTTP requests`,
    `# TYPE gateway_requests_total counter`,
    `gateway_requests_total ${metrics.requestsTotal}`,
    `# HELP gateway_rate_limited_total Rate-limited requests`,
    `# TYPE gateway_rate_limited_total counter`,
    `gateway_rate_limited_total ${metrics.requestsRateLimited}`,
    `# HELP gateway_payments_initiated_total Payments initiated`,
    `# TYPE gateway_payments_initiated_total counter`,
    `gateway_payments_initiated_total ${metrics.paymentsInitiated}`,
    `# HELP gateway_sse_clients Active SSE clients`,
    `# TYPE gateway_sse_clients gauge`,
    `gateway_sse_clients ${sseManager.clientCount}`,
  ];
  reply.header('Content-Type', 'text/plain; version=0.0.4');
  return reply.send(lines.join('\n') + '\n');
});

// ==============================
// Redis Stream consumer → SSE broadcast
// ==============================

async function initStreamConsumer() {
  try {
    await subRedis.xgroup('CREATE', STREAM_KEY, STREAM_GROUP, '$', 'MKSTREAM');
    app.log.info('Created Redis stream consumer group: %s', STREAM_GROUP);
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) {
      app.log.warn('xgroup create warning: %s', err.message);
    }
  }

  pollStream();
}

async function pollStream() {
  // Also subscribe to metrics snapshots stream
  try {
    await subRedis.xgroup('CREATE', 'dpo:metrics-snapshots', STREAM_GROUP, '$', 'MKSTREAM');
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) app.log.warn('metrics xgroup: %s', err.message);
  }

  while (true) {
    try {
      const results = await subRedis.xreadgroup(
        'GROUP', STREAM_GROUP, CONSUMER_NAME,
        'COUNT', '50',
        'BLOCK', '500',
        'STREAMS', STREAM_KEY, 'dpo:metrics-snapshots', '>', '>'
      );

      if (results) {
        for (const [, messages] of results) {
          for (const [id, fields] of messages) {
            const dataIdx = fields.indexOf('data');
            if (dataIdx !== -1 && fields[dataIdx + 1]) {
              // TODO: use correct stream key per message
              try {
                const event = JSON.parse(fields[dataIdx + 1]);
                sseManager.broadcast(event);
              } catch {}
            }
            await subRedis.xack(STREAM_KEY, STREAM_GROUP, id);
          }
        }
      }
    } catch (err) {
      if (!err.message?.includes('NOGROUP')) {
        app.log.error('Stream poll error: %s', err.message);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ==============================
// Start
// ==============================

app.listen({ port: PORT, host: '0.0.0.0' }, async (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`API Gateway listening on port ${PORT}`);
  await initStreamConsumer();
});
