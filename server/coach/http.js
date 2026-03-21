import { coachHand, coachHandStream } from './coachService.js';
import {
  applyRateLimitHeaders,
  DEFAULT_COACH_RATE_LIMIT_PER_MINUTE,
  enforceIpRateLimit,
  resolveRequestsPerMinute,
} from '../rateLimit/upstashRateLimit.js';

const MAX_BODY_BYTES = 250_000;
const COACH_RATE_LIMIT_NAMESPACE = 'coach-hand';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function startNdjson(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
}

function writeNdjson(res, payload) {
  const line = `${JSON.stringify(payload)}\n`;
  if (typeof res.write === 'function') {
    res.write(line);
    return;
  }
  res.end(line);
}

function parseJsonText(raw) {
  if (!raw || !raw.trim()) return {};
  return JSON.parse(raw);
}

async function readJsonBody(req) {
  if (req?.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req?.body === 'string') {
    return parseJsonText(req.body);
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('Request body too large.');
        error.statusCode = 413;
        error.code = 'COACH_REQUEST_TOO_LARGE';
        reject(error);
        req.destroy();
        return;
      }

      raw += chunk.toString('utf8');
    });

    req.on('end', () => {
      try {
        resolve(parseJsonText(raw));
      } catch {
        const error = new Error('Invalid JSON body.');
        error.statusCode = 400;
        error.code = 'COACH_REQUEST_INVALID';
        reject(error);
      }
    });

    req.on('error', (error) => reject(error));
  });
}

export async function handleCoachHandRequest(req, res, options = {}) {
  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed. Use POST /api/coach-hand.',
      },
    });
    return;
  }

  const env = options.env || process.env;
  const coachHandImpl = typeof options.coachHandImpl === 'function' ? options.coachHandImpl : coachHand;
  const rateLimitImpl = typeof options.rateLimitImpl === 'function' ? options.rateLimitImpl : enforceIpRateLimit;
  const requestsPerMinute = resolveRequestsPerMinute(
    env?.RATE_LIMIT_COACH_PER_MINUTE,
    DEFAULT_COACH_RATE_LIMIT_PER_MINUTE
  );

  try {
    const rateLimitResult = await rateLimitImpl({
      req,
      namespace: COACH_RATE_LIMIT_NAMESPACE,
      requestsPerMinute,
      env,
      fetchImpl: options.fetchImpl,
      nowMs: options.nowMs,
    });

    if (!rateLimitResult?.allowed) {
      applyRateLimitHeaders(res, rateLimitResult);
      sendJson(res, 429, {
        error: {
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds || 1}s.`,
        },
      });
      return;
    }

    const body = await readJsonBody(req);
    const response = await coachHandImpl(body);
    sendJson(res, 200, response);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    const payload = {
      error: {
        code: error?.code || 'COACH_SERVER_ERROR',
        message: error?.message || 'Unexpected coach server error.',
      },
    };

    if (error?.details != null) {
      payload.error.details = error.details;
    }

    sendJson(res, statusCode, payload);
  }
}

export async function handleCoachHandStreamRequest(req, res, options = {}) {
  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed. Use POST /api/coach-hand/stream.',
      },
    });
    return;
  }

  const env = options.env || process.env;
  const coachHandStreamImpl = typeof options.coachHandStreamImpl === 'function' ? options.coachHandStreamImpl : coachHandStream;
  const rateLimitImpl = typeof options.rateLimitImpl === 'function' ? options.rateLimitImpl : enforceIpRateLimit;
  const requestsPerMinute = resolveRequestsPerMinute(
    env?.RATE_LIMIT_COACH_PER_MINUTE,
    DEFAULT_COACH_RATE_LIMIT_PER_MINUTE
  );

  try {
    const rateLimitResult = await rateLimitImpl({
      req,
      namespace: COACH_RATE_LIMIT_NAMESPACE,
      requestsPerMinute,
      env,
      fetchImpl: options.fetchImpl,
      nowMs: options.nowMs,
    });

    if (!rateLimitResult?.allowed) {
      applyRateLimitHeaders(res, rateLimitResult);
      sendJson(res, 429, {
        error: {
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds || 1}s.`,
        },
      });
      return;
    }

    const body = await readJsonBody(req);
    startNdjson(res);
    await coachHandStreamImpl(body, {
      writeEvent: async (event) => {
        writeNdjson(res, event);
      },
    });
    res.end();
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    const payload = {
      error: {
        code: error?.code || 'COACH_SERVER_ERROR',
        message: error?.message || 'Unexpected coach server error.',
      },
    };

    if (error?.details != null) {
      payload.error.details = error.details;
    }

    if (res.getHeader && res.getHeader('content-type')) {
      writeNdjson(res, { type: 'error', ...payload.error });
      res.end();
      return;
    }

    sendJson(res, statusCode, payload);
  }
}

export function registerCoachHandEndpoint(server) {
  server.middlewares.use('/api/coach-hand/stream', async (req, res) => {
    await handleCoachHandStreamRequest(req, res);
  });
  server.middlewares.use('/api/coach-hand', async (req, res) => {
    await handleCoachHandRequest(req, res);
  });
}
