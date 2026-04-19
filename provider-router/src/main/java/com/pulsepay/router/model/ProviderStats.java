package com.pulsepay.router.model;

import lombok.Data;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

@Data
public class ProviderStats {
    private final String name;
    private final double cost;

    private final AtomicLong totalRequests = new AtomicLong(0);
    private final AtomicLong successCount = new AtomicLong(0);
    private final AtomicLong failureCount = new AtomicLong(0);
    private final AtomicLong totalLatencyMs = new AtomicLong(0);
    private final AtomicInteger consecutiveFailures = new AtomicInteger(0);

    private volatile CircuitBreakerState circuitState = CircuitBreakerState.CLOSED;
    private volatile Instant openedAt = null;
    private volatile boolean halfOpenProbeInFlight = false;

    public double getSuccessRate() {
        long total = totalRequests.get();
        return total == 0 ? 1.0 : (double) successCount.get() / total;
    }

    public double getAvgLatencyMs() {
        long total = totalRequests.get();
        return total == 0 ? 0.0 : (double) totalLatencyMs.get() / total;
    }

    public void recordSuccess(long latencyMs) {
        totalRequests.incrementAndGet();
        successCount.incrementAndGet();
        totalLatencyMs.addAndGet(latencyMs);
        consecutiveFailures.set(0);
    }

    public void recordFailure(long latencyMs) {
        totalRequests.incrementAndGet();
        failureCount.incrementAndGet();
        if (latencyMs > 0) totalLatencyMs.addAndGet(latencyMs);
        consecutiveFailures.incrementAndGet();
    }
}
