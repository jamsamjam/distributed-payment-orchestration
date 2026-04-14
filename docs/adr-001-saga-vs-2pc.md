# ADR-001: SAGA Pattern vs Two-Phase Commit

**Status:** Accepted  
**Date:** 2026-04-14

## Context

PulsePay's payment flow spans multiple services (fraud-engine, ledger-service, provider-router) that need to coordinate a distributed transaction. We need a consistency strategy that handles partial failures gracefully.

## Decision

Use the **SAGA orchestration pattern** with compensating transactions.

## Rationale

| Dimension | 2PC | SAGA (chosen) |
|-----------|-----|---------------|
| Blocking | Yes — participants hold locks across services | No — each step commits locally |
| External provider compatibility | No — Stripe/Adyen can't implement prepare/commit | Yes — HTTP charge + void |
| Availability | Low — one unavailable service blocks all | High — compensation handles failures |
| Complexity | High — coordinator failure causes indefinite blocking | Medium — compensation logic required |
| Observability | Low | High — `saga_steps` table records every step |

## Consequences

- **Positive**: non-blocking, provider-agnostic, horizontally scalable orchestrator
- **Negative**: eventual consistency (brief window between steps where data is inconsistent); compensation logic must be idempotent and always retried
- **Mitigated**: idempotency keys ensure compensation never double-applies; saga_steps audit trail enables replay
