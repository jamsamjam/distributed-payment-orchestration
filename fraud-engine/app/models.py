from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Optional


class TransactionRequest(BaseModel):
    transaction_id: str
    amount: float = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)
    merchant_id: str
    card_last4: str
    card_country: str = Field(min_length=2, max_length=2)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class UserHistory(BaseModel):
    txn_count_last_10min: int = 0
    avg_amount: float = 0.0
    last_country: Optional[str] = None
    last_txn_timestamp: Optional[datetime] = None


class FraudScore(BaseModel):
    transaction_id: str
    score: int = Field(ge=0, le=100)
    decision: str  # ALLOW | FLAG | BLOCK
    reasons: List[str]
    latency_ms: int
