/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** The short git hash of the checkout being built, or "dev" outside a repository. */
function buildHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILD__: JSON.stringify(buildHash()) },
  // /api only exists in server mode (npm run dev:full); the frontend-only app never calls it. WEB_PORT moves the app
  // (when 5173 is taken, say by another checkout) and PORT the server it talks to, as `npm run dev:full` passes both on.
  server: { port: Number(process.env.WEB_PORT ?? 5173), strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.PORT ?? 8787}` } },
  // jszip is loaded on demand; listing it keeps the dev server from discovering it late and reloading the page mid-session.
  optimizeDeps: { include: ['jszip'] },
  // CodeMirror markdown (with its HTML/CSS/JS grammars) and the vault exchange code needed at
  // boot for folder sync; fine for a local-first app.
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
    // The timing budget in bench.test.ts is judged while the other files run, so fewer workers than cores keep it honest.
    maxWorkers: 6,
  },
});
