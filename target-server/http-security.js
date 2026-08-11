'use strict';

const MAX_TARGET_REQUEST_BYTES = 2 * 1024 * 1024;

function isLoopbackHost(host) {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(host || ''));
}

function targetSecurityHeaders(req, res, next) {
  res.set('Content-Security-Policy', [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; '));
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set('Cache-Control', 'no-store');
  next();
}

function targetRequestProvenance(req, res, next) {
  const host = req.headers.host;
  if (!isLoopbackHost(host)) return res.status(421).json({ error: { code: 'LOCAL_ONLY', message: 'Local requests only' } });

  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!unsafe) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'http:' || parsed.host.toLowerCase() !== String(host).toLowerCase() || !isLoopbackHost(parsed.host)) {
        return res.status(403).json({ error: { code: 'CROSS_ORIGIN', message: 'Cross-origin requests are not allowed' } });
      }
    } catch (_) {
      return res.status(403).json({ error: { code: 'CROSS_ORIGIN', message: 'Cross-origin requests are not allowed' } });
    }
  }
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    return res.status(403).json({ error: { code: 'CROSS_SITE', message: 'Cross-site requests are not allowed' } });
  }
  next();
}

function targetRequestLimit(req, res, next) {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0) {
    return res.status(400).json({ error: { code: 'INVALID_CONTENT_LENGTH', message: 'Invalid Content-Length header' } });
  }
  if (declaredLength > MAX_TARGET_REQUEST_BYTES) {
    return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'Request body is too large' } });
  }
  let bytesRead = 0;
  let exceeded = false;
  const onData = chunk => {
    bytesRead += chunk.length;
    if (bytesRead > MAX_TARGET_REQUEST_BYTES && !exceeded) {
      exceeded = true;
      req.destroy(Object.assign(new Error('Target request body limit exceeded'), { code: 'REQUEST_TOO_LARGE' }));
    }
  };
  req.on('data', onData);
  req.once('end', () => req.off('data', onData));
  req.once('close', () => req.off('data', onData));
  next();
}

module.exports = {
  MAX_TARGET_REQUEST_BYTES,
  isLoopbackHost,
  targetRequestLimit,
  targetRequestProvenance,
  targetSecurityHeaders
};
