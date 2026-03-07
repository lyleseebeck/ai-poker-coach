import { handleCoachHandRequest } from '../server/coach/http.js';

export default async function handler(req, res) {
  await handleCoachHandRequest(req, res);
}
