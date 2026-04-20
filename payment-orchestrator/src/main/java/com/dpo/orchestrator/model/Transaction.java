package com.dpo.orchestrator.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "transactions")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Transaction {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "idempotency_key", nullable = false, unique = true, length = 64)
    private String idempotencyKey;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private TransactionStatus status;

    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "merchant_id", length = 64)
    private String merchantId;

    @Column(name = "card_last4", length = 4)
    private String cardLast4;

    @Column(name = "card_country", length = 2)
    private String cardCountry;

    @Column(name = "fraud_score")
    private Integer fraudScore;

    @Column(name = "fraud_decision", length = 16)
    private String fraudDecision;

    @Column(name = "fraud_reasons", columnDefinition = "text[]")
    private String[] fraudReasons;

    @Column(name = "provider", length = 32)
    private String provider;

    @Column(name = "provider_txn_id", length = 128)
    private String providerTxnId;

    @Column(name = "error_message")
    private String errorMessage;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    public enum TransactionStatus {
        INITIATED, FRAUD_CHECKED, RESERVED, ROUTED, SETTLED, FAILED, BLOCKED
    }
}
