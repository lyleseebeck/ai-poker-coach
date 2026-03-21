import { handleFeedbackRequest } from '../server/feedback/http.js';

export default async function handler(req, res) {
  await handleFeedbackRequest(req, res);
}
