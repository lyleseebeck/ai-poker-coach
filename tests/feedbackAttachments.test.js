import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateBase64DecodedBytes,
  normalizeAttachmentFilename,
  validateFeedbackFiles,
} from '../src/lib/feedbackAttachments.js';

test('validateFeedbackFiles rejects unsupported image types', () => {
  assert.throws(
    () => validateFeedbackFiles([{ name: 'notes.pdf', type: 'application/pdf' }]),
    /Screenshots must be PNG, JPG, or WebP images/i
  );
});

test('validateFeedbackFiles rejects more than three screenshots', () => {
  assert.throws(
    () =>
      validateFeedbackFiles(
        [
          { name: '1.png', type: 'image/png' },
          { name: '2.png', type: 'image/png' },
        ],
        2
      ),
    /up to 3 screenshots/i
  );
});

test('normalizeAttachmentFilename swaps the extension to match the output type', () => {
  assert.equal(normalizeAttachmentFilename('table-crop.png', 'image/jpeg'), 'table-crop.jpg');
  assert.equal(normalizeAttachmentFilename('river-shot.webp', 'image/webp'), 'river-shot.webp');
});

test('estimateBase64DecodedBytes estimates decoded payload size', () => {
  assert.equal(estimateBase64DecodedBytes('aGVsbG8='), 5);
});
