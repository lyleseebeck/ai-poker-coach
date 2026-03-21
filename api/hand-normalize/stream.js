import { handleHandNormalizeStreamRequest } from '../../server/normalize/http.js';

export default async function handler(req, res) {
  await handleHandNormalizeStreamRequest(req, res);
}
