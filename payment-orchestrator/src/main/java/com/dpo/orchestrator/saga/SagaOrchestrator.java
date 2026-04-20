package com.dpo.orchestrator.saga;

import com.dpo.fraud.FraudDecision;
import com.dpo.fraud.FraudRequest;
import com.dpo.fraud.FraudResponse;
import com.dpo.fraud.FraudServiceGrpc;
import com.dpo.ledger.LedgerServiceGrpc;
import com.dpo.ledger.ReleaseRequest;
import com.dpo.ledger.ReserveRequest;
import com.dpo.ledger.SettleRequest;
import com.dpo.orchestrator.dto.PaymentRequest;
import com.dpo.orchestrator.dto.PaymentResponse;
import com.dpo.orchestrator.dto.TransactionMapper;
import com.dpo.orchestrator.event.DomainEventPublisher;
import com.dpo.orchestrator.model.SagaStep;
import com.dpo.orchestrator.model.Transaction;
import com.dpo.orchestrator.repository.SagaStepRepository;
import com.dpo.orchestrator.repository.TransactionRepository;
import com.dpo.router.ChargeRequest;
import com.dpo.router.ChargeResponse;
import com.dpo.router.RouterServiceGrpc;
import com.dpo.router.VoidRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class SagaOrchestrator {

    private final TransactionRepository transactionRepo;
    private final SagaStepRepository sagaStepRepo;
    private final DomainEventPublisher eventPublisher;
    private final FraudServiceGrpc.FraudServiceBlockingStub fraudStub;
    private final LedgerServiceGrpc.LedgerServiceBlockingStub ledgerStub;
    private final RouterServiceGrpc.RouterServiceBlockingStub routerStub;

    @Value("${fraud.block-threshold:80}")
    private int fraudBlockThreshold;

    private static final String DEMO_ACCOUNT_ID = "a0000000-0000-0000-0000-000000000004";

    @Transactional
    public PaymentResponse execute(PaymentRequest req) {
        // ---- Step 1: VALIDATE (idempotency check) ----
        Optional<Transaction> existing = transactionRepo.findByIdempotencyKey(req.getIdempotencyKey());
        if (existing.isPresent()) {
            log.info("Idempotent return for key={}", req.getIdempotencyKey());
            return TransactionMapper.toResponse(existing.get());
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
            Instant now = Instant.now();
            FraudRequest fraudReq = FraudRequest.newBuilder()
                    .setTransactionId(txn.getId().toString())
                    .setAmountCents(toCents(txn.getAmount()))
                    .setCurrency(txn.getCurrency())
                    .setMerchantId(txn.getMerchantId())
                    .setCardLast4(txn.getCardLast4())
                    .setCardCountry(txn.getCardCountry())
                    .setTimestamp(com.google.protobuf.Timestamp.newBuilder()
                            .setSeconds(now.getEpochSecond())
                            .setNanos(now.getNano())
                            .build())
                    .build();

            FraudResponse fraudResp = fraudStub.scoreTransaction(fraudReq);
            int score = fraudResp.getScore();
            FraudDecision decision = fraudResp.getDecision();
            String decisionStr = decision == FraudDecision.FRAUD_DECISION_UNSPECIFIED ? "ALLOW" : decision.name();
            List<String> reasons = new ArrayList<>(fraudResp.getReasonsList());

            txn.setFraudScore(score);
            txn.setFraudDecision(decisionStr);
            txn.setFraudReasons(reasons.toArray(new String[0]));
            txn.setStatus(Transaction.TransactionStatus.FRAUD_CHECKED);
            txn = transactionRepo.save(txn);

            recordStep(txn.getId(), SagaStep.StepName.FRAUD_CHECK, SagaStep.StepStatus.COMPLETED, null);
            eventPublisher.publish("FRAUD_SCORED", txn, Map.of("fraudScore", score, "decision", decisionStr));

            if (decision == FraudDecision.BLOCK || score > fraudBlockThreshold) {
                txn.setStatus(Transaction.TransactionStatus.BLOCKED);
                txn.setErrorMessage("Blocked by fraud engine: score=" + score);
                txn = transactionRepo.save(txn);
                eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "FRAUD_BLOCKED"));
                return TransactionMapper.toResponse(txn);
            }
        } catch (Exception e) {
            log.error("Fraud check failed for txn={}: {}", txn.getId(), e.getMessage());
            recordStep(txn.getId(), SagaStep.StepName.FRAUD_CHECK, SagaStep.StepStatus.FAILED, e.getMessage());
            txn.setFraudScore(0);
            txn.setFraudDecision("ALLOW");
            txn = transactionRepo.save(txn);
        }

        // ---- Step 3: RESERVE ----
        String accountId = req.getAccountId() != null ? req.getAccountId() : DEMO_ACCOUNT_ID;
        String reserveKey = "reserve:" + txn.getId();
        boolean reserved = false;
        try {
            var reserveResp = ledgerStub.reserve(ReserveRequest.newBuilder()
                    .setIdempotencyKey(reserveKey)
                    .setAccountId(accountId)
                    .setAmountCents(toCents(txn.getAmount()))
                    .setCurrency(txn.getCurrency())
                    .setReferenceId(txn.getId().toString())
                    .build());

            reserved = reserveResp.getSuccess();
            if (reserved) {
                txn.setStatus(Transaction.TransactionStatus.RESERVED);
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.RESERVE, SagaStep.StepStatus.COMPLETED, null);
            } else {
                txn.setStatus(Transaction.TransactionStatus.FAILED);
                txn.setErrorMessage(reserveResp.getErrorMessage().isBlank() ? "Insufficient funds" : reserveResp.getErrorMessage());
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.RESERVE, SagaStep.StepStatus.FAILED, txn.getErrorMessage());
                eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "INSUFFICIENT_FUNDS"));
                return TransactionMapper.toResponse(txn);
            }
        } catch (Exception e) {
            log.error("Reserve failed for txn={}: {}", txn.getId(), e.getMessage());
            txn.setStatus(Transaction.TransactionStatus.FAILED);
            txn.setErrorMessage("Ledger reserve error: " + e.getMessage());
            txn = transactionRepo.save(txn);
            eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "LEDGER_ERROR"));
            return TransactionMapper.toResponse(txn);
        }

        // ---- Step 4: ROUTE ----
        long providerLatencyMs = 0;
        try {
            ChargeResponse chargeResp = routerStub.charge(ChargeRequest.newBuilder()
                    .setTransactionId(txn.getId().toString())
                    .setAmountCents(toCents(txn.getAmount()))
                    .setCurrency(txn.getCurrency())
                    .setMerchantId(txn.getMerchantId())
                    .setCardLast4(txn.getCardLast4())
                    .setCardCountry(txn.getCardCountry())
                    .build());

            if (chargeResp.getSuccess()) {
                providerLatencyMs = chargeResp.getLatencyMs();
                txn.setProvider(chargeResp.getProvider());
                txn.setProviderTxnId(chargeResp.getProviderTxnId());
                txn.setStatus(Transaction.TransactionStatus.ROUTED);
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.ROUTE, SagaStep.StepStatus.COMPLETED, null);
                eventPublisher.publish("ROUTED", txn, Map.of("provider", chargeResp.getProvider()));
            } else {
                compensateRelease(txn);
                String errMsg = chargeResp.getErrorMessage().isBlank() ? "Provider routing failed" : chargeResp.getErrorMessage();
                txn.setStatus(Transaction.TransactionStatus.FAILED);
                txn.setErrorMessage(errMsg);
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.ROUTE, SagaStep.StepStatus.FAILED, errMsg);
                eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "ROUTE_FAILED"));
                return TransactionMapper.toResponse(txn);
            }
        } catch (Exception e) {
            log.error("Routing failed for txn={}: {}", txn.getId(), e.getMessage());
            compensateRelease(txn);
            txn.setStatus(Transaction.TransactionStatus.FAILED);
            txn.setErrorMessage("Routing error: " + e.getMessage());
            txn = transactionRepo.save(txn);
            eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "ROUTING_ERROR"));
            return TransactionMapper.toResponse(txn);
        }

        // ---- Step 5: SETTLE ----
        try {
            var settleResp = ledgerStub.settle(SettleRequest.newBuilder()
                    .setIdempotencyKey("settle:" + txn.getId())
                    .setAccountId(accountId)
                    .setAmountCents(toCents(txn.getAmount()))
                    .setReferenceId(txn.getId().toString())
                    .build());

            if (settleResp.getSuccess()) {
                txn.setStatus(Transaction.TransactionStatus.SETTLED);
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.SETTLE, SagaStep.StepStatus.COMPLETED, null);
            } else {
                compensateVoid(txn);
                compensateRelease(txn);
                txn.setStatus(Transaction.TransactionStatus.FAILED);
                txn.setErrorMessage("Ledger settlement failed");
                txn = transactionRepo.save(txn);
                recordStep(txn.getId(), SagaStep.StepName.SETTLE, SagaStep.StepStatus.COMPENSATED, "Settlement failed");
                eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "SETTLE_FAILED"));
                return TransactionMapper.toResponse(txn);
            }
        } catch (Exception e) {
            log.error("Settle failed for txn={}: {}", txn.getId(), e.getMessage());
            compensateVoid(txn);
            compensateRelease(txn);
            txn.setStatus(Transaction.TransactionStatus.FAILED);
            txn.setErrorMessage("Settlement error: " + e.getMessage());
            txn = transactionRepo.save(txn);
            eventPublisher.publish("TRANSACTION_FAILED", txn, Map.of("reason", "SETTLE_ERROR"));
            return TransactionMapper.toResponse(txn);
        }

        // ---- Step 6: NOTIFY ----
        recordStep(txn.getId(), SagaStep.StepName.NOTIFY, SagaStep.StepStatus.COMPLETED, null);
        eventPublisher.publish("SETTLED", txn, Map.of("providerTxnId", txn.getProviderTxnId(), "latencyMs", providerLatencyMs));

        log.info("Transaction SETTLED: id={} provider={} amount={} {}",
                txn.getId(), txn.getProvider(), txn.getAmount(), txn.getCurrency());

        return TransactionMapper.toResponse(txn);
    }

    private void compensateRelease(Transaction txn) {
        try {
            ledgerStub.releaseReservation(ReleaseRequest.newBuilder()
                    .setIdempotencyKey("release:" + txn.getId())
                    .setReferenceId(txn.getId().toString())
                    .build());
            recordStep(txn.getId(), SagaStep.StepName.RESERVE, SagaStep.StepStatus.COMPENSATED, "Released");
            log.info("Compensated: released reservation for txn={}", txn.getId());
        } catch (Exception e) {
            log.error("Compensation (release) failed for txn={}: {}", txn.getId(), e.getMessage());
        }
    }

    private void compensateVoid(Transaction txn) {
        if (txn.getProvider() == null || txn.getProviderTxnId() == null) return;
        try {
            routerStub.void_(VoidRequest.newBuilder()
                    .setIdempotencyKey("void:" + txn.getId())
                    .setProvider(txn.getProvider())
                    .setProviderTxnId(txn.getProviderTxnId())
                    .build());
            recordStep(txn.getId(), SagaStep.StepName.ROUTE, SagaStep.StepStatus.COMPENSATED, "Voided");
            log.info("Compensated: voided provider charge for txn={}", txn.getId());
        } catch (Exception e) {
            log.error("Compensation (void) failed for txn={}: {}", txn.getId(), e.getMessage());
        }
    }

    private void recordStep(UUID txnId, SagaStep.StepName step, SagaStep.StepStatus status, String errorMsg) {
        sagaStepRepo.save(SagaStep.builder()
                .transactionId(txnId)
                .step(step)
                .status(status)
                .errorMessage(errorMsg)
                .build());
    }

    private long toCents(BigDecimal amount) {
        return amount.movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValue();
    }
}
