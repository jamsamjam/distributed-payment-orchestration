package com.dpo.ledger.controller;

import com.dpo.ledger.dto.BalanceResponse;
import com.dpo.ledger.dto.LedgerRequest;
import com.dpo.ledger.dto.LedgerResponse;
import com.dpo.ledger.service.LedgerService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/ledger")
@RequiredArgsConstructor
@Slf4j
public class LedgerController {

    private final LedgerService ledgerService;

    @PostMapping("/reserve")
    public ResponseEntity<LedgerResponse> reserve(@Valid @RequestBody LedgerRequest req) {
        LedgerResponse response = ledgerService.reserve(req);
        return response.isSuccess()
                ? ResponseEntity.ok(response)
                : ResponseEntity.unprocessableEntity().body(response);
    }

    @PostMapping("/settle")
    public ResponseEntity<LedgerResponse> settle(@Valid @RequestBody LedgerRequest req) {
        LedgerResponse response = ledgerService.settle(req);
        return response.isSuccess()
                ? ResponseEntity.ok(response)
                : ResponseEntity.unprocessableEntity().body(response);
    }

    @PostMapping("/release")
    public ResponseEntity<LedgerResponse> release(@RequestBody Map<String, String> body) {
        String idempotencyKey = body.get("idempotencyKey");
        String referenceId = body.get("referenceId");
        if (idempotencyKey == null || referenceId == null) {
            return ResponseEntity.badRequest().body(
                LedgerResponse.builder().success(false).errorMessage("idempotencyKey and referenceId required").build()
            );
        }
        LedgerResponse response = ledgerService.release(idempotencyKey, referenceId);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/balance/{accountId}")
    public ResponseEntity<BalanceResponse> getBalance(@PathVariable String accountId) {
        return ResponseEntity.ok(ledgerService.getBalance(accountId));
    }
}
