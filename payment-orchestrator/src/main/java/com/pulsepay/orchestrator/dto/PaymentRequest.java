package com.pulsepay.orchestrator.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

import java.math.BigDecimal;

@Data
public class PaymentRequest {

    @NotBlank
    private String idempotencyKey;

    @NotNull
    @DecimalMin("0.01")
    private BigDecimal amount;

    @NotBlank
    @Size(min = 3, max = 3)
    private String currency;

    @NotBlank
    private String merchantId;

    @NotBlank
    @Size(min = 4, max = 4)
    private String cardLast4;

    @NotBlank
    @Size(min = 2, max = 2)
    private String cardCountry;

    // Ledger account for the merchant
    private String accountId;
}
