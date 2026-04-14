# ADR-003: Synchronous vs Asynchronous Fraud Scoring

**Status:** Accepted  
**Date:** 2026-04-14

## Context

The fraud engine adds latency to the payment critical path. We considered two approaches:
1. **Synchronous**: orchestrator calls fraud engine inline, blocks payment on score
2. **Async fire-and-forget**: orchestrator continues immediately, fraud engine scores in background

## Decision

Use **synchronous fraud scoring** with a non-blocking fallback.

## Rationale

The spec requires that transactions with `score > 80` are **blocked** before funds are reserved. This inherently requires the score before the RESERVE step. Async scoring would require:
- Holding a reservation open while awaiting the fraud result
- A callback mechanism or polling loop
- Complexity in handling the case where the fraud result arrives after the user already got a "payment initiated" response

Synchronous scoring keeps the control flow simple and the fraud check genuinely protective (not advisory after-the-fact).

**Latency impact**: the fraud engine is a Python/FastAPI service with Redis-backed history lookups. Typical latency is 5–15ms — well within the 200ms P95 target. The scoring algorithm itself is O(1).

**Failure handling**: if the fraud engine is unavailable, the orchestrator falls back to `score=0, decision=ALLOW` and logs a warning. This is a deliberate availability-over-safety trade-off: a transient fraud engine outage should not bring down payments. In production, this fallback would trigger an alert and elevated monitoring.

## Consequences

- **Positive**: genuine fraud blocking on the hot path; simple linear control flow
- **Negative**: fraud engine unavailability degrades fraud protection (not payment availability)
- **Mitigated**: fraud engine has `/health` check; circuit breaker on the orchestrator-to-fraud-engine path could be added as follow-up
