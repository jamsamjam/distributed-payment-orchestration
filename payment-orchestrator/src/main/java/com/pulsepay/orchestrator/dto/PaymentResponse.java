package com.pulsepay.orchestrator.dto;

import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

@Data
@Builder
public class PaymentResponse {
    private String transactionId;
    private String status;
    private String provider;
    private String providerTxnId;
    private BigDecimal amount;
    private String currency;
    private Integer fraudScore;
    private String fraudDecision;
    private List<String> fraudReasons;
    private String errorMessage;
    private Instant createdAt;
}
