package com.dpo.ledger.service;

import com.dpo.ledger.dto.BalanceResponse;
import com.dpo.ledger.dto.LedgerRequest;
import com.dpo.ledger.dto.LedgerResponse;
import com.dpo.ledger.model.Account;
import com.dpo.ledger.model.LedgerEntry;
import com.dpo.ledger.repository.AccountRepository;
import com.dpo.ledger.repository.LedgerEntryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class LedgerService {

    private final AccountRepository accountRepository;
    private final LedgerEntryRepository ledgerEntryRepository;

    @Transactional
    public LedgerResponse reserve(LedgerRequest req) {
        var existing = ledgerEntryRepository.findByIdempotencyKey(req.getIdempotencyKey());
        if (existing.isPresent()) {
            log.info("Idempotent reserve: key={}", req.getIdempotencyKey());
            return LedgerResponse.builder().success(true).entryId(existing.get().getId().toString()).build();
        }

        UUID accountId = UUID.fromString(req.getAccountId());
        Account account = accountRepository.findByIdForUpdate(accountId)
                .orElseThrow(() -> new IllegalArgumentException("Account not found: " + accountId));

        BigDecimal available = account.getBalance().subtract(account.getReserved());
        if (available.compareTo(req.getAmount()) < 0) {
            return LedgerResponse.builder()
                    .success(false)
                    .errorMessage("Insufficient funds: available=" + available + " requested=" + req.getAmount())
                    .build();
        }

        account.setReserved(account.getReserved().add(req.getAmount()));
        accountRepository.save(account);

        LedgerEntry entry = LedgerEntry.builder()
                .idempotencyKey(req.getIdempotencyKey())
                .accountId(accountId)
                .type(LedgerEntry.EntryType.RESERVE)
                .amount(req.getAmount())
                .referenceId(req.getReferenceId() != null ? UUID.fromString(req.getReferenceId()) : null)
                .build();

        try {
            entry = ledgerEntryRepository.save(entry);
        } catch (DataIntegrityViolationException e) {
            var race = ledgerEntryRepository.findByIdempotencyKey(req.getIdempotencyKey());
            return race.map(e2 -> LedgerResponse.builder().success(true).entryId(e2.getId().toString()).build())
                    .orElseThrow(() -> e);
        }

        log.info("Reserved amount={} account={} txn={}", req.getAmount(), accountId, req.getReferenceId());
        return LedgerResponse.builder().success(true).entryId(entry.getId().toString()).build();
    }

    @Transactional
    public LedgerResponse settle(LedgerRequest req) {
        var existing = ledgerEntryRepository.findByIdempotencyKey(req.getIdempotencyKey());
        if (existing.isPresent()) {
            log.info("Idempotent settle: key={}", req.getIdempotencyKey());
            return LedgerResponse.builder().success(true).entryId(existing.get().getId().toString()).build();
        }

        UUID accountId = UUID.fromString(req.getAccountId());
        Account account = accountRepository.findByIdForUpdate(accountId)
                .orElseThrow(() -> new IllegalArgumentException("Account not found: " + accountId));

        BigDecimal amount = req.getAmount();
        if (account.getReserved().compareTo(amount) < 0) {
            return LedgerResponse.builder()
                    .success(false)
                    .errorMessage("Reserved amount insufficient: reserved=" + account.getReserved() + " settling=" + amount)
                    .build();
        }

        account.setReserved(account.getReserved().subtract(amount));
        account.setBalance(account.getBalance().subtract(amount));
        accountRepository.save(account);

        LedgerEntry entry = LedgerEntry.builder()
                .idempotencyKey(req.getIdempotencyKey())
                .accountId(accountId)
                .type(LedgerEntry.EntryType.SETTLE)
                .amount(amount)
                .referenceId(req.getReferenceId() != null ? UUID.fromString(req.getReferenceId()) : null)
                .build();

        try {
            entry = ledgerEntryRepository.save(entry);
        } catch (DataIntegrityViolationException e) {
            var race = ledgerEntryRepository.findByIdempotencyKey(req.getIdempotencyKey());
            return race.map(e2 -> LedgerResponse.builder().success(true).entryId(e2.getId().toString()).build())
                    .orElseThrow(() -> e);
        }

        log.info("Settled amount={} account={} txn={}", amount, accountId, req.getReferenceId());
        return LedgerResponse.builder().success(true).entryId(entry.getId().toString()).build();
    }

    @Transactional
    public LedgerResponse release(String idempotencyKey, String referenceId) {
        var existing = ledgerEntryRepository.findByIdempotencyKey(idempotencyKey);
        if (existing.isPresent()) {
            log.info("Idempotent release: key={}", idempotencyKey);
            return LedgerResponse.builder().success(true).entryId(existing.get().getId().toString()).build();
        }

        UUID refId = UUID.fromString(referenceId);
        List<LedgerEntry> reservations = ledgerEntryRepository.findByReferenceId(refId).stream()
                .filter(e -> e.getType() == LedgerEntry.EntryType.RESERVE)
                .toList();

        if (reservations.isEmpty()) {
            log.warn("No reservation found for referenceId={}", referenceId);
            return LedgerResponse.builder().success(true).build();
        }

        BigDecimal totalReserved = reservations.stream()
                .map(LedgerEntry::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        UUID accountId = reservations.get(0).getAccountId();
        Account account = accountRepository.findByIdForUpdate(accountId)
                .orElseThrow(() -> new IllegalArgumentException("Account not found: " + accountId));

        BigDecimal toRelease = totalReserved.min(account.getReserved());
        account.setReserved(account.getReserved().subtract(toRelease));
        accountRepository.save(account);

        LedgerEntry entry = LedgerEntry.builder()
                .idempotencyKey(idempotencyKey)
                .accountId(accountId)
                .type(LedgerEntry.EntryType.RELEASE)
                .amount(toRelease)
                .referenceId(refId)
                .build();

        try {
            entry = ledgerEntryRepository.save(entry);
        } catch (DataIntegrityViolationException e) {
            var race = ledgerEntryRepository.findByIdempotencyKey(idempotencyKey);
            return race.map(e2 -> LedgerResponse.builder().success(true).entryId(e2.getId().toString()).build())
                    .orElseThrow(() -> e);
        }

        log.info("Released amount={} account={} txn={}", toRelease, accountId, referenceId);
        return LedgerResponse.builder().success(true).entryId(entry.getId().toString()).build();
    }

    @Transactional(readOnly = true)
    public BalanceResponse getBalance(String accountId) {
        Account account = accountRepository.findById(UUID.fromString(accountId))
                .orElseThrow(() -> new IllegalArgumentException("Account not found: " + accountId));
        BigDecimal available = account.getBalance().subtract(account.getReserved());
        return BalanceResponse.builder()
                .accountId(accountId)
                .balance(account.getBalance())
                .reserved(account.getReserved())
                .available(available)
                .currency(account.getCurrency())
                .build();
    }
}
