# PulsePay

A production-grade **payment orchestration platform** demonstrating multi-provider routing, ML-based fraud scoring, SAGA-pattern distributed transaction management, circuit breaker failover, and a live operations dashboard.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Client / k6 Tests                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP
                               ▼
              ┌────────────────────────────────┐
              │          API Gateway           │  :3000
              │  • API key auth                │
              │  • Token bucket rate limit     │
              │  • SSE /stream/transactions    │
              └───────────────┬────────────────┘
                              │ HTTP
                              ▼
        ┌─────────────────────────────────────────┐
        │         Payment Orchestrator            │  :8080
        │  • SAGA coordinator (6-step)            │
        │  • Idempotency key dedup                │
        │  • Compensation / rollback              │
        │  • Redis Stream event publishing        │
        └────┬────────────┬────────────┬──────────┘
             │            │            │
         HTTP│        HTTP│        HTTP│
             ▼            ▼            ▼
     ┌──────────┐  ┌───────────┐  ┌──────────────┐
     │  Fraud   │  │ Provider  │  │   Ledger     │
     │  Engine  │  │  Router   │  │   Service    │
     │ :8000    │  │  :8081    │  │   :8082      │
     │ Python/  │  │ Spring/   │  │  Spring/     │
     │ FastAPI  │  │ CB + WS   │  │  Postgres    │
     └──────────┘  └─────┬─────┘  └──────────────┘
                         │ HTTP
                         ▼
              ┌─────────────────────┐
              │    Provider Mock    │  :9000
              │  stripe / adyen /   │
              │  braintree (sim.)   │
              └─────────────────────┘

     Redis Streams ──→ Analytics Worker ──→ Redis Hash metrics
                   └──→ API Gateway SSE ──→ Web UI
```

---

## Quick Start

```bash
# 1. Clone and configure
cp .env.sample .env

# 2. Start everything
docker compose up --build

# 3. Dashboard
open http://localhost

# 4. Send a test payment
curl -X POST http://localhost:3000/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: dev-api-key-12345" \
  -d '{
    "idempotencyKey": "test-001",
    "amount": 99.99,
    "currency": "USD",
    "merchantId": "merchant_demo",
    "cardLast4": "4242",
    "cardCountry": "US"
  }'
```

Services come up in order via `depends_on` health checks. Full stack ready in ~90s.

---

## Services

| Service | Port | Stack | Role |
|---------|------|-------|------|
| api-gateway | 3000 | Node.js / Fastify | Auth, rate limiting, SSE, routing |
| payment-orchestrator | 8080 | Java 21 / Spring Boot | SAGA coordinator |
| fraud-engine | 8000 | Python / FastAPI | Fraud scoring (0–100) |
| provider-router | 8081 | Java 21 / Spring Boot | Circuit breaker + provider selection |
| ledger-service | 8082 | Java 21 / Spring Boot | Double-entry bookkeeping |
| analytics-worker | — | Node.js | Redis Streams → rolling metrics |
| provider-mock | 9000 | Node.js / Fastify | Stripe/Adyen/Braintree simulation |
| web-ui | 80 | Next.js 14 | Live ops dashboard |

---

## API Reference

### Initiate Payment
```
POST /api/v1/payments
X-Api-Key: dev-api-key-12345
Content-Type: application/json

{
  "idempotencyKey": "string (unique per payment)",
  "amount": 99.99,
  "currency": "USD",
  "merchantId": "merchant_demo",
  "cardLast4": "4242",
  "cardCountry": "US"
}

Response 200: { transactionId, status: "SETTLED", provider, fraudScore, ... }
Response 402: { status: "BLOCKED", fraudScore: 85, fraudDecision: "BLOCK", ... }
Response 422: { status: "FAILED", errorMessage: "...", ... }
Response 429: { error: "Too Many Requests", retryAfterMs: 1000 }
```

### Get Transaction
```
GET /api/v1/payments/:id
X-Api-Key: dev-api-key-12345
```

### Live Event Stream (SSE)
```
GET /stream/transactions
Accept: text/event-stream
```

### Provider Health
```
GET /api/v1/providers/health
X-Api-Key: dev-api-key-12345
```

### Failure Injection (Demo)
```
POST /api/v1/admin/inject-failure?provider=stripe&duration=30s
X-Api-Key: dev-api-key-12345

POST /api/v1/admin/recover
```

---

## SAGA Transaction Lifecycle

```
VALIDATE → FRAUD_CHECK → RESERVE → ROUTE → SETTLE → NOTIFY
```

| Step | Description | Compensation |
|------|-------------|--------------|
| VALIDATE | Idempotency key dedup | — |
| FRAUD_CHECK | Score 0–100, BLOCK if >80 | — |
| RESERVE | Lock funds in ledger | RELEASE on downstream failure |
| ROUTE | Select provider + charge | VOID provider charge on settle failure |
| SETTLE | Finalize debit | VOID + RELEASE |
| NOTIFY | Publish Redis Stream event | — |

---

## Fraud Scoring Signals

| Signal | Max Points | Trigger |
|--------|-----------|---------|
| Velocity | 30 | >10 txns in 10min (30pt) / >5 (15pt) |
| Amount anomaly | 25 | Deviation >5× baseline (25pt) / >2× (12pt) |
| Geo / impossible travel | 30 | Different country within 60min |
| Time of day | 15 | Transactions at 2am–5am |

Decision: **ALLOW** (<50) · **FLAG** (50–80) · **BLOCK** (>80)

---

## Circuit Breaker

Per-provider state machine:

```
CLOSED ──(3 consecutive failures)──→ OPEN
OPEN ──(30s recovery timeout)──→ HALF_OPEN
HALF_OPEN ──(probe success)──→ CLOSED
HALF_OPEN ──(probe failure)──→ OPEN
```

Routing uses weighted scoring when selecting providers:
```
score = (successRate × 0.5) + (1/cost × 0.3) + (1/latency × 0.2)
```

---

## Load Test Results

Run with k6 against a running stack:

```bash
k6 run loadtest/baseline.js
k6 run loadtest/spike.js
k6 run loadtest/failure-injection.js
```

| Test | Requests | Duration | TPS | P95 Latency | Error Rate |
|------|----------|----------|-----|-------------|------------|
| Baseline | — | 2 min | — | — | — |
| Spike | — | 2 min | — | — | — |
| Failure injection | — | 2 min | — | — | — |

*Run the tests and fill in results. Expected: baseline >200 TPS at P95 <200ms.*

---

## Scaling Configuration

| Knob | Location | Default |
|------|----------|---------|
| Rate limit (req/s per key) | `.env` `RATE_LIMIT_REFILL_RATE` | 100 |
| Fraud block threshold | `.env` `FRAUD_BLOCK_THRESHOLD` | 80 |
| Circuit breaker failure count | `provider-router/application.yml` | 3 |
| Circuit breaker recovery timeout | `provider-router/application.yml` | 30s |
| Metrics window | `.env` `METRICS_WINDOW_SECONDS` | 60 |
| DB pool size | orchestrator/ledger `application.yml` | 20 |
