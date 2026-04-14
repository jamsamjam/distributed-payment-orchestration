package com.pulsepay.router.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pulsepay.router.model.RouteRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

@Component
@Slf4j
public class ProviderClient {

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final String providerMockUrl;

    // Provider path mapping
    private static final Map<String, String> CHARGE_PATHS = Map.of(
            "stripe", "/stripe/v1/charges",
            "adyen", "/adyen/v68/payments",
            "braintree", "/braintree/v1/transactions"
    );

    private static final Map<String, String> VOID_PATHS = Map.of(
            "stripe", "/stripe/v1/refunds",
            "adyen", "/adyen/v68/payments/%s/cancels",
            "braintree", "/braintree/v1/transactions/%s/void"
    );

    public ProviderClient(@Value("${provider.mock.url}") String providerMockUrl) {
        this.providerMockUrl = providerMockUrl;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
        this.objectMapper = new ObjectMapper();
    }

    public record ProviderResult(boolean success, String providerTxnId, String errorCode, long latencyMs) {}

    public ProviderResult charge(String providerName, RouteRequest req) {
        String path = CHARGE_PATHS.get(providerName);
        if (path == null) throw new IllegalArgumentException("Unknown provider: " + providerName);

        long start = System.currentTimeMillis();
        try {
            Map<String, Object> body = Map.of(
                    "transaction_id", req.getTransactionId(),
                    "amount", req.getAmount(),
                    "currency", req.getCurrency() != null ? req.getCurrency() : "USD",
                    "merchant_id", req.getMerchantId() != null ? req.getMerchantId() : ""
            );

            String json = objectMapper.writeValueAsString(body);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(providerMockUrl + path))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .timeout(Duration.ofSeconds(10))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            long latency = System.currentTimeMillis() - start;

            JsonNode node = objectMapper.readTree(response.body());
            boolean success = response.statusCode() == 200 && node.path("success").asBoolean(false);
            String providerTxnId = node.path("provider_txn_id").asText(null);
            String errorCode = node.path("error_code").asText(null);

            return new ProviderResult(success, providerTxnId, errorCode, latency);

        } catch (Exception e) {
            long latency = System.currentTimeMillis() - start;
            log.error("Provider {} charge failed: {}", providerName, e.getMessage());
            return new ProviderResult(false, null, "PROVIDER_UNREACHABLE", latency);
        }
    }

    public boolean voidTransaction(String providerName, String providerTxnId) {
        String pathTemplate = VOID_PATHS.get(providerName);
        if (pathTemplate == null) return true;

        String path = pathTemplate.contains("%s")
                ? String.format(pathTemplate, providerTxnId)
                : pathTemplate;

        try {
            String json = objectMapper.writeValueAsString(Map.of("provider_txn_id", providerTxnId));
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(providerMockUrl + path))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .timeout(Duration.ofSeconds(10))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            return response.statusCode() == 200;
        } catch (Exception e) {
            log.error("Void failed for provider={} txn={}: {}", providerName, providerTxnId, e.getMessage());
            return false;
        }
    }
}
