import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackEmailText, sendFeedback, validateFeedbackPayload } from '../server/feedback/feedbackService.js';

test('validateFeedbackPayload rejects invalid reply emails', () => {
  assert.throws(
    () =>
      validateFeedbackPayload({
        message: 'Something broke',
        replyEmail: 'not-an-email',
      }),
    (error) => error?.code === 'FEEDBACK_INVALID' && Number(error?.statusCode) === 400
  );
});

test('buildFeedbackEmailText includes message, metadata, and attachment names', () => {
  const text = buildFeedbackEmailText(
    {
      message: 'Board cards did not save.',
      replyEmail: 'user@example.com',
      attachments: [{ filename: 'board.jpg', sizeBytes: 1234 }],
      context: { page: '/', userAgent: 'UnitTest/1.0' },
    },
    new Date('2026-03-21T17:05:00.000Z')
  );

  assert.match(text, /Board cards did not save/i);
  assert.match(text, /Reply email: user@example.com/i);
  assert.match(text, /Attachment files:/i);
  assert.match(text, /board\.jpg/i);
});

test('sendFeedback posts a Resend payload with reply-to and attachments', async () => {
  let capturedRequest = null;

  const result = await sendFeedback(
    {
      message: 'The hand importer froze.',
      replyEmail: 'grinder@example.com',
      attachments: [
        {
          filename: 'import-issue.jpg',
          contentType: 'image/jpeg',
          contentBase64: 'aGVsbG8=',
        },
      ],
      context: {
        page: '/',
        userAgent: 'UnitTest/1.0',
      },
    },
    {
      env: {
        RESEND_API_KEY: 'resend-key',
        FEEDBACK_TO_EMAIL: 'owner@example.com',
        FEEDBACK_FROM_EMAIL: 'coach@example.com',
      },
      now: new Date('2026-03-21T17:05:00.000Z'),
      fetchImpl: async (url, init) => {
        capturedRequest = {
          url: String(url),
          init,
        };
        return new Response(JSON.stringify({ id: 'email_123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    }
  );

  const requestBody = JSON.parse(capturedRequest.init.body);
  assert.equal(result.ok, true);
  assert.equal(capturedRequest.url, 'https://api.resend.com/emails');
  assert.equal(requestBody.reply_to, 'grinder@example.com');
  assert.equal(requestBody.to, 'owner@example.com');
  assert.equal(requestBody.from, 'coach@example.com');
  assert.equal(requestBody.attachments.length, 1);
  assert.equal(requestBody.attachments[0].filename, 'import-issue.jpg');
  assert.equal(requestBody.attachments[0].content, 'aGVsbG8=');
  assert.match(requestBody.text, /The hand importer froze/i);
});

test('sendFeedback surfaces provider failures as delivery errors', async () => {
  await assert.rejects(
    () =>
      sendFeedback(
        {
          message: 'The coach panel failed.',
          attachments: [],
          context: {},
        },
        {
          env: {
            RESEND_API_KEY: 'resend-key',
            FEEDBACK_TO_EMAIL: 'owner@example.com',
            FEEDBACK_FROM_EMAIL: 'coach@example.com',
          },
          fetchImpl: async () =>
            new Response(JSON.stringify({ message: 'provider down' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }),
        }
      ),
    (error) => error?.code === 'FEEDBACK_DELIVERY_FAILED' && Number(error?.statusCode) === 502
  );
});
