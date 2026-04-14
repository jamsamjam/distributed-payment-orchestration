# PulsePay — Deep Dive

## 1. SAGA Pattern: Design and Trade-offs vs 2PC

### Why SAGA instead of Two-Phase Commit?

Two-Phase Commit (2PC) is a distributed coordination protocol where a single coordinator node locks resources across all participants during the prepare phase, then commits or aborts atomically. While it provides strong ACID guarantees, it has critical drawbacks in a microservices context:

**Problems with 2PC:**
- **Blocking**: participants hold locks during the entire protocol. If the coordinator crashes after prepare but before commit, participants are blocked indefinitely.
- **Tight coupling**: all participants must implement the 2PC protocol and expose a prepare/commit interface.
- **Poor availability**: a single unavailable participant blocks the entire transaction. In a payment system processing thousands of TPS, this is unacceptable.
- **No fit for heterogeneous systems**: you cannot 2PC across a Python service, a Java service, and an external payment provider.

**SAGA advantages:**
- **Non-blocking**: each step executes its local transaction independently. No distributed lock is held between steps.
- **Compensating transactions**: instead of rolling back atomically, each step defines an idempotent compensation action (release reservation, void charge).
- **Resilience**: partial failures are handled gracefully. The SAGA can be retried from any step.
- **Heterogeneous participants**: works across any HTTP service regardless of technology.

### PulsePay's Choreography vs Orchestration choice

We chose **orchestration** (central SAGA coordinator in `payment-orchestrator`) rather than choreography (each service reacts to events). This gives:
- Explicit control flow visible in one place (`SagaOrchestrator.java`)
- Easier debugging: the `saga_steps` table records every step's outcome
- Simpler compensation: the orchestrator knows which steps completed and in what order

**Trade-off**: the orchestrator is a single point of orchestration (not a single point of failure — it's stateless and can be scaled horizontally since all state is in Postgres).

### Compensation design

Each compensation is idempotent and uses the same idempotency key infrastructure as the forward path:

| Forward Step | Compensation | Idempotency Key Pattern |
|-------------|--------------|------------------------|
| RESERVE | RELEASE | `release:{txn_id}` |
| ROUTE | VOID provider charge | `void:{txn_id}` |
| SETTLE | VOID + RELEASE | Same keys |

---

## 2. Circuit Breaker Implementation

### State machine

```
┌─────────┐  3 consecutive failures   ┌──────┐
│ CLOSED  │──────────────────────────→│ OPEN │
│(normal) │                           │(trip)│
└─────────┘                           └──┬───┘
     ↑                                   │ 30s timeout
     │ probe success                     ▼
     │                           ┌───────────┐
     └───────────────────────────│ HALF_OPEN │
                                 │ (1 probe) │
                                 └───────────┘
                                   │ probe fail
                                   └──→ OPEN (again)
```

### Implementation in `CircuitBreakerService.java`

The circuit breaker state is held in-memory per `ProviderStats` instance (one per provider). Key design choices:

1. **Consecutive failures, not rate**: We count consecutive failures rather than failure rate over a window. This trips faster on sudden outages (which is what payment providers experience) and avoids false trips from occasional transient errors.

2. **Lazy recovery**: The OPEN→HALF_OPEN transition happens lazily when `canRoute()` is called, rather than via a background timer. This avoids a thundering herd on recovery — only one probe is sent.

3. **Atomic probe flag**: `halfOpenProbeInFlight` prevents multiple concurrent probes from being sent during the HALF_OPEN window.

### Routing with circuit breaker

The routing algorithm only considers providers with CLOSED or HALF_OPEN state. This means:
- When Stripe trips → traffic flows to Adyen and Braintree based on their weighted scores
- The dashboard shows the circuit state change in real time via the SSE stream

---

## 3. Fraud Scoring Algorithm

The scorer combines four independent signals, each with a maximum weight:

```
total_score = velocity(0-30) + amount_anomaly(0-25) + geo_anomaly(0-30) + time_risk(0-15)
final_score = min(total_score, 100)
```

### Example calculations

**Low-risk transaction (tourist buying coffee):**
- Amount: $8.50, baseline avg: $12.00 → deviation 0.29× → 0 pts
- Velocity: 2 transactions in 10min → 0 pts  
- Country: same as last → 0 pts
- Hour: 2pm → 0 pts
- **Score: 0 → ALLOW**

**High-risk transaction (card testing attack):**
- 15 transactions in 10 minutes → HIGH_VELOCITY → +30 pts
- Amount $1.00, baseline $250 → 249× deviation → AMOUNT_ANOMALY_EXTREME → +25 pts
- Different country within 30min → GEO_IMPOSSIBLE_TRAVEL → +30 pts
- **Score: 85 → BLOCK**

### Velocity tracking

Transaction history is stored in Redis sorted sets (`fraud:history:{card_last4}:velocity`) with timestamps as scores. This enables O(log N) velocity queries and automatic TTL expiry without a background cleanup job.

---

## 4. Idempotency Key Design in the Ledger

The ledger service uses PostgreSQL's `UNIQUE` constraint on `idempotency_key` as the source of truth.

**Protocol:**
1. Before writing, check if the key already exists (`findByIdempotencyKey`)
2. If yes: return the existing result immediately (no-op)
3. If no: write the entry atomically within a `@Transactional` method

**Race condition handling:** Two concurrent requests with the same key can both pass the read check simultaneously. The `UNIQUE` constraint will cause one to throw `DataIntegrityViolationException`, which we catch and handle by re-reading the existing entry.

**Key generation convention:**
- Reserve: `reserve:{transaction_id}`
- Settle: `settle:{transaction_id}`
- Release: `release:{transaction_id}`

This naming ensures compensating transactions cannot accidentally re-execute forward operations — their keys are namespaced differently.

---

## 5. Event Sourcing Rationale

Every state transition in the payment lifecycle publishes a domain event to Redis Streams (`pulsepay:events`). This provides:

**Decoupling**: the analytics worker and the SSE gateway both consume the same stream independently via consumer groups. Adding a new consumer (e.g., a compliance audit worker) requires zero changes to the orchestrator.

**Event schema:**
```json
{
  "eventId": "uuid",
  "transactionId": "uuid",
  "type": "TRANSACTION_INITIATED | FRAUD_SCORED | ROUTED | SETTLED | FAILED",
  "timestamp": "ISO-8601",
  "payload": { ... }
}
```

**Redis Streams vs Kafka for this scale:**
- At <10,000 TPS, Redis Streams provide comparable throughput with dramatically simpler operations.
- Redis is already required for rate limiting and fraud history — no additional infrastructure.
- Consumer groups provide at-least-once delivery semantics with `XACK`.
- See `docs/adr-002-redis-streams-vs-kafka.md` for the full decision record.

---

## 6. Performance Analysis

### Baseline (expected)

At 50 VUs with 0.1s think time: theoretical TPS = 50 / (avg_latency + 0.1).

With P95 target of 200ms and end-to-end path being:
- API Gateway: ~1ms
- Fraud Engine (Redis lookup + scoring): ~5-15ms
- Provider Router (mock latency 80-200ms): ~140ms mean
- Ledger (Postgres): ~3-8ms

Expected P95: ~160ms, TPS: ~250.

### Spike test behavior

At 500 VUs the system will hit:
1. **Rate limiter**: keys exhausted → 429 responses (expected, not failures)
2. **DB connection pool**: at 20 connections per service × 2 Java services = 40 total, HikariCP will queue excess requests
3. **Provider mock**: latency stays stable as it's pure CPU, no DB

Expected: approval rate stays >90%, P95 rises to 400-600ms under spike.

### Failure injection behavior

When Stripe is injected with failures:
1. First 3 failures → Stripe's circuit breaker opens
2. Subsequent routing decisions skip Stripe → traffic goes to Adyen (96% SR) and Braintree (94% SR)
3. Weighted blend of remaining providers: ~95% effective success rate
4. Dashboard shows Stripe circuit state → OPEN in the provider health grid
