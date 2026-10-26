import { defineConfig, devices } from '@playwright/test';

// The same app built for server mode, against a real server with a throwaway in-memory database.
export default defineConfig({
  testDir: './e2e/backend',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5175', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: 'node e2e/backend/standin-model.mjs', url: 'http://127.0.0.1:9912', reuseExistingServer: false, timeout: 30_000 },
    {
      command: 'node server/main.ts',
      url: 'http://127.0.0.1:8787/api/me',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { DB_PATH: ':memory:', MODEL_API_KEY: 'standin', META_API_BASE: 'http://127.0.0.1:9912/v1' },
    },
    { command: 'npx vite --mode backend --port 5175 --strictPort', url: 'http://localhost:5175', reuseExistingServer: false, timeout: 60_000 },
  ],
});
