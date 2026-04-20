package com.dpo.router.model;

public enum CircuitBreakerState {
    CLOSED,     // Normal operation — requests flow through
    OPEN,       // Tripped — reject all requests immediately
    HALF_OPEN   // Recovery probe — allow one request to test
}
