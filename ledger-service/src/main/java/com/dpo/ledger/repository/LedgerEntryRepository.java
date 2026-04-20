package com.dpo.ledger.repository;

import com.dpo.ledger.model.LedgerEntry;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LedgerEntryRepository extends JpaRepository<LedgerEntry, UUID> {
    Optional<LedgerEntry> findByIdempotencyKey(String idempotencyKey);
    List<LedgerEntry> findByAccountIdOrderByCreatedAtDesc(UUID accountId);
    List<LedgerEntry> findByReferenceId(UUID referenceId);
}
