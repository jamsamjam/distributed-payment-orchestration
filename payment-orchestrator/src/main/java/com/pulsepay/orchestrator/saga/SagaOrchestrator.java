package com.pulsepay.orchestrator.saga;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pulsepay.orchestrator.dto.PaymentRequest;
import com.pulsepay.orchestrator.dto.PaymentResponse;
import com.pulsepay.orchestrator.event.DomainEventPublisher;
import com.pulsepay.orchestrator.model.SagaStep;
import com.pulsepay.orchestrator.model.Transaction;
import com.pulsepay.orchestrator.repository.SagaStepRepository;
import com.pulsepay.orchestrator.repository.TransactionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class SagaOrchestrator {

    private final TransactionRepository transactionRepo;
    private final SagaStepRepository sagaStepRepo;
    private final DomainEventPublisher eventPublisher;
    private final ObjectMapper objectMapper;

    @Value("${services.fraud-engine.url}")
    private String fraudEngineUrl;

    @Value("${services.provider-router.url}")
    private String providerRouterUrl;

    @Value("${services.ledger.url}")
    private String ledgerUrl;

    @Value("${fraud.block-threshold:80}")
    private int fraudBlockThreshold;

    @Value("${fraud.flag-threshold:50}")
    private int fraudFlagThreshold;

    @Value("${saga.max-retries:3}")
    private int maxRetries;

    @Value("${saga.retry-backoff-ms:500}")
    private long retryBackoffMs;

    // Default merchant account for demo; in prod this would be per-merchant config
    private static final String DEMO_ACCOUNT_ID = "a0000000-0000-0000-0000-000000000004";

    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    /**
     * Execute the full 6-step SAGA for a payment.
     * Idempotent: returns existing result if idempotency key is already present.
     */
    @Transactional
    public PaymentResponse execute(PaymentRequest req) {
        // ---- Step 1: VALIDATE (idempotency check) ----
        Optional<Transaction> existing = transactionRepo.findByIdempotencyKey(req.getIdempotencyKey());
        if (existing.isPresent()) {
            log.info("Idempotent return for key={}", req.getIdempotencyKey());
            return toResponse(existing.get());
        }

        Transaction txn = Transaction.builder()
                .idempotencyKey(req.getIdempotencyKey())
                .status(Transaction.TransactionStatus.INITIATED)
                .amount(req.getAmount())
                .currency(req.getCurrency())
                .merchantId(req.getMerchantId())
                .cardLast4(req.getCardLast4())
                .cardCountry(req.getCardCountry())
                .build();

        txn = transactionRepo.save(txn);
        recordStep(txn.getId(), SagaStep.StepName.VALIDATE, SagaStep.StepStatus.COMPLETED, null);
        eventPublisher.publish("TRANSACTION_INITIATED", txn, null);

        // ---- Step 2: FRAUD_CHECK ----
        try {
            JsonNode fraudResult = callFraudEngine(txn);
            int score = fraudResult.path("score").asInt(0);
            String decision = fraudResult.path("decision").asText("ALLOW");
            List<String> reasons = new ArrayList<>();
            fraudResult.path("reasons").forEach(r -> reasons.add(r.asText()));

            txn.setFraudScore(score);
            txn.setFraudDecision(decision);
            txn.setFraudReasons(reasons.toArray(new String[0]));
            txn.setStatus(Transaction.TransactionStatus.FRAUD_CHECKED);
            txn = transactionRepo.save(txn);

            recordStep(txn.getId(), SagaStep.StepName.FRAUD_CHECK, SagaStep.StepStatus.COMPLETED, null);
            eventPublisher.publish("FRAUD_SCORED", txn, Map.of("fraudScore", score, "decision", decision));

            if (score > fraudBlockThreshold) {
                txn.setStatus(Transaction.TransactionStatus.BLOCKED);
                txn.setErrorMessage("Blocked by fraud engine: score=" + score);
                txn = transactionRepo.save(txn);
                eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "FRAUD_BLOCKED"));
                return toResponse(txn);
            }
        } catch (Exception e) {
            log.error("Fraud check failed for txn={}: {}", txn.getId(), e.getMessage());
            recordStep(txn.getId(), SagaStep.StepName.FRAUD_CHECK, SagaStep.StepStatus.FAILED, e.getMessage());
            // Fraud check failure is non-blocking per spec — proceed with score=0
            txn.setFraudScore(0);
            txn.setFraudDecision("ALLOW");
            txn = transactionRepo.save(txn);
        }

        // ---- Step 3: RESERVE ----
        String accountId = req.getAccountId() != null ? req.getAccountId() : DEMO_ACCOUNT_ID;
        String reserveKey = "reserve:" + txn.getId();
        boolean reserved = false;
        try {
            reserved = callLedgerReserve(reserveKey, accountId, txn.getAmount(), txn.getCurrency(), txn.getId().toString());
            if (reserved) {
                txn.setStatus(Transaction.TransactionStatus.RESERVED);
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.RESERVE, SagaStep.StepStatus.COMPLETED, null);
            } else {
                txn.setStatus(Transaction.TransactionStatus.FAILED);
                txn.setErrorMessage("Insufficient funds");
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.RESERVE, SagaStep.StepStatus.FAILED, "Insufficient funds");
                eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "INSUFFICIENT_FUNDS"));
                return toResponse(txn);
            }
        } catch (Exception e) {
            log.error("Reserve failed for txn={}: {}", txn.getId(), e.getMessage());
            txn.setStatus(Transaction.TransactionStatus.FAILED);
            txn.setErrorMessage("Ledger reserve error: " + e.getMessage());
            txn = transactionRepo.save(txn);
            eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "LEDGER_ERROR"));
            return toResponse(txn);
        }

        // ---- Step 4: ROUTE ----
        JsonNode routeResult = null;
        boolean routeSuccess = false;
        long providerLatencyMs = 0;
        try {
            routeResult = callProviderRouter(txn);
            routeSuccess = routeResult.path("success").asBoolean(false);

            if (routeSuccess) {
                String provider = routeResult.path("provider").asText();
                String providerTxnId = routeResult.path("providerTxnId").asText();
                providerLatencyMs = routeResult.path("latencyMs").asLong(0);
                txn.setProvider(provider);
                txn.setProviderTxnId(providerTxnId);
                txn.setStatus(Transaction.TransactionStatus.ROUTED);
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.ROUTE, SagaStep.StepStatus.COMPLETED, null);
                eventPublisher.publish("ROUTED", txn, Map.of("provider", provider));
            } else {
                // Compensation: release reservation
                compensateRelease(txn, reserveKey);
                String errMsg = routeResult.path("errorMessage").asText("Provider routing failed");
                txn.setStatus(Transaction.TransactionStatus.FAILED);
                txn.setErrorMessage(errMsg);
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.ROUTE, SagaStep.StepStatus.FAILED, errMsg);
                eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "ROUTE_FAILED"));
                return toResponse(txn);
            }
        } catch (Exception e) {
            log.error("Routing failed for txn={}: {}", txn.getId(), e.getMessage());
            compensateRelease(txn, reserveKey);
            txn.setStatus(Transaction.TransactionStatus.FAILED);
            txn.setErrorMessage("Routing error: " + e.getMessage());
            txn = transactionRepo.save(txn);
            eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "ROUTING_ERROR"));
            return toResponse(txn);
        }

        // ---- Step 5: SETTLE ----
        try {
            String settleKey = "settle:" + txn.getId();
            boolean settled = callLedgerSettle(settleKey, accountId, txn.getAmount(), txn.getId().toString());
            if (settled) {
                txn.setStatus(Transaction.TransactionStatus.SETTLED);
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.SETTLE, SagaStep.StepStatus.COMPLETED, null);
            } else {
                // Compensation: void provider charge + release reservation
                compensateVoid(txn);
                compensateRelease(txn, reserveKey);
                txn.setStatus(Transaction.TransactionStatus.FAILED);
                txn.setErrorMessage("Ledger settlement failed");
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.SETTLE, SagaStep.StepStatus.COMPENSATED, "Settlement failed");
                eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "SETTLE_FAILED"));
                return toResponse(txn);
            }
        } catch (Exception e) {
            log.error("Settle failed for txn={}: {}", txn.getId(), e.getMessage());
            compensateVoid(txn);
            compensateRelease(txn, reserveKey);
            txn.setStatus(Transaction.TransactionStatus.FAILED);
            txn.setErrorMessage("Settlement error: " + e.getMessage());
            txn = transactionRepo.save(txn);
            eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "SETTLE_ERROR"));
            return toResponse(txn);
        }

        // ---- Step 6: NOTIFY ----
        recordStep(txn.getId(), SagaStep.StepName.NOTIFY, SagaStep.StepStatus.COMPLETED, null);
        eventPublisher.publish("SETTLED", txn, Map.of("providerTxnId", txn.getProviderTxnId(), "latencyMs", providerLatencyMs));

        log.info("Transaction SETTLED: id={} provider={} amount={} {}",
                txn.getId(), txn.getProvider(), txn.getAmount(), txn.getCurrency());

        return toResponse(txn);
    }

    // ==================== Downstream HTTP calls ====================

    private JsonNode callFraudEngine(Transaction txn) throws Exception {
        Map<String, Object> body = Map.of(
                "transaction_id", txn.getId().toString(),
                "amount", txn.getAmount(),
                "currency", txn.getCurrency(),
                "merchant_id", txn.getMerchantId(),
                "card_last4", txn.getCardLast4(),
                "card_country", txn.getCardCountry(),
                "timestamp", Instant.now().toString()
        );
        return httpPost(fraudEngineUrl + "/score", body);
    }

    private boolean callLedgerReserve(String idemKey, String accountId, BigDecimal amount,
                                       String currency, String referenceId) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("idempotencyKey", idemKey);
        body.put("accountId", accountId);
        body.put("amount", amount);
        body.put("currency", currency);
        body.put("referenceId", referenceId);
        JsonNode result = httpPost(ledgerUrl + "/ledger/reserve", body);
        return result.path("success").asBoolean(false);
    }

    private boolean callLedgerSettle(String idemKey, String accountId, BigDecimal amount,
                                      String referenceId) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("idempotencyKey", idemKey);
        body.put("accountId", accountId);
        body.put("amount", amount);
        body.put("referenceId", referenceId);
        JsonNode result = httpPost(ledgerUrl + "/ledger/settle", body);
        return result.path("success").asBoolean(false);
    }

    private JsonNode callProviderRouter(Transaction txn) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("transactionId", txn.getId().toString());
        body.put("amount", txn.getAmount());
        body.put("currency", txn.getCurrency());
        body.put("merchantId", txn.getMerchantId());
        body.put("cardLast4", txn.getCardLast4());
        body.put("cardCountry", txn.getCardCountry());
        return httpPost(providerRouterUrl + "/router/charge", body);
    }

    // ==================== Compensation ====================

    private void compensateRelease(Transaction txn, String reserveKey) {
        try {
            String releaseKey = "release:" + txn.getId();
            Map<String, Object> body = Map.of(
                    "idempotencyKey", releaseKey,
                    "referenceId", txn.getId().toString()
            );
            httpPost(ledgerUrl + "/ledger/release", body);
            recordStep(txn.getId(), SagaStep.StepName.RESERVE, SagaStep.StepStatus.COMPENSATED, "Released");
            log.info("Compensated: released reservation for txn={}", txn.getId());
        } catch (Exception e) {
            log.error("Compensation (release) failed for txn={}: {}", txn.getId(), e.getMessage());
        }
    }

    private void compensateVoid(Transaction txn) {
        if (txn.getProvider() == null || txn.getProviderTxnId() == null) return;
        try {
            Map<String, Object> body = Map.of(
                    "provider", txn.getProvider(),
                    "providerTxnId", txn.getProviderTxnId()
            );
            httpPost(providerRouterUrl + "/router/void", body);
            recordStep(txn.getId(), SagaStep.StepName.ROUTE, SagaStep.StepStatus.COMPENSATED, "Voided");
            log.info("Compensated: voided provider charge for txn={}", txn.getId());
        } catch (Exception e) {
            log.error("Compensation (void) failed for txn={}: {}", txn.getId(), e.getMessage());
        }
    }

    // ==================== Helpers ====================

    private JsonNode httpPost(String url, Map<String, Object> body) throws Exception {
        String json = objectMapper.writeValueAsString(body);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .timeout(Duration.ofSeconds(10))
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        return objectMapper.readTree(response.body());
    }

    private void recordStep(UUID txnId, SagaStep.StepName step, SagaStep.StepStatus status, String errorMsg) {
        sagaStepRepo.save(SagaStep.builder()
                .transactionId(txnId)
                .step(step)
                .status(status)
                .errorMessage(errorMsg)
                .build());
    }

    private PaymentResponse toResponse(Transaction txn) {
        return PaymentResponse.builder()
                .transactionId(txn.getId().toString())
                .status(txn.getStatus().name())
                .provider(txn.getProvider())
                .providerTxnId(txn.getProviderTxnId())
                .amount(txn.getAmount())
                .currency(txn.getCurrency())
                .fraudScore(txn.getFraudScore())
                .fraudDecision(txn.getFraudDecision())
                .fraudReasons(txn.getFraudReasons() != null ? Arrays.asList(txn.getFraudReasons()) : List.of())
                .errorMessage(txn.getErrorMessage())
                .createdAt(txn.getCreatedAt())
                .build();
    }
}
