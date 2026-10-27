// Starts the server: `npm start`. Configuration comes from the environment.
//   PORT (8787), DB_PATH (living-writing.db), STATIC_DIR (dist, the built app), ALLOW_SIGNUP=false, SECURE_COOKIE=true
//   Story agent (off without a key): AGENT_PROVIDER (meta, or gemini while there is no Meta key), then for Meta
//   META_API_KEY (or MODEL_API_KEY) and META_API_BASE, for Gemini GEMINI_API_KEY and GEMINI_API_BASE; AGENT_MODELS (comma-separated, the
//   first is the default) replaces the provider's list. `npm run dev:gemini` picks Gemini; keys can sit in .env.local.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.ts';

// The model services the story agent can use, both through their OpenAI-compatible chat endpoint. Meta's chat models
// (Model API docs, Oct 2026) list Standard first: a "-contributor" model is cheaper, but what is sent to it may be used
// to train Meta's models. Gemini (docs, Oct 2026) stands in while there is no Meta key.
const PROVIDERS = {
  meta: {
    name: 'Meta',
    key: process.env.META_API_KEY || process.env.MODEL_API_KEY,
    baseUrl: process.env.META_API_BASE ?? 'https://api.meta.ai/v1',
    models: ['muse-spark-1.3', 'muse-spark-1.2', 'muse-spark-1.1', 'muse-wonder-1.0', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor'],
  },
  gemini: {
    name: 'Google Gemini',
    key: process.env.GEMINI_API_KEY,
    baseUrl: process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-3.8-flash'],
  },
};
const provider = process.env.AGENT_PROVIDER === 'gemini' ? PROVIDERS.gemini : PROVIDERS.meta;

const port = Number(process.env.PORT ?? 8787);
const staticDir = resolve(process.env.STATIC_DIR ?? 'dist');
const app = await buildApp({
  dbPath: process.env.DB_PATH ?? 'living-writing.db',
  allowSignup: process.env.ALLOW_SIGNUP !== 'false',
  secureCookie: process.env.SECURE_COOKIE === 'true',
  agent: provider.key
    ? {
        provider: provider.name,
        apiKey: provider.key,
        baseUrl: provider.baseUrl,
        models: process.env.AGENT_MODELS?.split(',').map((m) => m.trim()).filter(Boolean) ?? provider.models,
        timeoutMs: process.env.AGENT_TIMEOUT_SECONDS ? Number(process.env.AGENT_TIMEOUT_SECONDS) * 1000 : undefined,
      }
    : undefined,
  // Without a build (npm run dev:server) only the API is served; Vite serves the app.
  staticDir: existsSync(staticDir) ? staticDir : undefined,
});
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
