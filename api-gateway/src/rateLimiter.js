'use strict';
/**
 * Token Bucket rate limiter backed by Redis.
 * Each API key gets its own bucket.
 * maxTokens: maximum burst capacity
 * refillRate: tokens added per second
 */

const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local max_tokens = tonumber(ARGV[2])
local refill_rate = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if tokens == nil then
  tokens = max_tokens
  last_refill = now
end

-- Refill based on elapsed time
local elapsed = math.max(0, now - last_refill)
local refill = elapsed * refill_rate
tokens = math.min(max_tokens, tokens + refill)
last_refill = now

if tokens >= cost then
  tokens = tokens - cost
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('EXPIRE', key, 3600)
  return 1
else
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('EXPIRE', key, 3600)
  return 0
end
`;

class TokenBucketRateLimiter {
  constructor(redis, { maxTokens = 100, refillRate = 100 } = {}) {
    this.redis = redis;
    this.maxTokens = maxTokens;
    this.refillRate = refillRate; // tokens per second
    this._sha = null;
  }

  async _getSha() {
    if (!this._sha) {
      this._sha = await this.redis.script('load', SCRIPT);
    }
    return this._sha;
  }

  /**
   * Attempt to consume `cost` tokens for `apiKey`.
   * Returns { allowed: bool, retryAfterMs: number }
   */
  async consume(apiKey, cost = 1) {
    const key = `ratelimit:${apiKey}`;
    const now = Date.now() / 1000; // seconds with decimals
    try {
      const sha = await this._getSha();
      const result = await this.redis.evalsha(
        sha, 1, key,
        now.toString(),
        this.maxTokens.toString(),
        this.refillRate.toString(),
        cost.toString()
      );
      const allowed = result === 1;
      const retryAfterMs = allowed ? 0 : Math.ceil((cost / this.refillRate) * 1000);
      return { allowed, retryAfterMs };
    } catch (err) {
      // On Redis failure, fail open (allow)
      return { allowed: true, retryAfterMs: 0 };
    }
  }
}

module.exports = { TokenBucketRateLimiter };
