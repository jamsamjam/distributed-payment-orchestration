"""
User/card transaction history using Redis sliding windows.
Velocity is recorded BEFORE scoring so concurrent requests count each other.
"""

import time
from datetime import datetime
from typing import Optional

import redis.asyncio as aioredis

from app.models import UserHistory


class HistoryStore:
    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client
        self.window_seconds = 600  # 10-minute velocity window

    async def record_velocity(self, card_last4: str, txn_id: str, timestamp: datetime) -> int:
        """
        Atomically add this transaction to the velocity sorted set and return
        the new count. Called BEFORE scoring so every concurrent request sees
        the others in the window.
        """
        key = f"fraud:history:{card_last4}:velocity"
        ts = timestamp.timestamp()
        cutoff = ts - self.window_seconds

        pipe = self.redis.pipeline()
        pipe.zadd(key, {txn_id: ts})                        # add this txn (unique member)
        pipe.zremrangebyscore(key, "-inf", cutoff)           # prune old entries
        pipe.zcount(key, cutoff, "+inf")                     # count in window
        pipe.expire(key, self.window_seconds * 2)
        results = await pipe.execute()

        return int(results[2] or 0)

    async def get_profile(self, card_last4: str) -> dict:
        """Read the card's profile hash (avg_amount, last_country, last_txn_timestamp)."""
        key = f"fraud:history:{card_last4}:profile"
        return await self.redis.hgetall(key) or {}

    async def get_history(self, card_last4: str, velocity_count: int) -> UserHistory:
        """Build a UserHistory from the pre-computed velocity count + stored profile."""
        profile = await self.get_profile(card_last4)

        def _str(v) -> str:
            return v.decode() if isinstance(v, bytes) else str(v) if v else ""

        avg_amount = float(_str(profile.get(b"avg_amount") or profile.get("avg_amount") or 0) or 0)
        last_country = _str(profile.get(b"last_country") or profile.get("last_country")) or None

        last_ts: Optional[datetime] = None
        raw_ts = profile.get(b"last_txn_timestamp") or profile.get("last_txn_timestamp")
        if raw_ts:
            try:
                last_ts = datetime.fromisoformat(_str(raw_ts))
            except ValueError:
                pass

        return UserHistory(
            txn_count_last_10min=velocity_count,
            avg_amount=avg_amount,
            last_country=last_country,
            last_txn_timestamp=last_ts,
        )

    async def record_profile(self, card_last4: str, amount: float, country: str, timestamp: datetime):
        """Update the card's profile after scoring (avg amount, last geo, last timestamp)."""
        key = f"fraud:history:{card_last4}:profile"
        count_key = f"fraud:history:{card_last4}:txn_count"

        count = await self.redis.incr(count_key)
        await self.redis.expire(count_key, 86400 * 7)

        profile = await self.redis.hgetall(key)

        def _str(v) -> str:
            return v.decode() if isinstance(v, bytes) else str(v) if v else "0"

        old_avg = float(_str(profile.get(b"avg_amount") or profile.get("avg_amount") or "0") or 0)
        new_avg = old_avg + (amount - old_avg) / count

        await self.redis.hset(key, mapping={
            "avg_amount": str(new_avg),
            "last_country": country,
            "last_txn_timestamp": timestamp.isoformat(),
        })
        await self.redis.expire(key, 86400 * 7)
