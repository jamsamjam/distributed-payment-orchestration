"""
Fraud scoring engine — multi-signal risk scoring per the PulsePay spec.
"""

from app.models import TransactionRequest, UserHistory, FraudScore


def score_transaction(txn: TransactionRequest, history: UserHistory) -> FraudScore:
    score = 0
    reasons = []

    # ------------------------------------------------------------------
    # Signal 1: Velocity check (weight: 30 pts)
    # ------------------------------------------------------------------
    recent_count = history.txn_count_last_10min
    if recent_count > 10:
        score += 30
        reasons.append("HIGH_VELOCITY")
    elif recent_count > 5:
        score += 15
        reasons.append("ELEVATED_VELOCITY")

    # ------------------------------------------------------------------
    # Signal 2: Amount deviation from user baseline (weight: 55 pts)
    # ------------------------------------------------------------------
    if history.avg_amount and history.avg_amount > 0:
        deviation = abs(txn.amount - history.avg_amount) / history.avg_amount
        if deviation > 5.0:
            score += 55
            reasons.append("AMOUNT_ANOMALY_EXTREME")
        elif deviation > 2.0:
            score += 25
            reasons.append("AMOUNT_ANOMALY")

    # ------------------------------------------------------------------
    # Signal 3: Geo-anomaly — impossible travel (weight: 30 pts)
    # ------------------------------------------------------------------
    if history.last_country and history.last_txn_timestamp:
        from datetime import timezone
        txn_ts = txn.timestamp
        last_ts = history.last_txn_timestamp

        # Normalise both to UTC-aware
        if txn_ts.tzinfo is None:
            txn_ts = txn_ts.replace(tzinfo=timezone.utc)
        if last_ts.tzinfo is None:
            last_ts = last_ts.replace(tzinfo=timezone.utc)

        diff_seconds = (txn_ts - last_ts).total_seconds()
        minutes_since_last = diff_seconds / 60 if diff_seconds > 0 else 0

        if txn.card_country != history.last_country and minutes_since_last < 60:
            score += 30
            reasons.append("GEO_IMPOSSIBLE_TRAVEL")

    # ------------------------------------------------------------------
    # Signal 4: Time-of-day risk (weight: 15 pts)
    # ------------------------------------------------------------------
    hour = txn.timestamp.hour
    if 2 <= hour <= 5:
        score += 15
        reasons.append("ODD_HOURS")

    # ------------------------------------------------------------------
    # Clamp and decide
    # ------------------------------------------------------------------
    final_score = min(score, 100)

    if final_score > 80:
        decision = "BLOCK"
    elif final_score > 50:
        decision = "FLAG"
    else:
        decision = "ALLOW"

    return FraudScore(
        transaction_id=txn.transaction_id,
        score=final_score,
        decision=decision,
        reasons=reasons,
        latency_ms=0,  # filled by caller
    )
