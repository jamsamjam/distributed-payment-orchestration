"""
User/card transaction history using Redis sliding windows.
Tracks velocity, amounts, and geo data for fraud scoring.
"""

import json
import time
from datetime import datetime, timezone
from typing import Optional

import redis.asyncio as aioredis

from app.models import UserHistory


class HistoryStore:
    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client
        self.window_seconds = 600  # 10 minutes for velocity

    async def get_history(self, card_last4: str, merchant_id: str) -> UserHistory:
        key_prefix = f"fraud:history:{card_last4}"

        # Pipeline all reads
        pipe = self.redis.pipeline()
        pipe.zcount(f"{key_prefix}:velocity", time.time() - self.window_seconds, "+inf")
        pipe.hgetall(f"{key_prefix}:profile")
        results = await pipe.execute()

        velocity_count = results[0] or 0
        profile = results[1] or {}

        avg_amount = float(profile.get(b"avg_amount", 0) or profile.get("avg_amount", 0))
        last_country = (profile.get(b"last_country") or profile.get("last_country") or b"").decode() if isinstance(
            profile.get(b"last_country") or profile.get("last_country", b""), bytes
        ) else str(profile.get(b"last_country") or profile.get("last_country", ""))

        last_ts_raw = profile.get(b"last_txn_timestamp") or profile.get("last_txn_timestamp")
        last_ts: Optional[datetime] = None
        if last_ts_raw:
            ts_str = last_ts_raw.decode() if isinstance(last_ts_raw, bytes) else str(last_ts_raw)
            if ts_str:
                try:
                    last_ts = datetime.fromisoformat(ts_str)
                except ValueError:
                    last_ts = None

        return UserHistory(
            txn_count_last_10min=int(velocity_count),
            avg_amount=avg_amount,
            last_country=last_country or None,
            last_txn_timestamp=last_ts,
        )

    async def record_transaction(self, card_last4: str, amount: float, country: str, timestamp: datetime):
        key_prefix = f"fraud:history:{card_last4}"
        ts = timestamp.timestamp()

        pipe = self.redis.pipeline()

        # Velocity: sorted set of timestamps
        pipe.zadd(f"{key_prefix}:velocity", {str(ts): ts})
        pipe.zremrangebyscore(f"{key_prefix}:velocity", "-inf", ts - self.window_seconds)
        pipe.expire(f"{key_prefix}:velocity", self.window_seconds * 2)

        # Profile: running average + geo
        pipe.hset(f"{key_prefix}:profile", mapping={
            "last_country": country,
            "last_txn_timestamp": timestamp.isoformat(),
        })

        # Update running average amount
        current_profile = await self.redis.hgetall(f"{key_prefix}:profile")
        count_key = f"{key_prefix}:txn_count"
        count = await self.redis.incr(count_key)
        old_avg = float(current_profile.get(b"avg_amount", 0) or current_profile.get("avg_amount", 0))
        new_avg = old_avg + (amount - old_avg) / count
        pipe.hset(f"{key_prefix}:profile", "avg_amount", str(new_avg))
        pipe.expire(f"{key_prefix}:profile", 86400 * 7)  # 7 days

        await pipe.execute()
