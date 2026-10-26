// Starts the server: `npm start`. Configuration comes from the environment.
//   PORT (8787), DB_PATH (living-writing.db), STATIC_DIR (dist, the built app), ALLOW_SIGNUP=false, SECURE_COOKIE=true
//   Story agent (off without a key): MODEL_API_KEY, META_API_BASE (https://api.meta.ai/v1), AGENT_MODEL (muse-spark-1.3)

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.ts';

const port = Number(process.env.PORT ?? 8787);
const staticDir = resolve(process.env.STATIC_DIR ?? 'dist');
const app = await buildApp({
  dbPath: process.env.DB_PATH ?? 'living-writing.db',
  allowSignup: process.env.ALLOW_SIGNUP !== 'false',
  secureCookie: process.env.SECURE_COOKIE === 'true',
  agent: process.env.MODEL_API_KEY
    ? { apiKey: process.env.MODEL_API_KEY, baseUrl: process.env.META_API_BASE ?? 'https://api.meta.ai/v1', model: process.env.AGENT_MODEL ?? 'muse-spark-1.3' }
    : undefined,
  // Without a build (npm run dev:server) only the API is served; Vite serves the app.
  staticDir: existsSync(staticDir) ? staticDir : undefined,
});
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
