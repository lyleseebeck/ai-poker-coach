import { handleCoachHandStreamRequest } from '../../server/coach/http.js';

export default async function handler(req, res) {
  await handleCoachHandStreamRequest(req, res);
}
