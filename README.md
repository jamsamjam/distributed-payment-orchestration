# PulsePay

A payment orchestration platform: multi-provider routing, ML-based fraud scoring, SAGA-based distributed transaction management, circuit breaker failover, and a live operations dashboard.

## Architecture

[![Architecture Diagram](./docs/architecture.png)](./docs/architecture.png)

## Quick Start

```bash
docker compose up --build
```

## Services

| Service | Stack | Responsibility |
|---|---|---|
| `api-gateway` | Node.js + Fastify | Auth, rate limiting (configurable via `RATE_LIMIT_MAX_TOKENS`), SSE stream |
| `payment-orchestrator` | Java 21 + Spring Boot | 6-step SAGA, compensation, domain events |
| `fraud-engine` | Python + FastAPI | ML scoring 0–100, velocity / geo / amount / time signals |
| `provider-router` | Java 21 + Spring Boot | Weighted routing, per-provider circuit breaker |
| `ledger-service` | Java 21 + Spring Boot | Double-entry bookkeeping, idempotent reserve/settle |
| `analytics-worker` | Node.js | Redis Stream consumer, rolling metrics (60s window) |
| `web-ui` | Next.js 14 + Tailwind | Live ops dashboard, SSE transaction feed |
| `provider-mock` | Node.js + Fastify | Simulated Stripe / Adyen / Braintree with failure injection |

## API Reference

### Initiate Payment

```
POST /api/v1/payments
X-Api-Key: dev-api-key-12345
Content-Type: application/json

{
  "idempotencyKey": "unique-key",
  "amount": 99.99,
  "currency": "USD",
  "merchantId": "merchant_demo",
  "cardLast4": "4242",
  "cardCountry": "US"
}
```

**Response:**
```json
{
  "transactionId": "uuid",
  "status": "SETTLED | BLOCKED | FAILED",
  "provider": "adyen",
  "fraudScore": 0,
  "fraudDecision": "ALLOW | FLAG | BLOCK",
  "fraudReasons": []
}
```

### Get Transaction

```
GET /api/v1/payments/:id
X-Api-Key: dev-api-key-12345
```

## Fraud Scoring

Four signals combine for a score 0–100:

| Signal | Max Points | Triggers |
|---|---|---|
| HIGH_VELOCITY | 30 | >10 transactions in 10 minutes |
| ELEVATED_VELOCITY | 15 | >5 transactions in 10 minutes |
| AMOUNT_ANOMALY_EXTREME | 55 | >5× deviation from card's average |
| AMOUNT_ANOMALY | 25 | >2× deviation from card's average |
| GEO_IMPOSSIBLE_TRAVEL | 30 | Different country within 60 minutes |
| ODD_HOURS | 15 | 2am–5am UTC |

- **Score > 80** → BLOCK (transaction rejected, HTTP 402)
- **Score > 50** → FLAG (transaction proceeds, flagged in feed)
- **Score ≤ 50** → ALLOW

**Demo scenarios** (use the Test Payments panel in the dashboard):
1. Send "Normal Payment" ($99, US) to establish baseline
2. Send "Fraud Block" ($9999, JP) — scores GEO(30) + AMOUNT_EXTREME(55) = **85 → BLOCKED**

## Circuit Breaker

Per-provider state machine:

```mermaid
stateDiagram-v2
    [*] --> CLOSED

    CLOSED --> OPEN: 3 consecutive failures
    OPEN --> HALF_OPEN: after 30s timeout
    HALF_OPEN --> CLOSED: probe success
    HALF_OPEN --> OPEN: probe failure
```

**Demo:** Click "Inject Failure" on adyen in the dashboard → watch traffic automatically reroute to braintree within 1 failed payment. Click "Recover" to restore adyen.

## Idempotency

Every payment requires an `idempotencyKey`. Sending the same key twice returns the original result — no double charge.

```bash
# Both calls return the same transactionId
curl -X POST .../payments -d '{"idempotencyKey":"key-001", ...}'
curl -X POST .../payments -d '{"idempotencyKey":"key-001", ...}'  # ← same response
```

## Load Test Results

Tested on a single Apple M2 Pro (all services in Docker on one machine).

| Test | VUs | Duration | Requests | TPS | P50 | P95 | Error Rate | Notes |
|---|---|---|---|---|---|---|---|---|
| Baseline | 20 | 2 min | 2,924 | **24 TPS** | 374 ms | 2.76 s | 2.1% | Single machine, steady state |
| Spike | 0→500 | 2 min | 28,548 | **237 TPS** | 37 ms | 9.8 s | ~60% [1] | Saturation at ~150 VUs; timeouts above |
| Failure injection | 50 | 2 min | 4,920 | **40 TPS** | 705 ms | 4.1 s | 31.5% [2] | Stripe injected at t≈8s, circuit breaker reroutes |

[1] Spike error rate reflects connection timeouts under 500-VU burst — the system stabilises at ~240 TPS before saturating.  
[2] Failure injection errors include transactions that hit Stripe in the 3-failure window before the circuit breaker tripped, plus a small fraud-block rate (~6%). After the breaker opened, traffic successfully rerouted to Adyen/Braintree.

**Bottleneck analysis:** Each SAGA transaction holds a DB connection while making 3 synchronous HTTP calls (fraud engine → ledger → provider, each 100–400ms). On one machine with simulated provider latency, this limits throughput to ~24 TPS. In production with:
- Horizontal orchestrator scaling (3× replicas) → ~72 TPS
- Async fraud scoring (fire-and-forget) → ~60 TPS per replica
- Real providers (sub-10ms vs 80–400ms mock) → **~400+ TPS**

## Architecture Decision Records

- [ADR-001: SAGA vs Two-Phase Commit](./docs/adr-001-saga-vs-2pc.md)
- [ADR-002: Redis Streams vs Kafka](./docs/adr-002-redis-streams-vs-kafka.md)
- [ADR-003: Synchronous vs Asynchronous Fraud Scoring](./docs/adr-003-async-fraud-scoring.md)

## Scaling Configuration

Key tuning parameters (via environment variables):

| Variable | Default | Effect |
|---|---|---|
| `FRAUD_BLOCK_THRESHOLD` | 80 | Score above which transactions are blocked |
| `FRAUD_FLAG_THRESHOLD` | 50 | Score above which transactions are flagged |
| `PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD` | 3 | Consecutive failures to trip circuit |
| `PROVIDER_CIRCUIT_BREAKER_RECOVERY_TIMEOUT_SECONDS` | 30 | Seconds before HALF_OPEN probe |
| `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE` | 50 | DB connection pool per orchestrator instance |
