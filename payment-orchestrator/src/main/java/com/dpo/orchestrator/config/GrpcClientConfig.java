package com.dpo.orchestrator.config;

import com.dpo.fraud.FraudServiceGrpc;
import com.dpo.ledger.LedgerServiceGrpc;
import com.dpo.router.RouterServiceGrpc;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class GrpcClientConfig {

    @Value("${FRAUD_ENGINE_HOST:localhost}")
    private String fraudHost;

    @Value("${FRAUD_ENGINE_GRPC_PORT:50051}")
    private int fraudPort;

    @Value("${LEDGER_HOST:localhost}")
    private String ledgerHost;

    @Value("${LEDGER_GRPC_PORT:50052}")
    private int ledgerPort;

    @Value("${PROVIDER_ROUTER_HOST:localhost}")
    private String routerHost;

    @Value("${PROVIDER_ROUTER_GRPC_PORT:50053}")
    private int routerPort;

    @Bean
    FraudServiceGrpc.FraudServiceBlockingStub fraudStub() {
        ManagedChannel channel = ManagedChannelBuilder
                .forAddress(fraudHost, fraudPort)
                .usePlaintext()
                .build();
        return FraudServiceGrpc.newBlockingStub(channel);
    }

    @Bean
    LedgerServiceGrpc.LedgerServiceBlockingStub ledgerStub() {
        ManagedChannel channel = ManagedChannelBuilder
                .forAddress(ledgerHost, ledgerPort)
                .usePlaintext()
                .build();
        return LedgerServiceGrpc.newBlockingStub(channel);
    }

    @Bean
    RouterServiceGrpc.RouterServiceBlockingStub routerStub() {
        ManagedChannel channel = ManagedChannelBuilder
                .forAddress(routerHost, routerPort)
                .usePlaintext()
                .build();
        return RouterServiceGrpc.newBlockingStub(channel);
    }
}
