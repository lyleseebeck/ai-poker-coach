import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { parseManualActionText } from './src/lib/manualActionParser.js';
import { registerCoachHandEndpoint } from './server/coach/http.js';

const MAX_BODY_BYTES = 200_000;

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error('Request body too large.');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      raw += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('Invalid JSON body.');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', (error) => reject(error));
  });
}

function mergeObject(base, extra) {
  return {
    ...(base || {}),
    ...(extra || {}),
  };
}

function averageConfidence(values) {
  const list = Object.values(values || {}).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (list.length === 0) return 0;
  return list.reduce((sum, n) => sum + n, 0) / list.length;
}

function buildNormalizeResponse(payload) {
  const manualActionText = String(payload?.manualActionText || '').trim();
  if (!manualActionText) {
    const err = new Error('manualActionText is required.');
    err.statusCode = 400;
    throw err;
  }

  const context = payload?.context || {};
  const boardCards = Array.isArray(context?.boardCards) ? context.boardCards.filter(Boolean) : [];
  const parsed = parseManualActionText(manualActionText, {
    heroPosition: context?.heroPosition || '',
    boardCardsCount: boardCards.length,
  });

  const deterministic = payload?.deterministicParse || null;
  const parsedFields = mergeObject(parsed.parsedFields, deterministic?.parsedFields);
  parsedFields.hero = mergeObject(parsed.parsedFields?.hero, deterministic?.parsedFields?.hero);
  parsedFields.result = mergeObject(parsed.parsedFields?.result, deterministic?.parsedFields?.result);
  parsedFields.board = mergeObject(parsed.parsedFields?.board, deterministic?.parsedFields?.board);
  parsedFields.heroStreetSummary = mergeObject(
    parsed.parsedFields?.heroStreetSummary,
    deterministic?.parsedFields?.heroStreetSummary
  );

  const confidenceByField = mergeObject(
    parsed.confidence?.byField,
    deterministic?.confidence?.byField
  );
  const evidenceSnippets = mergeObject(
    parsed.evidenceSnippets,
    deterministic?.evidenceSnippets
  );
  const missingSet = new Set([
    ...(parsed.missingRequired || []),
    ...(deterministic?.missingRequired || []),
  ]);

  const bb = toNumberOrNull(context?.stakes?.bb);
  const netBb = toNumberOrNull(parsedFields?.result?.netBb);
  const netChips = toNumberOrNull(parsedFields?.result?.netChips);

  if (bb && netBb == null && netChips != null) {
    parsedFields.result.netBb = Number((netChips / bb).toFixed(4));
    confidenceByField.result_netBb = Math.max(confidenceByField.result_netBb || 0, 0.9);
    evidenceSnippets['result.netBb'] =
      evidenceSnippets['result.netBb'] || `Derived from net chips ${netChips} and BB ${bb}`;
    missingSet.delete('result.netBb');
  }

  if (bb && netChips == null && netBb != null) {
    parsedFields.result.netChips = Number((netBb * bb).toFixed(4));
    confidenceByField.result_netChips = Math.max(confidenceByField.result_netChips || 0, 0.9);
    evidenceSnippets['result.netChips'] =
      evidenceSnippets['result.netChips'] || `Derived from net BB ${netBb} and BB ${bb}`;
  }

  if (!parsedFields.hero?.position && context?.heroPosition) {
    parsedFields.hero.position = String(context.heroPosition).trim().toUpperCase();
    confidenceByField.heroPosition = Math.max(confidenceByField.heroPosition || 0, 0.92);
    evidenceSnippets['hero.position'] = evidenceSnippets['hero.position'] || 'Used selected hero position context';
  }

  const missingRequired = Array.from(missingSet);
  const overallConfidence = Number(averageConfidence(confidenceByField).toFixed(3));

  return {
    parsedFields,
    confidenceByField,
    evidenceSnippets,
    missingRequired,
    needsUserInput: [...missingRequired],
    overallConfidence,
    model: 'local-contract-v1',
  };
}

function registerHandNormalizeEndpoint(server) {
  server.middlewares.use('/api/hand-normalize', async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, {
        error: { message: 'Method not allowed. Use POST /api/hand-normalize.' },
      });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const response = buildNormalizeResponse(body);
      json(res, 200, response);
    } catch (error) {
      const statusCode = error?.statusCode || 500;
      json(res, statusCode, {
        error: { message: error?.message || 'Unexpected normalize server error.' },
      });
    }
  });
}

const handNormalizeApiPlugin = {
  name: 'hand-normalize-api',
  configureServer(server) {
    registerHandNormalizeEndpoint(server);
    registerCoachHandEndpoint(server);
  },
  configurePreviewServer(server) {
    registerHandNormalizeEndpoint(server);
    registerCoachHandEndpoint(server);
  },
};

export default defineConfig(({ mode }) => {
  // Ensure middleware-backed local API routes can read .env values via process.env.
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [react(), handNormalizeApiPlugin],
  };
});
