package com.dpo.orchestrator.dto;

import com.dpo.orchestrator.model.Transaction;

import java.util.Arrays;
import java.util.List;

public class TransactionMapper {

    private TransactionMapper() {}

    public static PaymentResponse toResponse(Transaction txn) {
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
