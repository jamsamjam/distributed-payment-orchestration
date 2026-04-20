package com.dpo.orchestrator.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.dpo.orchestrator.model.Transaction;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
@Slf4j
public class DomainEventPublisher {

    @Value("${redis.stream.events-key:dpo:events}")
    private String streamKey;

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public void publish(String eventType, Transaction txn, Map<String, Object> extraPayload) {
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("transactionId", txn.getId().toString());
            payload.put("amount", txn.getAmount());
            payload.put("currency", txn.getCurrency());
            payload.put("merchantId", txn.getMerchantId());
            payload.put("status", txn.getStatus().name());
            if (txn.getFraudScore() != null) payload.put("fraudScore", txn.getFraudScore());
            if (txn.getFraudDecision() != null) payload.put("fraudDecision", txn.getFraudDecision());
            if (txn.getProvider() != null) payload.put("provider", txn.getProvider());
            if (extraPayload != null) payload.putAll(extraPayload);

            Map<String, Object> event = Map.of(
                    "eventId", UUID.randomUUID().toString(),
                    "transactionId", txn.getId().toString(),
                    "type", eventType,
                    "timestamp", Instant.now().toString(),
                    "payload", payload
            );

            String json = objectMapper.writeValueAsString(event);

            // Publish to Redis Stream
            redisTemplate.opsForStream().add(
                    streamKey,
                    Map.of("data", json)
            );

        } catch (Exception e) {
            log.error("Failed to publish event type={} txn={}: {}", eventType, txn.getId(), e.getMessage());
        }
    }
}
