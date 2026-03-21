import { useRef, useState } from 'react';
import {
  ACCEPTED_FEEDBACK_IMAGE_TYPES,
  compressFeedbackFiles,
  MAX_FEEDBACK_ATTACHMENTS,
  validateFeedbackFiles,
} from '../lib/feedbackAttachments.js';
import { submitFeedback } from '../lib/feedbackClient.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidOptionalEmail(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  return EMAIL_PATTERN.test(trimmed);
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildClientContext() {
  if (typeof window === 'undefined') {
    return { page: '/', userAgent: '' };
  }

  return {
    page: `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`,
    userAgent: typeof navigator === 'undefined' ? '' : String(navigator.userAgent || ''),
  };
}

export function FeedbackForm() {
  const [message, setMessage] = useState('');
  const [replyEmail, setReplyEmail] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const fileInputRef = useRef(null);

  async function handleFileChange(event) {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    setErrorMessage('');
    setSuccessMessage('');

    try {
      validateFeedbackFiles(selectedFiles, attachments.length);
      setIsProcessingFiles(true);
      const nextAttachments = await compressFeedbackFiles(selectedFiles);
      setAttachments((current) => [...current, ...nextAttachments]);
    } catch (error) {
      setErrorMessage(error?.message || 'Could not add those screenshots.');
    } finally {
      setIsProcessingFiles(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleRemoveAttachment(indexToRemove) {
    setSuccessMessage('');
    setErrorMessage('');
    setAttachments((current) => current.filter((_, index) => index !== indexToRemove));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedMessage = String(message || '').trim();
    const trimmedEmail = String(replyEmail || '').trim();

    setErrorMessage('');
    setSuccessMessage('');

    if (!trimmedMessage) {
      setErrorMessage('Please tell me what happened.');
      return;
    }

    if (!isValidOptionalEmail(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address or leave it blank.');
      return;
    }

    try {
      setIsSubmitting(true);
      await submitFeedback({
        message: trimmedMessage,
        ...(trimmedEmail ? { replyEmail: trimmedEmail } : {}),
        attachments: attachments.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          contentBase64: attachment.contentBase64,
        })),
        context: buildClientContext(),
      });

      setMessage('');
      setReplyEmail('');
      setAttachments([]);
      setSuccessMessage('Thanks. Your feedback was sent.');
    } catch (error) {
      setErrorMessage(error?.message || 'Could not send feedback right now.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const isBusy = isSubmitting || isProcessingFiles;

  return (
    <section className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-lg font-medium text-slate-700 mb-1">Feedback</h2>
      <p className="text-sm text-slate-500 mb-4">Report a bug or send feedback.</p>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="feedback-message">
            What happened?
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            placeholder="Something broke, looked confusing, or could be better..."
            disabled={isBusy}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="feedback-email">
            Your email (optional)
          </label>
          <input
            id="feedback-email"
            type="email"
            value={replyEmail}
            onChange={(event) => setReplyEmail(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            placeholder="name@example.com"
            disabled={isBusy}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="feedback-screenshots">
            Screenshots (optional)
          </label>
          <input
            id="feedback-screenshots"
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FEEDBACK_IMAGE_TYPES.join(',')}
            multiple
            onChange={handleFileChange}
            disabled={isBusy || attachments.length >= MAX_FEEDBACK_ATTACHMENTS}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <p className="mt-1 text-xs text-slate-500">
            Up to {MAX_FEEDBACK_ATTACHMENTS} screenshots. PNG, JPG, or WebP.
          </p>
          {isProcessingFiles ? (
            <p className="mt-2 text-xs text-emerald-700">Optimizing screenshots for upload...</p>
          ) : null}
          {attachments.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {attachments.map((attachment, index) => (
                <li
                  key={`${attachment.filename}-${index}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate text-slate-700">
                    {attachment.filename} <span className="text-slate-400">({formatBytes(attachment.sizeBytes)})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(index)}
                    className="ml-3 shrink-0 text-sm font-medium text-slate-500 hover:text-slate-700"
                    disabled={isBusy}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {errorMessage ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {successMessage ? (
          <p
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
            role="status"
          >
            {successMessage}
          </p>
        ) : null}

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={isBusy}
        >
          {isSubmitting ? 'Sending...' : 'Send feedback'}
        </button>
      </form>
    </section>
  );
}
