export function createCoachError(message, options = {}) {
  const error = new Error(message);
  error.statusCode = Number.isFinite(options.statusCode) ? options.statusCode : 500;
  error.code = options.code || 'COACH_ERROR';
  if (options.details != null) {
    error.details = options.details;
  }
  return error;
}
