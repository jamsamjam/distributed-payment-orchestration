package com.dpo.ledger.dto;

import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;

@Data
@Builder
public class BalanceResponse {
    private String accountId;
    private BigDecimal balance;
    private BigDecimal reserved;
    private BigDecimal available;
    private String currency;
}
