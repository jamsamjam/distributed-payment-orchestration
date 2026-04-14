package com.pulsepay.router.service;

import com.pulsepay.router.model.CircuitBreakerState;
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
     * Selects the highest-scoring provider with a CLOSED or HALF_OPEN circuit.
     */
    public RouteResponse route(RouteRequest req) {
        // Normalize cost and latency across all providers for fair comparison
        double maxCostInverse = providers.values().stream()
                .mapToDouble(p -> 1.0 / p.getCost()).max().orElse(1.0);
        double maxLatencyInverse = providers.values().stream()
                .mapToDouble(p -> 1.0 / p.getAvgLatencyMs()).max().orElse(1.0);

        ProviderStats selected = null;
        double bestScore = Double.NEGATIVE_INFINITY;
        List<String> skipped = new ArrayList<>();

        for (ProviderStats stats : providers.values()) {
            if (!circuitBreaker.canRoute(stats)) {
                skipped.add(stats.getName() + "(" + stats.getCircuitState() + ")");
                continue;
            }

            double successRate = stats.getSuccessRate();
            double costScore = (1.0 / stats.getCost()) / maxCostInverse;
            double latencyScore = (1.0 / Math.max(stats.getAvgLatencyMs(), 1)) / maxLatencyInverse;

            double score = (successRate * 0.5) + (costScore * 0.3) + (latencyScore * 0.2);

            if (score > bestScore) {
                bestScore = score;
                selected = stats;
            }
        }

        if (selected == null) {
            log.error("All providers unavailable. Skipped: {}", skipped);
            return RouteResponse.builder()
                    .success(false)
                    .errorMessage("All payment providers are currently unavailable")
                    .build();
        }

        String reason = String.format("Selected %s (score=%.3f, successRate=%.2f%%, avgLatency=%.0fms, skipped=%s)",
                selected.getName(), bestScore, selected.getSuccessRate() * 100,
                selected.getAvgLatencyMs(), skipped);
        log.info("Routing txn={} → {}", req.getTransactionId(), reason);

        // Call provider
        ProviderClient.ProviderResult result = providerClient.charge(selected.getName(), req);

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
            log.warn("Provider {} failed for txn={}: {}", selected.getName(), req.getTransactionId(), result.errorCode());
            return RouteResponse.builder()
                    .success(false)
                    .provider(selected.getName())
                    .errorMessage(result.errorCode())
                    .latencyMs(result.latencyMs())
                    .build();
        }
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
