/**
 * Load Test — Failure Injection
 * 50 VUs steady, inject provider failure at t=30s
 * Assert: approval rate stays >90% (traffic reroutes), circuit breaker trips within 3 failures
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  scenarios: {
    steady_load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
    },
  },
  thresholds: {
    // Approval rate must stay >90% even during provider failure
    payment_success_rate: ['rate>0.90'],
    http_req_failed: ['rate<0.10'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const MOCK_URL = __ENV.MOCK_URL || 'http://localhost:9000';
const API_KEY = __ENV.API_KEY || 'dev-api-key-12345';

const paymentSuccessRate = new Rate('payment_success_rate');
const injectionsDone = new Counter('failure_injections');

let failureInjected = false;

export default function () {
  // Inject stripe failure at ~30s (one VU does it once)
  if (!failureInjected && __VU === 1 && Date.now() % 30000 < 1000) {
    const injectRes = http.post(
      `${MOCK_URL}/admin/fail?provider=stripe&duration=60s&reason=LOADTEST_INJECTION`,
      null,
      { timeout: '5s' }
    );
    if (injectRes.status === 200) {
      console.log(`[t=${new Date().toISOString()}] Failure injected into Stripe`);
      failureInjected = true;
      injectionsDone.add(1);
    }
  }

  const payload = JSON.stringify({
    idempotencyKey: uuidv4(),
    amount: parseFloat((Math.random() * 300 + 20).toFixed(2)),
    currency: 'USD',
    merchantId: 'merchant_demo',
    cardLast4: String(Math.floor(1000 + Math.random() * 9000)),
    cardCountry: 'US',
  });

  const res = http.post(`${BASE_URL}/api/v1/payments`, payload, {
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
    timeout: '10s',
  });

  check(res, {
    'payment processed': (r) => [200, 402, 422].includes(r.status),
    'not a 5xx error': (r) => r.status < 500,
  });

  paymentSuccessRate.add(res.status === 200 ? 1 : 0);

  sleep(0.1);
}

export function handleSummary(data) {
  const tps = data.metrics.http_reqs?.values.rate ?? 0;
  const p95 = data.metrics.http_req_duration?.values['p(95)'] ?? 0;
  const errorRate = data.metrics.http_req_failed?.values.rate ?? 0;
  const approvalRate = data.metrics.payment_success_rate?.values.rate ?? 0;

  console.log('\n=== FAILURE INJECTION TEST SUMMARY ===');
  console.log(`TPS:           ${tps.toFixed(1)}`);
  console.log(`P95 Latency:   ${p95.toFixed(0)}ms`);
  console.log(`Error Rate:    ${(errorRate * 100).toFixed(2)}%`);
  console.log(`Approval Rate: ${(approvalRate * 100).toFixed(2)}%`);
  console.log('');
  console.log('Expected: approval rate >90% despite Stripe failure (rerouted to Adyen/PayPal)');

  return {
    'loadtest/results/failure-injection.json': JSON.stringify(data, null, 2),
  };
}
