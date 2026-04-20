package com.dpo.ledger.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

import java.math.BigDecimal;

@Data
public class LedgerRequest {

    @NotBlank
    private String idempotencyKey;

    @NotBlank
    private String accountId;

    @NotNull
    @DecimalMin("0.01")
    private BigDecimal amount;

    private String currency;

    private String referenceId;
}
