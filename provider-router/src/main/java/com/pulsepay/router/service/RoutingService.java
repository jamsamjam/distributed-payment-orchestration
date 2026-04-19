package com.pulsepay.router.service;

import com.pulsepay.router.model.CircuitBreakerState;
import com.pulsepay.router.model.ProviderStats;
import com.pulsepay.router.model.RouteRequest;
import com.pulsepay.router.model.RouteResponse;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class RoutingService {

    private final ProviderClient providerClient;

    @Value("${provider.circuit-breaker.failure-threshold:3}")
    private int failureThreshold;

    @Value("${provider.circuit-breaker.recovery-timeout-seconds:30}")
    private int recoveryTimeoutSeconds;

    private static final Random RANDOM = new Random();

    private final Map<String, ProviderStats> providers = new LinkedHashMap<>();

    @PostConstruct
    public void init() {
        providers.put("stripe",    new ProviderStats("stripe",    0.029));
        providers.put("adyen",     new ProviderStats("adyen",     0.025));
        providers.put("braintree", new ProviderStats("braintree", 0.027));
    }

    /**
     * Weighted scoring: successRate*0.5 + (1/cost)*0.3 + (1/latency)*0.2
     *
     * Selection uses weighted random (proportional to score) so all healthy providers
     * receive traffic. On failure the next-best provider is tried automatically —
     * this means a single stochastic failure never drops the transaction, and the
     * failing provider still accumulates consecutive failures until the circuit trips.
     */
    public RouteResponse route(RouteRequest req) {
        double maxCostInverse = providers.values().stream()
                .mapToDouble(p -> 1.0 / p.getCost()).max().orElse(1.0);
        double maxLatencyInverse = providers.values().stream()
                .mapToDouble(p -> 1.0 / Math.max(p.getAvgLatencyMs(), 1)).max().orElse(1.0);

        List<String> skipped = new ArrayList<>();
        List<Map.Entry<ProviderStats, Double>> candidates = new ArrayList<>();

        for (ProviderStats stats : providers.values()) {
            if (!canRoute(stats)) {
                skipped.add(stats.getName() + "(" + stats.getCircuitState() + ")");
                continue;
            }
            double score = providerScore(stats, maxCostInverse, maxLatencyInverse);
            candidates.add(Map.entry(stats, score));
        }
        candidates.sort((a, b) -> Double.compare(b.getValue(), a.getValue()));

        if (candidates.isEmpty()) {
            log.error("All providers unavailable. Skipped: {}", skipped);
            return RouteResponse.builder()
                    .success(false)
                    .errorMessage("All payment providers are currently unavailable")
                    .build();
        }

        int firstIdx = weightedRandomIndex(candidates);
        Collections.rotate(candidates, -firstIdx);

        for (int attempt = 0; attempt < candidates.size(); attempt++) {
            ProviderStats selected = candidates.get(attempt).getKey();
            double score = candidates.get(attempt).getValue();

            String reason = String.format(
                    "Selected %s (score=%.3f, successRate=%.2f%%, avgLatency=%.0fms, skipped=%s, attempt=%d/%d)",
                    selected.getName(), score, selected.getSuccessRate() * 100,
                    selected.getAvgLatencyMs(), skipped, attempt + 1, candidates.size());
            log.info("Routing txn={} → {}", req.getTransactionId(), reason);

            ProviderClient.ProviderResult result;
            try {
                result = providerClient.charge(selected.getName(), req);
            } catch (Exception e) {
                log.error("Unexpected error charging provider {}: {}", selected.getName(), e.getMessage());
                onFailure(selected, 0);
                continue;
            }

            if (result.success()) {
                onSuccess(selected, result.latencyMs());
                return RouteResponse.builder()
                        .success(true)
                        .provider(selected.getName())
                        .providerTxnId(result.providerTxnId())
                        .routingReason(reason)
                        .latencyMs(result.latencyMs())
                        .build();
            } else {
                onFailure(selected, result.latencyMs());
                log.warn("Provider {} failed for txn={}: {} — trying fallback",
                        selected.getName(), req.getTransactionId(), result.errorCode());
            }
        }

        log.error("All {} candidates failed for txn={}", candidates.size(), req.getTransactionId());
        return RouteResponse.builder()
                .success(false)
                .errorMessage("All available providers failed")
                .build();
    }

    private boolean canRoute(ProviderStats stats) {
        return switch (stats.getCircuitState()) {
            case CLOSED -> true;
            case OPEN -> {
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

    private void onSuccess(ProviderStats stats, long latencyMs) {
        stats.recordSuccess(latencyMs);
        if (stats.getCircuitState() == CircuitBreakerState.HALF_OPEN) {
            log.info("Circuit breaker CLOSED for provider={} (probe succeeded)", stats.getName());
            stats.setCircuitState(CircuitBreakerState.CLOSED);
            stats.setHalfOpenProbeInFlight(false);
        }
    }

    private void onFailure(ProviderStats stats, long latencyMs) {
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

    private double providerScore(ProviderStats stats, double maxCostInverse, double maxLatencyInverse) {
        double costScore = (1.0 / stats.getCost()) / maxCostInverse;
        double latencyScore = (1.0 / Math.max(stats.getAvgLatencyMs(), 1)) / maxLatencyInverse;
        return (stats.getSuccessRate() * 0.5) + (costScore * 0.3) + (latencyScore * 0.2);
    }

    private int weightedRandomIndex(List<Map.Entry<ProviderStats, Double>> candidates) {
        double total = candidates.stream().mapToDouble(Map.Entry::getValue).sum();
        double r = RANDOM.nextDouble() * total;
        double cumulative = 0;
        for (int i = 0; i < candidates.size(); i++) {
            cumulative += candidates.get(i).getValue();
            if (r <= cumulative) return i;
        }
        return candidates.size() - 1;
    }

    public boolean voidTransaction(String providerName, String providerTxnId) {
        return providerClient.voidTransaction(providerName, providerTxnId);
    }

    public Map<String, Object> getProviderHealth() {
        Map<String, Object> health = new LinkedHashMap<>();
        for (ProviderStats stats : providers.values()) {
            Map<String, Object> info = new LinkedHashMap<>();
            info.put("circuitState", stats.getCircuitState());
            info.put("successRate", stats.getSuccessRate());
            info.put("avgLatencyMs", stats.getAvgLatencyMs());
            info.put("totalRequests", stats.getTotalRequests().get());
            info.put("consecutiveFailures", stats.getConsecutiveFailures().get());
            if (stats.getOpenedAt() != null) {
                info.put("openedAt", stats.getOpenedAt().toString());
            }
            health.put(stats.getName(), info);
        }
        return health;
    }
}
