package com.dpo.ledger.grpc;

import com.dpo.ledger.dto.LedgerRequest;
import com.dpo.ledger.service.LedgerService;
import com.dpo.ledger.GetBalanceRequest;
import com.dpo.ledger.LedgerServiceGrpc;
import com.dpo.ledger.ReleaseRequest;
import com.dpo.ledger.ReserveRequest;
import com.dpo.ledger.SettleRequest;
import com.dpo.ledger.BalanceResponse;
import com.dpo.ledger.LedgerResponse;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.grpc.server.service.GrpcService;

import java.math.BigDecimal;
import java.math.RoundingMode;

@GrpcService
@RequiredArgsConstructor
@Slf4j
public class LedgerGrpcService extends LedgerServiceGrpc.LedgerServiceImplBase {

    private final LedgerService ledgerService;

    @Override
    public void reserve(ReserveRequest request, StreamObserver<LedgerResponse> responseObserver) {
        try {
            LedgerRequest req = new LedgerRequest();
            req.setIdempotencyKey(request.getIdempotencyKey());
            req.setAccountId(request.getAccountId());
            req.setAmount(BigDecimal.valueOf(request.getAmountCents(), 2));
            req.setCurrency(request.getCurrency());
            req.setReferenceId(request.getReferenceId());

            var result = ledgerService.reserve(req);
            responseObserver.onNext(toProto(result));
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("gRPC reserve failed: {}", e.getMessage());
            responseObserver.onNext(errorResponse(e.getMessage()));
            responseObserver.onCompleted();
        }
    }

    @Override
    public void settle(SettleRequest request, StreamObserver<LedgerResponse> responseObserver) {
        try {
            LedgerRequest req = new LedgerRequest();
            req.setIdempotencyKey(request.getIdempotencyKey());
            req.setAccountId(request.getAccountId());
            req.setAmount(BigDecimal.valueOf(request.getAmountCents(), 2));
            req.setReferenceId(request.getReferenceId());

            var result = ledgerService.settle(req);
            responseObserver.onNext(toProto(result));
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("gRPC settle failed: {}", e.getMessage());
            responseObserver.onNext(errorResponse(e.getMessage()));
            responseObserver.onCompleted();
        }
    }

    @Override
    public void releaseReservation(ReleaseRequest request, StreamObserver<LedgerResponse> responseObserver) {
        try {
            var result = ledgerService.release(request.getIdempotencyKey(), request.getReferenceId());
            responseObserver.onNext(toProto(result));
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("gRPC releaseReservation failed: {}", e.getMessage());
            responseObserver.onNext(errorResponse(e.getMessage()));
            responseObserver.onCompleted();
        }
    }

    @Override
    public void getBalance(GetBalanceRequest request, StreamObserver<BalanceResponse> responseObserver) {
        try {
            var result = ledgerService.getBalance(request.getAccountId());
            responseObserver.onNext(BalanceResponse.newBuilder()
                    .setAccountId(result.getAccountId())
                    .setBalanceCents(toCents(result.getBalance()))
                    .setReservedCents(toCents(result.getReserved()))
                    .setAvailableCents(toCents(result.getAvailable()))
                    .setCurrency(result.getCurrency())
                    .build());
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("gRPC getBalance failed: {}", e.getMessage());
            responseObserver.onError(io.grpc.Status.NOT_FOUND
                    .withDescription(e.getMessage())
                    .asRuntimeException());
        }
    }

    private LedgerResponse toProto(com.dpo.ledger.dto.LedgerResponse result) {
        return LedgerResponse.newBuilder()
                .setSuccess(result.isSuccess())
                .setEntryId(result.getEntryId() != null ? result.getEntryId() : "")
                .setErrorMessage(result.getErrorMessage() != null ? result.getErrorMessage() : "")
                .build();
    }

    private LedgerResponse errorResponse(String message) {
        return LedgerResponse.newBuilder().setSuccess(false).setErrorMessage(message).build();
    }

    private long toCents(BigDecimal amount) {
        return amount.movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValue();
    }
}
