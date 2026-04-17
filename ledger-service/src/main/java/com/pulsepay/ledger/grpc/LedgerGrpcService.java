package com.pulsepay.ledger.grpc;

import com.pulsepay.ledger.dto.LedgerRequest;
import com.pulsepay.ledger.service.LedgerService;
import com.pulsepay.proto.ledger.BalanceResponse;
import com.pulsepay.proto.ledger.GetBalanceRequest;
import com.pulsepay.proto.ledger.LedgerServiceGrpc;
import com.pulsepay.proto.ledger.ReleaseRequest;
import com.pulsepay.proto.ledger.ReserveRequest;
import com.pulsepay.proto.ledger.SettleRequest;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.devh.boot.grpc.server.service.GrpcService;

import java.math.BigDecimal;

@GrpcService
@RequiredArgsConstructor
@Slf4j
public class LedgerGrpcService extends LedgerServiceGrpc.LedgerServiceImplBase {

    private final LedgerService ledgerService;

    @Override
    public void reserve(ReserveRequest request, StreamObserver<com.pulsepay.proto.ledger.LedgerResponse> responseObserver) {
        try {
            LedgerRequest req = new LedgerRequest();
            req.setIdempotencyKey(request.getIdempotencyKey());
            req.setAccountId(request.getAccountId());
            req.setAmount(BigDecimal.valueOf(request.getAmount()));
            req.setCurrency(request.getCurrency());
            req.setReferenceId(request.getReferenceId());

            var result = ledgerService.reserve(req);

            responseObserver.onNext(com.pulsepay.proto.ledger.LedgerResponse.newBuilder()
                    .setSuccess(result.isSuccess())
                    .setEntryId(result.getEntryId() != null ? result.getEntryId() : "")
                    .setErrorMessage(result.getErrorMessage() != null ? result.getErrorMessage() : "")
                    .build());
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("gRPC reserve failed: {}", e.getMessage());
            responseObserver.onNext(com.pulsepay.proto.ledger.LedgerResponse.newBuilder()
                    .setSuccess(false)
                    .setErrorMessage(e.getMessage())
                    .build());
            responseObserver.onCompleted();
        }
    }

    @Override
    public void settle(SettleRequest request, StreamObserver<com.pulsepay.proto.ledger.LedgerResponse> responseObserver) {
        try {
            LedgerRequest req = new LedgerRequest();
            req.setIdempotencyKey(request.getIdempotencyKey());
            req.setAccountId(request.getAccountId());
            req.setAmount(BigDecimal.valueOf(request.getAmount()));
            req.setReferenceId(request.getReferenceId());

            var result = ledgerService.settle(req);

            responseObserver.onNext(com.pulsepay.proto.ledger.LedgerResponse.newBuilder()
                    .setSuccess(result.isSuccess())
                    .setEntryId(result.getEntryId() != null ? result.getEntryId() : "")
                    .setErrorMessage(result.getErrorMessage() != null ? result.getErrorMessage() : "")
                    .build());
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("gRPC settle failed: {}", e.getMessage());
            responseObserver.onNext(com.pulsepay.proto.ledger.LedgerResponse.newBuilder()
                    .setSuccess(false)
                    .setErrorMessage(e.getMessage())
                    .build());
            responseObserver.onCompleted();
        }
    }

    @Override
    public void releaseReservation(ReleaseRequest request, StreamObserver<com.pulsepay.proto.ledger.LedgerResponse> responseObserver) {
        try {
            var result = ledgerService.release(request.getIdempotencyKey(), request.getReferenceId());

            responseObserver.onNext(com.pulsepay.proto.ledger.LedgerResponse.newBuilder()
                    .setSuccess(result.isSuccess())
                    .setEntryId(result.getEntryId() != null ? result.getEntryId() : "")
                    .setErrorMessage(result.getErrorMessage() != null ? result.getErrorMessage() : "")
                    .build());
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("gRPC releaseReservation failed: {}", e.getMessage());
            responseObserver.onNext(com.pulsepay.proto.ledger.LedgerResponse.newBuilder()
                    .setSuccess(false)
                    .setErrorMessage(e.getMessage())
                    .build());
            responseObserver.onCompleted();
        }
    }

    @Override
    public void getBalance(GetBalanceRequest request, StreamObserver<BalanceResponse> responseObserver) {
        try {
            var result = ledgerService.getBalance(request.getAccountId());

            responseObserver.onNext(BalanceResponse.newBuilder()
                    .setAccountId(result.getAccountId())
                    .setBalance(result.getBalance().doubleValue())
                    .setReserved(result.getReserved().doubleValue())
                    .setAvailable(result.getAvailable().doubleValue())
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
}
