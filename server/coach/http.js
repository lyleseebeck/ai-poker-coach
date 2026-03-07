import { coachHand } from './coachService.js';

const MAX_BODY_BYTES = 250_000;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
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

export async function handleCoachHandRequest(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed. Use POST /api/coach-hand.',
      },
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const response = await coachHand(body);
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

export function registerCoachHandEndpoint(server) {
  server.middlewares.use('/api/coach-hand', async (req, res) => {
    await handleCoachHandRequest(req, res);
  });
}
