package com.dpo.ledger.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class LedgerResponse {
    private boolean success;
    private String entryId;
    private String errorMessage;
}
