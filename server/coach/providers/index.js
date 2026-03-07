import { createCoachError } from '../errors.js';
import { createOpenRouterProvider } from './openRouterProvider.js';

export function getLlmProvider(name = process.env.COACH_PROVIDER || 'openrouter', options = {}) {
  const providerName = String(name || 'openrouter').trim().toLowerCase();

  if (providerName === 'openrouter') {
    return createOpenRouterProvider(options);
  }

  throw createCoachError(`Unsupported COACH_PROVIDER: ${providerName}`, {
    statusCode: 500,
    code: 'COACH_PROVIDER_UNSUPPORTED',
  });
}
