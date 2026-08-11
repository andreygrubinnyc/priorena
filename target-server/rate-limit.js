'use strict';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_API_LIMIT = 600;
const DEFAULT_ASSET_LIMIT = 1_200;

function positiveInteger(value, fallback, label) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < 1) throw new TypeError(`${label} must be a positive integer`);
  return candidate;
}

function createTargetRateLimiter(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const windowMs = positiveInteger(options.windowMs, DEFAULT_WINDOW_MS, 'Rate-limit window');
  const limits = Object.freeze({
    api: positiveInteger(options.apiLimit, DEFAULT_API_LIMIT, 'API rate limit'),
    asset: positiveInteger(options.assetLimit, DEFAULT_ASSET_LIMIT, 'Asset rate limit')
  });
  const buckets = new Map();

  return function targetRateLimit(req, res, next) {
    const group = String(req.originalUrl || req.url || '').startsWith('/api/') ? 'api' : 'asset';
    const current = now();
    let bucket = buckets.get(group);
    if (!bucket || current >= bucket.resetAt) {
      bucket = { count: 0, resetAt: current + windowMs };
      buckets.set(group, bucket);
    }
    bucket.count += 1;
    res.set('X-RateLimit-Limit', String(limits[group]));
    res.set('X-RateLimit-Remaining', String(Math.max(0, limits[group] - bucket.count)));
    if (bucket.count > limits[group]) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - current) / 1000))));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many local requests' } });
    }
    return next();
  };
}

module.exports = {
  DEFAULT_API_LIMIT,
  DEFAULT_ASSET_LIMIT,
  DEFAULT_WINDOW_MS,
  createTargetRateLimiter
};
