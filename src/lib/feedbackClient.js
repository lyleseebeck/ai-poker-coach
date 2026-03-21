function parseJsonSafely(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractFeedbackErrorMessage(status, statusText, payloadText) {
  const payloadJson = parseJsonSafely(payloadText);
  const detail =
    payloadJson?.error?.message ||
    payloadJson?.error ||
    payloadJson?.message ||
    payloadText ||
    `${status} ${statusText}`;
  return `Feedback request failed: ${detail}`;
}

export async function submitFeedback(payload, options = {}) {
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
    signal: options.signal,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(extractFeedbackErrorMessage(response.status, response.statusText, text));
  }

  const json = parseJsonSafely(text);
  if (!json || json.ok !== true) {
    throw new Error('Feedback request failed: response was not valid JSON.');
  }

  return json;
}
