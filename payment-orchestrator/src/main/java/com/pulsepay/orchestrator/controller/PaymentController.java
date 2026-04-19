package com.pulsepay.orchestrator.controller;

import com.pulsepay.orchestrator.dto.PaymentRequest;
import com.pulsepay.orchestrator.dto.PaymentResponse;
import com.pulsepay.orchestrator.dto.TransactionMapper;
import com.pulsepay.orchestrator.model.Transaction;
import com.pulsepay.orchestrator.repository.TransactionRepository;
import com.pulsepay.orchestrator.saga.SagaOrchestrator;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PaymentController {

    private final SagaOrchestrator sagaOrchestrator;
    private final TransactionRepository transactionRepository;

    @PostMapping("/payments")
    public ResponseEntity<PaymentResponse> initiatePayment(@Valid @RequestBody PaymentRequest req) {
        PaymentResponse response = sagaOrchestrator.execute(req);
        int httpStatus = switch (response.getStatus()) {
            case "SETTLED" -> 200;
            case "BLOCKED" -> 402;
            case "FAILED" -> 422;
            default -> 202;
        };
        return ResponseEntity.status(httpStatus).body(response);
    }

    @GetMapping("/payments/{id}")
    public ResponseEntity<PaymentResponse> getTransaction(@PathVariable String id) {
        return transactionRepository.findById(UUID.fromString(id))
                .map(txn -> ResponseEntity.ok(TransactionMapper.toResponse(txn)))
                .orElse(ResponseEntity.notFound().build());
    }
}
