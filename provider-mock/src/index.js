'use strict';

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { v4: uuidv4 } = require('uuid');

const app = Fastify({ logger: true });
app.register(cors);

// ==============================
// Provider Configuration
// ==============================

const providers = {
  stripe: {
    name: 'stripe',
    successRate: parseFloat(process.env.STRIPE_SUCCESS_RATE ?? '0.98'),
    minLatency: parseInt(process.env.STRIPE_MIN_LATENCY_MS ?? '80'),
    maxLatency: parseInt(process.env.STRIPE_MAX_LATENCY_MS ?? '200'),
    cost: 0.029, // 2.9% + $0.30
    failureMode: null,      // null | { until: Date, reason: string }
    stats: { total: 0, success: 0, failures: 0, totalLatency: 0 },
  },
  adyen: {
    name: 'adyen',
    successRate: parseFloat(process.env.ADYEN_SUCCESS_RATE ?? '0.96'),
    minLatency: parseInt(process.env.ADYEN_MIN_LATENCY_MS ?? '100'),
    maxLatency: parseInt(process.env.ADYEN_MAX_LATENCY_MS ?? '300'),
    cost: 0.025,
    failureMode: null,
    stats: { total: 0, success: 0, failures: 0, totalLatency: 0 },
  },
  paypal: {
    name: 'paypal',
    successRate: parseFloat(process.env.PAYPAL_SUCCESS_RATE ?? '0.94'),
    minLatency: parseInt(process.env.PAYPAL_MIN_LATENCY_MS ?? '150'),
    maxLatency: parseInt(process.env.PAYPAL_MAX_LATENCY_MS ?? '400'),
    cost: 0.027,
    failureMode: null,
    stats: { total: 0, success: 0, failures: 0, totalLatency: 0 },
  },
};

// ==============================
// Helpers
// ==============================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isProviderFailing(provider) {
  const fm = provider.failureMode;
  if (!fm) return false;
  if (new Date() > fm.until) {
    provider.failureMode = null;
    return false;
  }
  return true;
}

function generateProviderTxnId(providerName) {
  const prefix = { stripe: 'ch', adyen: 'D', paypal: 'bt' }[providerName] ?? 'tx';
  return `${prefix}_${uuidv4().replace(/-/g, '').substring(0, 24)}`;
}

// ==============================
// Charge handler (shared logic)
// ==============================

async function handleCharge(providerName, body, reply) {
  const provider = providers[providerName];
  if (!provider) {
    return reply.code(404).send({ error: 'Unknown provider' });
  }

  const startTime = Date.now();
  const latency = randomBetween(provider.minLatency, provider.maxLatency);
  await sleep(latency);

  provider.stats.total++;
  provider.stats.totalLatency += latency;

  // Injected failure mode overrides success rate
  if (isProviderFailing(provider)) {
    provider.stats.failures++;
    return reply.code(402).send({
      success: false,
      provider: providerName,
      error: provider.failureMode.reason ?? 'PROVIDER_UNAVAILABLE',
      error_code: 'SERVICE_UNAVAILABLE',
      latency_ms: latency,
      timestamp: new Date().toISOString(),
    });
  }

  // Stochastic success/failure based on configured rate
  const succeeded = Math.random() < provider.successRate;

  if (succeeded) {
    provider.stats.success++;
    return reply.code(200).send({
      success: true,
      provider: providerName,
      provider_txn_id: generateProviderTxnId(providerName),
      amount: body.amount,
      currency: body.currency ?? 'USD',
      status: 'CAPTURED',
      latency_ms: latency,
      timestamp: new Date().toISOString(),
    });
  } else {
    provider.stats.failures++;
    const errors = [
      { code: 'CARD_DECLINED', message: 'Card was declined' },
      { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds' },
      { code: 'EXPIRED_CARD', message: 'Card has expired' },
      { code: 'PROCESSING_ERROR', message: 'Processing error, please retry' },
    ];
    const err = errors[Math.floor(Math.random() * errors.length)];
    return reply.code(402).send({
      success: false,
      provider: providerName,
      error: err.message,
      error_code: err.code,
      latency_ms: latency,
      timestamp: new Date().toISOString(),
    });
  }
}

// ==============================
// Routes — Stripe
// ==============================

app.post('/stripe/v1/charges', async (req, reply) => {
  return handleCharge('stripe', req.body ?? {}, reply);
});

app.post('/stripe/v1/refunds', async (req, reply) => {
  const latency = randomBetween(providers.stripe.minLatency, providers.stripe.maxLatency);
  await sleep(latency);
  return reply.code(200).send({
    success: true,
    provider: 'stripe',
    refund_id: `re_${uuidv4().replace(/-/g, '').substring(0, 24)}`,
    status: 'REFUNDED',
    latency_ms: latency,
  });
});

// ==============================
// Routes — Adyen
// ==============================

app.post('/adyen/v68/payments', async (req, reply) => {
  return handleCharge('adyen', req.body ?? {}, reply);
});

app.post('/adyen/v68/payments/:pspReference/cancels', async (req, reply) => {
  const latency = randomBetween(providers.adyen.minLatency, providers.adyen.maxLatency);
  await sleep(latency);
  return reply.code(200).send({
    success: true,
    provider: 'adyen',
    psp_reference: `D${uuidv4().replace(/-/g, '').substring(0, 16)}`,
    status: 'CANCELLED',
    latency_ms: latency,
  });
});

// ==============================
// Routes — PayPal
// ==============================

app.post('/paypal/v1/transactions', async (req, reply) => {
  return handleCharge('paypal', req.body ?? {}, reply);
});

app.post('/paypal/v1/transactions/:id/void', async (req, reply) => {
  const latency = randomBetween(providers.paypal.minLatency, providers.paypal.maxLatency);
  await sleep(latency);
  return reply.code(200).send({
    success: true,
    provider: 'paypal',
    transaction_id: req.params.id,
    status: 'VOIDED',
    latency_ms: latency,
  });
});

// ==============================
// Admin — Failure Injection
// ==============================

app.post('/admin/fail', async (req, reply) => {
  const { provider: providerName, duration = '30s', reason = 'INJECTED_FAILURE' } = req.query;

  if (!providerName) {
    return reply.code(400).send({ error: 'provider query param required' });
  }
  const provider = providers[providerName];
  if (!provider) {
    return reply.code(404).send({ error: `Unknown provider: ${providerName}` });
  }

  // Parse duration: e.g., "30s", "2m", "60s"
  let durationMs = 30000;
  if (duration.endsWith('m')) {
    durationMs = parseInt(duration) * 60000;
  } else if (duration.endsWith('s')) {
    durationMs = parseInt(duration) * 1000;
  } else {
    durationMs = parseInt(duration);
  }

  provider.failureMode = {
    until: new Date(Date.now() + durationMs),
    reason,
  };

  app.log.info({ provider: providerName, duration, reason }, 'Failure injected');

  return reply.code(200).send({
    message: `Failure injected for ${providerName}`,
    duration_ms: durationMs,
    until: provider.failureMode.until.toISOString(),
    reason,
  });
});

app.post('/admin/recover', async (req, reply) => {
  const { provider: providerName } = req.query;

  if (providerName) {
    const provider = providers[providerName];
    if (!provider) return reply.code(404).send({ error: `Unknown provider: ${providerName}` });
    provider.failureMode = null;
    return reply.code(200).send({ message: `${providerName} recovered` });
  }

  // Recover all
  for (const p of Object.values(providers)) {
    p.failureMode = null;
  }
  return reply.code(200).send({ message: 'All providers recovered' });
});

// ==============================
// Admin — Stats / Config
// ==============================

app.get('/admin/stats', async (req, reply) => {
  const stats = {};
  for (const [name, p] of Object.entries(providers)) {
    stats[name] = {
      total: p.stats.total,
      success: p.stats.success,
      failures: p.stats.failures,
      success_rate: p.stats.total > 0 ? (p.stats.success / p.stats.total) : null,
      avg_latency_ms: p.stats.total > 0 ? Math.round(p.stats.totalLatency / p.stats.total) : null,
      failing: isProviderFailing(p),
      failure_mode: p.failureMode
        ? { reason: p.failureMode.reason, until: p.failureMode.until.toISOString() }
        : null,
    };
  }
  return reply.send(stats);
});

app.post('/admin/config', async (req, reply) => {
  const { provider: providerName, success_rate, min_latency_ms, max_latency_ms } = req.body ?? {};
  const provider = providers[providerName];
  if (!provider) return reply.code(404).send({ error: `Unknown provider: ${providerName}` });

  if (success_rate !== undefined) provider.successRate = parseFloat(success_rate);
  if (min_latency_ms !== undefined) provider.minLatency = parseInt(min_latency_ms);
  if (max_latency_ms !== undefined) provider.maxLatency = parseInt(max_latency_ms);

  return reply.send({
    message: 'Config updated',
    provider: providerName,
    success_rate: provider.successRate,
    min_latency_ms: provider.minLatency,
    max_latency_ms: provider.maxLatency,
  });
});

// ==============================
// Health + Metrics
// ==============================

app.get('/health', async (req, reply) => {
  return reply.send({
    status: 'ok',
    service: 'provider-mock',
    providers: Object.keys(providers),
    timestamp: new Date().toISOString(),
  });
});

app.get('/metrics', async (req, reply) => {
  const lines = [];
  lines.push('# HELP provider_mock_requests_total Total requests per provider');
  lines.push('# TYPE provider_mock_requests_total counter');
  for (const [name, p] of Object.entries(providers)) {
    lines.push(`provider_mock_requests_total{provider="${name}",status="success"} ${p.stats.success}`);
    lines.push(`provider_mock_requests_total{provider="${name}",status="failure"} ${p.stats.failures}`);
  }
  lines.push('# HELP provider_mock_failure_injected Whether failure is injected (1=yes)');
  lines.push('# TYPE provider_mock_failure_injected gauge');
  for (const [name, p] of Object.entries(providers)) {
    lines.push(`provider_mock_failure_injected{provider="${name}"} ${isProviderFailing(p) ? 1 : 0}`);
  }
  reply.header('Content-Type', 'text/plain; version=0.0.4');
  return reply.send(lines.join('\n') + '\n');
});

// ==============================
// Start
// ==============================

const PORT = parseInt(process.env.PORT ?? '9000');

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Provider mock listening on port ${PORT}`);
});
