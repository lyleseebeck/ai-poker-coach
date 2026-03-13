import { handleHandNormalizeRequest } from '../server/normalize/http.js';

export default async function handler(req, res) {
  await handleHandNormalizeRequest(req, res);
}
