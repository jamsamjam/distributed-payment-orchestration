package com.pulsepay.router.grpc;

import com.pulsepay.proto.router.ChargeRequest;
import com.pulsepay.proto.router.ChargeResponse;
import com.pulsepay.proto.router.RouterServiceGrpc;
import com.pulsepay.proto.router.VoidRequest;
import com.pulsepay.proto.router.VoidResponse;
import com.pulsepay.router.model.RouteRequest;
import com.pulsepay.router.service.RoutingService;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.devh.boot.grpc.server.service.GrpcService;

import java.math.BigDecimal;

@GrpcService
@RequiredArgsConstructor
@Slf4j
public class RouterGrpcService extends RouterServiceGrpc.RouterServiceImplBase {

    private final RoutingService routingService;

    @Override
    public void charge(ChargeRequest request, StreamObserver<ChargeResponse> responseObserver) {
        try {
            RouteRequest req = new RouteRequest();
            req.setTransactionId(request.getTransactionId());
            req.setAmount(BigDecimal.valueOf(request.getAmount()));
            req.setCurrency(request.getCurrency());
            req.setMerchantId(request.getMerchantId());
            req.setCardLast4(request.getCardLast4());
            req.setCardCountry(request.getCardCountry());

            var result = routingService.route(req);

            responseObserver.onNext(ChargeResponse.newBuilder()
                    .setSuccess(result.isSuccess())
                    .setProvider(result.getProvider() != null ? result.getProvider() : "")
                    .setProviderTxnId(result.getProviderTxnId() != null ? result.getProviderTxnId() : "")
                    .setRoutingReason(result.getRoutingReason() != null ? result.getRoutingReason() : "")
                    .setLatencyMs(result.getLatencyMs())
                    .setErrorMessage(result.getErrorMessage() != null ? result.getErrorMessage() : "")
                    .build());
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("gRPC charge failed: {}", e.getMessage());
            responseObserver.onNext(ChargeResponse.newBuilder()
                    .setSuccess(false)
                    .setErrorMessage(e.getMessage())
                    .build());
            responseObserver.onCompleted();
        }
    }

    @Override
    public void void_(VoidRequest request, StreamObserver<VoidResponse> responseObserver) {
        try {
            boolean ok = routingService.voidTransaction(request.getProvider(), request.getProviderTxnId());
            responseObserver.onNext(VoidResponse.newBuilder().setSuccess(ok).build());
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("gRPC void failed: {}", e.getMessage());
            responseObserver.onNext(VoidResponse.newBuilder().setSuccess(false).build());
            responseObserver.onCompleted();
        }
    }
}
