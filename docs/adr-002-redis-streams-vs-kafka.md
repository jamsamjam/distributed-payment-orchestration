# ADR-002: Redis Streams vs Kafka for Domain Events

**Status:** Accepted  
**Date:** 2026-04-14

## Context

PulsePay needs a message bus to decouple event producers (payment-orchestrator) from consumers (analytics-worker, api-gateway SSE). Options considered: Redis Streams, Apache Kafka, RabbitMQ.

## Decision

Use **Redis Streams** for the `pulsepay:events` stream.

## Rationale

| Dimension | Kafka | Redis Streams (chosen) |
|-----------|-------|----------------------|
| Ops overhead | High — ZooKeeper/KRaft, brokers, schema registry | Low — already required for rate limiting + fraud |
| Throughput | Millions/sec | Hundreds of thousands/sec |
| Consumer groups | Yes | Yes (`XREADGROUP`) |
| At-least-once delivery | Yes | Yes (`XACK`) |
| Message retention | Days/weeks | Configurable (MAXLEN) |
| Target TPS | <10,000 | <10,000 |

At our target load, Redis Streams' throughput ceiling (>100k msg/s) is far above what we need. The operational simplicity of running one less infrastructure component outweighs Kafka's additional guarantees (log compaction, cross-datacenter replication) that we don't require.

## Consequences

- **Positive**: single Redis instance serves rate limiting, fraud history, event streaming, and metrics — dramatically simpler ops
- **Negative**: if PulsePay scales to >500k TPS, migration to Kafka would be needed; Redis has no built-in message replay beyond MAXLEN retention
- **Mitigated**: MAXLEN capped at 10,000 events is sufficient for dashboard lag; important business events are also persisted to Postgres via `transactions` table
