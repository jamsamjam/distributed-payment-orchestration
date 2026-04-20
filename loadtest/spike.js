/**
 * Load Test — Spike Test
 * Ramp 0→500 VUs over 30s, hold 1min, ramp down 30s
 * Target: system remains stable, approval rate stays >90%
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  stages: [
    { duration: '30s', target: 500 },  // ramp up fast
    { duration: '1m',  target: 500 },  // hold at peak
    { duration: '30s', target: 0   },  // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // looser threshold during spike
    http_req_failed: ['rate<0.05'],
    payment_success_rate: ['rate>0.90'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'dev-api-key-12345';

const paymentSuccessRate = new Rate('payment_success_rate');
const rateLimitedRate = new Rate('rate_limited');

export default function () {
  const payload = JSON.stringify({
    idempotencyKey: uuidv4(),
    amount: parseFloat((Math.random() * 200 + 10).toFixed(2)),
    currency: 'USD',
    merchantId: 'merchant_demo',
    cardLast4: String(Math.floor(1000 + Math.random() * 9000)),
    cardCountry: ['US', 'GB', 'CA'][Math.floor(Math.random() * 3)],
  });

  const res = http.post(`${BASE_URL}/api/v1/payments`, payload, {
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
    timeout: '15s',
  });

  if (res.status === 429) {
    rateLimitedRate.add(1);
    sleep(parseFloat(res.headers['Retry-After'] || '1'));
    return;
  }

  rateLimitedRate.add(0);

  check(res, {
    'valid response': (r) => [200, 402, 422].includes(r.status),
  });

  paymentSuccessRate.add(res.status === 200 ? 1 : 0);
}
