import os
import time
import logging
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

from app.history import HistoryStore
from app.models import FraudScore, TransactionRequest
from app.scorer import score_transaction
from app import grpc_server

# ==============================
# Logging
# ==============================
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("fraud-engine")

# ==============================
# Prometheus metrics
# ==============================
SCORE_COUNTER = Counter("fraud_scores_total", "Total fraud scores by decision", ["decision"])
SCORE_LATENCY = Histogram("fraud_score_latency_ms", "Scoring latency in ms",
                          buckets=[1, 5, 10, 25, 50, 100, 200, 500])

# ==============================
# App lifecycle
# ==============================
redis_client: aioredis.Redis = None
history_store: HistoryStore = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client, history_store
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    redis_client = aioredis.from_url(redis_url, decode_responses=False)
    history_store = HistoryStore(redis_client)
    logger.info("Connected to Redis at %s", redis_url)

    grpc_port = int(os.getenv("GRPC_PORT", "50051"))
    _grpc_server = await grpc_server.serve(grpc_port, history_store)

    yield

    await _grpc_server.stop(grace=5)
    await redis_client.aclose()


app = FastAPI(title="Fraud Engine", version="1.0.0", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    body = await request.body()
    logger.error("422 validation error — body: %s — errors: %s", body.decode(errors="replace"), exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==============================
# Routes
# ==============================

@app.post("/score", response_model=FraudScore)
async def score(req: TransactionRequest):
    start = time.monotonic()

    # Record velocity BEFORE scoring so concurrent requests count each other
    try:
        velocity_count = await history_store.record_velocity(
            req.card_last4, req.transaction_id, req.timestamp
        )
        history = await history_store.get_history(req.card_last4, velocity_count)
    except Exception as e:
        logger.warning("Redis unavailable, scoring without history: %s", e)
        from app.models import UserHistory
        history = UserHistory()

    result = score_transaction(req, history)

    elapsed_ms = int((time.monotonic() - start) * 1000)
    result.latency_ms = elapsed_ms

    # Update profile after scoring (best-effort)
    try:
        await history_store.record_profile(
            req.card_last4, req.amount, req.card_country, req.timestamp
        )
    except Exception as e:
        logger.warning("Failed to record transaction history: %s", e)

    # Metrics
    SCORE_COUNTER.labels(decision=result.decision).inc()
    SCORE_LATENCY.observe(elapsed_ms)

    logger.info(
        "Scored txn=%s score=%d decision=%s reasons=%s latency_ms=%d",
        req.transaction_id, result.score, result.decision, result.reasons, elapsed_ms
    )
    return result


@app.get("/health")
async def health():
    redis_ok = False
    try:
        await redis_client.ping()
        redis_ok = True
    except Exception:
        pass
    return {
        "status": "ok" if redis_ok else "degraded",
        "service": "fraud-engine",
        "redis": "ok" if redis_ok else "unavailable",
    }


@app.get("/metrics")
async def metrics():
    data = generate_latest()
    return Response(content=data, media_type=CONTENT_TYPE_LATEST)
