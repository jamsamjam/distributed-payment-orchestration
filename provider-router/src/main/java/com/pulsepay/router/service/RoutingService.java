package com.pulsepay.router.service;

import com.pulsepay.router.model.ProviderStats;
import com.pulsepay.router.model.RouteRequest;
import com.pulsepay.router.model.RouteResponse;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class RoutingService {

    private final CircuitBreakerService circuitBreaker;
    private final ProviderClient providerClient;

    private static final Random RANDOM = new Random();

    // Provider registry — keyed by name
    private final Map<String, ProviderStats> providers = new LinkedHashMap<>();

    @PostConstruct
    public void init() {
        providers.put("stripe",    new ProviderStats("stripe",    0.029, 80,  200));
        providers.put("adyen",     new ProviderStats("adyen",     0.025, 100, 300));
        providers.put("braintree", new ProviderStats("braintree", 0.027, 150, 400));
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

        // Build eligible candidate list with scores, sorted best-first
        List<String> skipped = new ArrayList<>();
        List<Map.Entry<ProviderStats, Double>> candidates = new ArrayList<>();

        for (ProviderStats stats : providers.values()) {
            if (!circuitBreaker.canRoute(stats)) {
                skipped.add(stats.getName() + "(" + stats.getCircuitState() + ")");
                continue;
            }
            double score = providerScore(stats, maxCostInverse, maxLatencyInverse);
            candidates.add(Map.entry(stats, score));
        }
        candidates.sort((a, b) -> Double.compare(b.getValue(), a.getValue())); // best first

        if (candidates.isEmpty()) {
            log.error("All providers unavailable. Skipped: {}", skipped);
            return RouteResponse.builder()
                    .success(false)
                    .errorMessage("All payment providers are currently unavailable")
                    .build();
        }

        // Weighted-random first pick: distributes traffic proportionally to score.
        // Remaining providers are tried in score order if the first one fails.
        int firstIdx = weightedRandomIndex(candidates);
        // Rotate list so the randomly chosen provider is first
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
                circuitBreaker.onFailure(selected, 0);
                continue; // try next
            }

            if (result.success()) {
                circuitBreaker.onSuccess(selected, result.latencyMs());
                return RouteResponse.builder()
                        .success(true)
                        .provider(selected.getName())
                        .providerTxnId(result.providerTxnId())
                        .routingReason(reason)
                        .latencyMs(result.latencyMs())
                        .build();
            } else {
                circuitBreaker.onFailure(selected, result.latencyMs());
                log.warn("Provider {} failed for txn={}: {} — trying fallback",
                        selected.getName(), req.getTransactionId(), result.errorCode());
                // loop continues: attempt next provider
            }
        }

        log.error("All {} candidates failed for txn={}", candidates.size(), req.getTransactionId());
        return RouteResponse.builder()
                .success(false)
                .errorMessage("All available providers failed")
                .build();
    }

    private double providerScore(ProviderStats stats, double maxCostInverse, double maxLatencyInverse) {
        double costScore = (1.0 / stats.getCost()) / maxCostInverse;
        double latencyScore = (1.0 / Math.max(stats.getAvgLatencyMs(), 1)) / maxLatencyInverse;
        return (stats.getSuccessRate() * 0.5) + (costScore * 0.3) + (latencyScore * 0.2);
    }

    /** Weighted random index: probability of picking i ∝ score[i]. */
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
