import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { registerCoachHandEndpoint } from './server/coach/http.js';
import { registerFeedbackEndpoint } from './server/feedback/http.js';
import { registerHandNormalizeEndpoint } from './server/normalize/http.js';

const handNormalizeApiPlugin = {
  name: 'hand-normalize-api',
  configureServer(server) {
    registerHandNormalizeEndpoint(server);
    registerCoachHandEndpoint(server);
    registerFeedbackEndpoint(server);
  },
  configurePreviewServer(server) {
    registerHandNormalizeEndpoint(server);
    registerCoachHandEndpoint(server);
    registerFeedbackEndpoint(server);
  },
};

export default defineConfig(({ mode }) => {
  // Ensure middleware-backed local API routes can read .env values via process.env.
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [react(), handNormalizeApiPlugin],
  };
});
