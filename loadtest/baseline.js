/**
 * PulsePay Load Test — Baseline
 * 50 VUs, steady state for 2 minutes
 * Target: >200 TPS, P95 <200ms, <1% error rate
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  vus: 50,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    payment_success_rate: ['rate>0.95'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'dev-api-key-12345';

const paymentSuccessRate = new Rate('payment_success_rate');
const fraudBlockRate = new Rate('fraud_block_rate');
const latencyTrend = new Trend('payment_latency_ms');

const CARD_COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE'];
const MERCHANT_IDS = ['merchant_001', 'merchant_002', 'merchant_003', 'merchant_demo'];

function randomAmount() {
  return parseFloat((Math.random() * 500 + 5).toFixed(2));
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function () {
  const payload = JSON.stringify({
    idempotencyKey: uuidv4(),
    amount: randomAmount(),
    currency: 'USD',
    merchantId: randomFrom(MERCHANT_IDS),
    cardLast4: String(Math.floor(1000 + Math.random() * 9000)),
    cardCountry: randomFrom(CARD_COUNTRIES),
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY,
    },
    timeout: '10s',
  };

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/payments`, payload, params);
  const elapsed = Date.now() - start;

  latencyTrend.add(elapsed);

  const success = check(res, {
    'status 200 or 402': (r) => [200, 402, 422].includes(r.status),
    'has transactionId': (r) => {
      try { return !!JSON.parse(r.body).transactionId; } catch { return false; }
    },
  });

  if (res.status === 200) {
    paymentSuccessRate.add(1);
  } else if (res.status === 402) {
    paymentSuccessRate.add(0);
    fraudBlockRate.add(1);
  } else {
    paymentSuccessRate.add(0);
    fraudBlockRate.add(0);
  }

  sleep(0.1); // ~10 req/s per VU
}
