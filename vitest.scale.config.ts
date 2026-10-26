import { defineConfig } from 'vitest/config';

// The scale benchmark (src/core/scale.report.ts): `npm run bench:scale`.
export default defineConfig({ test: { include: ['src/**/*.report.ts'], environment: 'node' } });
