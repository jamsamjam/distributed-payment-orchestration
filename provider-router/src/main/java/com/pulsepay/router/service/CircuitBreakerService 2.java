package com.pulsepay.router.service;

import com.pulsepay.router.model.CircuitBreakerState;
import com.pulsepay.router.model.ProviderStats;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;

@Service
@Slf4j
public class CircuitBreakerService {

    @Value("${provider.circuit-breaker.failure-threshold:3}")
    private int failureThreshold;

    @Value("${provider.circuit-breaker.recovery-timeout-seconds:30}")
    private int recoveryTimeoutSeconds;

    /**
     * Returns true if this provider can accept a new request.
     * Transitions OPEN → HALF_OPEN after recovery timeout.
     */
    public boolean canRoute(ProviderStats stats) {
        return switch (stats.getCircuitState()) {
            case CLOSED -> true;
            case OPEN -> {
                // Check if recovery window has elapsed
                if (stats.getOpenedAt() != null &&
                        Instant.now().isAfter(stats.getOpenedAt().plusSeconds(recoveryTimeoutSeconds))) {
                    if (!stats.isHalfOpenProbeInFlight()) {
                        log.info("Circuit breaker HALF_OPEN for provider={}", stats.getName());
                        stats.setCircuitState(CircuitBreakerState.HALF_OPEN);
                        stats.setHalfOpenProbeInFlight(true);
                        yield true;
                    }
                }
                yield false;
            }
            case HALF_OPEN -> !stats.isHalfOpenProbeInFlight();
        };
    }

    public void onSuccess(ProviderStats stats, long latencyMs) {
        stats.recordSuccess(latencyMs);
        if (stats.getCircuitState() == CircuitBreakerState.HALF_OPEN) {
            log.info("Circuit breaker CLOSED for provider={} (probe succeeded)", stats.getName());
            stats.setCircuitState(CircuitBreakerState.CLOSED);
            stats.setHalfOpenProbeInFlight(false);
        }
    }

    public void onFailure(ProviderStats stats, long latencyMs) {
        stats.recordFailure(latencyMs);

        if (stats.getCircuitState() == CircuitBreakerState.HALF_OPEN) {
            log.warn("Circuit breaker re-OPEN for provider={} (probe failed)", stats.getName());
            stats.setCircuitState(CircuitBreakerState.OPEN);
            stats.setOpenedAt(Instant.now());
            stats.setHalfOpenProbeInFlight(false);
            return;
        }

        if (stats.getCircuitState() == CircuitBreakerState.CLOSED &&
                stats.getConsecutiveFailures().get() >= failureThreshold) {
            log.warn("Circuit breaker OPEN for provider={} after {} consecutive failures",
                    stats.getName(), stats.getConsecutiveFailures().get());
            stats.setCircuitState(CircuitBreakerState.OPEN);
            stats.setOpenedAt(Instant.now());
        }
    }

    /** Periodic scan to auto-transition OPEN → HALF_OPEN when timeout expires */
    @Scheduled(fixedDelay = 5000)
    public void scanForRecovery() {
        // Recovery is handled lazily in canRoute(), this is a no-op safety net
    }
}
