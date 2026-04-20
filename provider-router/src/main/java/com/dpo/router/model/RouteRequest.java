package com.dpo.router.model;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class RouteRequest {
    private String transactionId;
    private BigDecimal amount;
    private String currency;
    private String merchantId;
    private String cardLast4;
    private String cardCountry;
}
