package com.dpo.orchestrator.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "saga_steps")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SagaStep {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "transaction_id", nullable = false)
    private UUID transactionId;

    @Enumerated(EnumType.STRING)
    @Column(name = "step", nullable = false, length = 32)
    private StepName step;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private StepStatus status;

    @Column(name = "error_message")
    private String errorMessage;

    @Builder.Default
    @Column(name = "attempt", nullable = false)
    private Integer attempt = 0;

    @CreationTimestamp
    @Column(name = "executed_at", updatable = false)
    private Instant executedAt;

    public enum StepName {
        VALIDATE, FRAUD_CHECK, RESERVE, ROUTE, SETTLE, NOTIFY
    }

    public enum StepStatus {
        PENDING, COMPLETED, FAILED, COMPENSATED
    }
}
