package com.dpo.router.model;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class RouteResponse {
    private boolean success;
    private String provider;
    private String providerTxnId;
    private String routingReason;
    private long latencyMs;
    private String errorMessage;
}
