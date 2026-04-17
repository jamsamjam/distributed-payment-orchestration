import logging
import time

from grpc import aio as grpc_aio

import fraud_pb2
import fraud_pb2_grpc
from app.models import TransactionRequest
from app.scorer import score_transaction

logger = logging.getLogger("fraud-engine.grpc")


class FraudServicer(fraud_pb2_grpc.FraudServiceServicer):

    def __init__(self, history_store):
        self.history_store = history_store

    async def ScoreTransaction(self, request, context):
        start = time.monotonic()

        txn_req = TransactionRequest(
            transaction_id=request.transaction_id,
            amount=request.amount,
            currency=request.currency,
            merchant_id=request.merchant_id,
            card_last4=request.card_last4,
            card_country=request.card_country,
            timestamp=request.timestamp.ToDatetime(),
        )

        try:
            velocity_count = await self.history_store.record_velocity(
                txn_req.card_last4, txn_req.transaction_id, txn_req.timestamp
            )
            history = await self.history_store.get_history(txn_req.card_last4, velocity_count)
        except Exception as e:
            logger.warning("Redis unavailable in gRPC handler, scoring without history: %s", e)
            from app.models import UserHistory
            history = UserHistory()

        result = score_transaction(txn_req, history)
        elapsed_ms = int((time.monotonic() - start) * 1000)
        result.latency_ms = elapsed_ms

        try:
            await self.history_store.record_profile(
                txn_req.card_last4, txn_req.amount, txn_req.card_country, txn_req.timestamp
            )
        except Exception as e:
            logger.warning("Failed to record transaction history in gRPC handler: %s", e)

        logger.info(
            "gRPC scored txn=%s score=%d decision=%s latency_ms=%d",
            txn_req.transaction_id, result.score, result.decision, elapsed_ms,
        )

        return fraud_pb2.FraudResponse(
            transaction_id=txn_req.transaction_id,
            score=result.score,
            decision=result.decision,
            reasons=result.reasons,
            latency_ms=elapsed_ms,
        )


async def serve(port: int, history_store) -> grpc_aio.Server:
    server = grpc_aio.server()
    fraud_pb2_grpc.add_FraudServiceServicer_to_server(FraudServicer(history_store), server)
    server.add_insecure_port(f"[::]:{port}")
    await server.start()
    logger.info("gRPC server listening on port %d", port)
    return server
