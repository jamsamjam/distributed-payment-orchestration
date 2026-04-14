'use strict';
/**
 * Rolling window metrics over a 60-second sliding window.
 * Computes TPS, approval rate, fraud flag rate, P50/P95/P99 latency, revenue by provider.
 */

class RollingMetrics {
  constructor(windowSeconds = 60) {
    this.windowSeconds = windowSeconds;
    // Each event: { ts: epoch_ms, status, fraudDecision, provider, amount, latencyMs }
    this._events = [];
  }

  record(event) {
    const payload = event.payload ?? {};
    this._events.push({
      ts: Date.now(),
      status: payload.status ?? event.type,
      fraudDecision: payload.fraudDecision ?? null,
      provider: payload.provider ?? null,
      amount: parseFloat(payload.amount ?? 0),
      latencyMs: parseInt(payload.latencyMs ?? 0),
    });
    this._prune();
  }

  _prune() {
    const cutoff = Date.now() - this.windowSeconds * 1000;
    let i = 0;
    while (i < this._events.length && this._events[i].ts < cutoff) i++;
    if (i > 0) this._events = this._events.slice(i);
  }

  compute() {
    this._prune();
    const events = this._events;
    const count = events.length;

    if (count === 0) {
      return {
        tps: 0,
        approvalRate: 100,
        fraudFlagRate: 0,
        p50: 0, p95: 0, p99: 0,
        revenueByProvider: {},
        totalTransactions: 0,
        windowSeconds: this.windowSeconds,
      };
    }

    const settled = events.filter(e => e.status === 'SETTLED');
    const failed = events.filter(e => e.status === 'FAILED' || e.status === 'BLOCKED');
    const flagged = events.filter(e => e.fraudDecision === 'FLAG');

    const tps = count / this.windowSeconds;
    const approvalRate = count > 0 ? (settled.length / count) * 100 : 100;
    const fraudFlagRate = count > 0 ? (flagged.length / count) * 100 : 0;

    // Latency percentiles from events that have latency data
    const latencies = events.map(e => e.latencyMs).filter(l => l > 0).sort((a, b) => a - b);
    const percentile = (arr, p) => {
      if (arr.length === 0) return 0;
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, idx)];
    };

    // Revenue by provider
    const revenueByProvider = {};
    for (const e of settled) {
      if (e.provider) {
        revenueByProvider[e.provider] = (revenueByProvider[e.provider] ?? 0) + e.amount;
      }
    }

    return {
      tps: Math.round(tps * 100) / 100,
      approvalRate: Math.round(approvalRate * 10) / 10,
      fraudFlagRate: Math.round(fraudFlagRate * 10) / 10,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      revenueByProvider,
      totalTransactions: count,
      settledCount: settled.length,
      failedCount: failed.length,
      windowSeconds: this.windowSeconds,
    };
  }
}

module.exports = { RollingMetrics };
