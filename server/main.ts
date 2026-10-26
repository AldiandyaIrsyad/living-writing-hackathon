// Starts the server: `npm start`. Configuration comes from the environment.
//   PORT (8787), DB_PATH (living-writing.db), STATIC_DIR (dist, the built app), ALLOW_SIGNUP=false, SECURE_COOKIE=true
//   Story agent (off without a key): MODEL_API_KEY, META_API_BASE (https://api.meta.ai/v1), AGENT_MODELS (comma-separated,
//   the first is the default; see DEFAULT_MODELS)

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.ts';

// Meta's chat models (Model API docs, Oct 2026). Standard first: a "-contributor" model is cheaper, but what is sent to
// it may be used to train Meta's models.
const DEFAULT_MODELS = ['muse-spark-1.3', 'muse-spark-1.2', 'muse-spark-1.1', 'muse-wonder-1.0', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor'];

const port = Number(process.env.PORT ?? 8787);
const staticDir = resolve(process.env.STATIC_DIR ?? 'dist');
const app = await buildApp({
  dbPath: process.env.DB_PATH ?? 'living-writing.db',
  allowSignup: process.env.ALLOW_SIGNUP !== 'false',
  secureCookie: process.env.SECURE_COOKIE === 'true',
  agent: process.env.MODEL_API_KEY
    ? {
        apiKey: process.env.MODEL_API_KEY,
        baseUrl: process.env.META_API_BASE ?? 'https://api.meta.ai/v1',
        models: process.env.AGENT_MODELS?.split(',').map((m) => m.trim()).filter(Boolean) ?? DEFAULT_MODELS,
      }
    : undefined,
  // Without a build (npm run dev:server) only the API is served; Vite serves the app.
  staticDir: existsSync(staticDir) ? staticDir : undefined,
});
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
