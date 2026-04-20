package com.dpo.router.controller;

import com.dpo.router.model.RouteRequest;
import com.dpo.router.model.RouteResponse;
import com.dpo.router.service.RoutingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/router")
@RequiredArgsConstructor
public class RouterController {

    private final RoutingService routingService;

    @PostMapping("/charge")
    public ResponseEntity<RouteResponse> charge(@RequestBody RouteRequest req) {
        RouteResponse response = routingService.route(req);
        return response.isSuccess()
                ? ResponseEntity.ok(response)
                : ResponseEntity.status(502).body(response);
    }

    @PostMapping("/void")
    public ResponseEntity<Map<String, Object>> voidTxn(@RequestBody Map<String, String> body) {
        String provider = body.get("provider");
        String providerTxnId = body.get("providerTxnId");
        boolean ok = routingService.voidTransaction(provider, providerTxnId);
        return ResponseEntity.ok(Map.of("success", ok));
    }

    @GetMapping("/health/providers")
    public ResponseEntity<Map<String, Object>> providerHealth() {
        return ResponseEntity.ok(routingService.getProviderHealth());
    }
}
