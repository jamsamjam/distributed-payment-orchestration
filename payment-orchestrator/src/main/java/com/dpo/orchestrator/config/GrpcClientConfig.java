package com.dpo.orchestrator.config;

import com.dpo.fraud.FraudServiceGrpc;
import com.dpo.ledger.LedgerServiceGrpc;
import com.dpo.router.RouterServiceGrpc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.grpc.client.GrpcChannelFactory;

@Configuration
public class GrpcClientConfig {

    @Bean
    FraudServiceGrpc.FraudServiceBlockingStub fraudStub(GrpcChannelFactory channels) {
        return FraudServiceGrpc.newBlockingStub(channels.createChannel("fraud-engine"));
    }

    @Bean
    LedgerServiceGrpc.LedgerServiceBlockingStub ledgerStub(GrpcChannelFactory channels) {
        return LedgerServiceGrpc.newBlockingStub(channels.createChannel("ledger-service"));
    }

    @Bean
    RouterServiceGrpc.RouterServiceBlockingStub routerStub(GrpcChannelFactory channels) {
        return RouterServiceGrpc.newBlockingStub(channels.createChannel("provider-router"));
    }
}
