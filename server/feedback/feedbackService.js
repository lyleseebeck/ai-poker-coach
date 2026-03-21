const RESEND_API_ENDPOINT = 'https://api.resend.com/emails';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_FEEDBACK_MESSAGE_LENGTH = 5_000;
export const MAX_FEEDBACK_ATTACHMENTS = 3;
export const MAX_FEEDBACK_ATTACHMENT_BYTES = 1_000_000;
export const MAX_FEEDBACK_TOTAL_ATTACHMENT_BYTES = 2_400_000;
export const FEEDBACK_ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function createFeedbackError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details != null) {
    error.details = details;
  }
  return error;
}

function toTrimmedString(value) {
  return String(value == null ? '' : value).trim();
}

function parseJsonSafely(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function estimateBase64DecodedBytes(base64) {
  const value = toTrimmedString(base64);
  if (!value) return 0;
  const paddingMatch = value.match(/=+$/);
  const paddingLength = paddingMatch ? paddingMatch[0].length : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - paddingLength);
}

function truncateDetail(value, maxLength = 300) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function validateOptionalEmail(value, label) {
  const trimmed = toTrimmedString(value);
  if (!trimmed) return '';
  if (!EMAIL_PATTERN.test(trimmed)) {
    throw createFeedbackError(`${label} must be a valid email address.`, 400, 'FEEDBACK_INVALID');
  }
  return trimmed;
}

function normalizeContext(value) {
  if (value == null) {
    return {
      page: '',
      userAgent: '',
    };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createFeedbackError('context must be an object when provided.', 400, 'FEEDBACK_INVALID');
  }

  return {
    page: toTrimmedString(value.page).slice(0, 300),
    userAgent: toTrimmedString(value.userAgent).slice(0, 500),
  };
}

function normalizeAttachment(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createFeedbackError(`attachments[${index}] must be an object.`, 400, 'FEEDBACK_INVALID');
  }

  const filename = toTrimmedString(value.filename);
  const contentType = toTrimmedString(value.contentType).toLowerCase();
  const contentBase64 = toTrimmedString(value.contentBase64);

  if (!filename) {
    throw createFeedbackError(`attachments[${index}].filename is required.`, 400, 'FEEDBACK_INVALID');
  }
  if (!FEEDBACK_ATTACHMENT_TYPES.includes(contentType)) {
    throw createFeedbackError(
      `attachments[${index}].contentType must be PNG, JPG, or WebP.`,
      400,
      'FEEDBACK_INVALID'
    );
  }
  if (!contentBase64) {
    throw createFeedbackError(`attachments[${index}].contentBase64 is required.`, 400, 'FEEDBACK_INVALID');
  }

  const sizeBytes = estimateBase64DecodedBytes(contentBase64);
  if (sizeBytes <= 0) {
    throw createFeedbackError(`attachments[${index}] is not valid base64 content.`, 400, 'FEEDBACK_INVALID');
  }
  if (sizeBytes > MAX_FEEDBACK_ATTACHMENT_BYTES) {
    throw createFeedbackError(
      `attachments[${index}] exceeds the ${MAX_FEEDBACK_ATTACHMENT_BYTES} byte limit.`,
      400,
      'FEEDBACK_INVALID'
    );
  }

  return {
    filename: filename.slice(0, 160),
    contentType,
    contentBase64,
    sizeBytes,
  };
}

export function validateFeedbackPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createFeedbackError('Feedback payload must be an object.', 400, 'FEEDBACK_INVALID');
  }

  const message = toTrimmedString(payload.message);
  if (!message) {
    throw createFeedbackError('message must be a non-empty string.', 400, 'FEEDBACK_INVALID');
  }
  if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
    throw createFeedbackError(
      `message exceeds the ${MAX_FEEDBACK_MESSAGE_LENGTH} character limit.`,
      400,
      'FEEDBACK_INVALID'
    );
  }

  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (attachments.length > MAX_FEEDBACK_ATTACHMENTS) {
    throw createFeedbackError(
      `attachments cannot exceed ${MAX_FEEDBACK_ATTACHMENTS} items.`,
      400,
      'FEEDBACK_INVALID'
    );
  }

  const normalizedAttachments = attachments.map((attachment, index) => normalizeAttachment(attachment, index));
  const totalAttachmentBytes = normalizedAttachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0);
  if (totalAttachmentBytes > MAX_FEEDBACK_TOTAL_ATTACHMENT_BYTES) {
    throw createFeedbackError(
      `attachments exceed the ${MAX_FEEDBACK_TOTAL_ATTACHMENT_BYTES} byte total limit.`,
      400,
      'FEEDBACK_INVALID'
    );
  }

  return {
    message,
    replyEmail: validateOptionalEmail(payload.replyEmail, 'replyEmail'),
    attachments: normalizedAttachments,
    context: normalizeContext(payload.context),
  };
}

export function buildFeedbackEmailText(payload, submittedAt = new Date()) {
  const lines = [
    'New feedback from AI Poker Coach',
    '',
    `Submitted at: ${submittedAt.toISOString()}`,
    `Reply email: ${payload.replyEmail || 'Not provided'}`,
    `Page: ${payload.context.page || 'Unknown'}`,
    `User agent: ${payload.context.userAgent || 'Unknown'}`,
    `Attachments: ${payload.attachments.length}`,
    '',
    'Message:',
    payload.message,
  ];

  if (payload.attachments.length > 0) {
    lines.push('', 'Attachment files:');
    for (const attachment of payload.attachments) {
      lines.push(`- ${attachment.filename} (${attachment.sizeBytes} bytes)`);
    }
  }

  return lines.join('\n');
}

export async function sendFeedback(payload, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const resendApiKey = toTrimmedString(env?.RESEND_API_KEY);
  const feedbackToEmail = validateOptionalEmail(env?.FEEDBACK_TO_EMAIL, 'FEEDBACK_TO_EMAIL');
  const feedbackFromEmail = validateOptionalEmail(env?.FEEDBACK_FROM_EMAIL, 'FEEDBACK_FROM_EMAIL');

  if (!resendApiKey || !feedbackToEmail || !feedbackFromEmail) {
    throw createFeedbackError(
      'Feedback email delivery is not configured. Set RESEND_API_KEY, FEEDBACK_TO_EMAIL, and FEEDBACK_FROM_EMAIL.',
      503,
      'FEEDBACK_CONFIG_ERROR'
    );
  }

  if (typeof fetchImpl !== 'function') {
    throw createFeedbackError('Feedback delivery fetch implementation is unavailable.', 503, 'FEEDBACK_CONFIG_ERROR');
  }

  const normalizedPayload = validateFeedbackPayload(payload);
  const submittedAt = options.now instanceof Date ? options.now : new Date();
  const response = await fetchImpl(RESEND_API_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: feedbackFromEmail,
      to: feedbackToEmail,
      subject: 'AI Poker Coach feedback',
      text: buildFeedbackEmailText(normalizedPayload, submittedAt),
      ...(normalizedPayload.replyEmail ? { reply_to: normalizedPayload.replyEmail } : {}),
      attachments: normalizedPayload.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.contentBase64,
      })),
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const bodyJson = parseJsonSafely(bodyText);
    throw createFeedbackError('Feedback email delivery failed.', 502, 'FEEDBACK_DELIVERY_FAILED', {
      providerStatus: response.status,
      providerMessage: truncateDetail(bodyJson?.message || bodyJson?.error || bodyText),
    });
  }

  return { ok: true };
}
