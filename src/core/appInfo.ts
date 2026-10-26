// Which build of the app this is, for About and for exports (so a bug report can name the build that wrote the file).
// Both values are filled in at build time by vite.config.ts; the fallbacks are for tools that do not run through Vite.

declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/** Short git hash of the build, or "dev" when none was available. */
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

/** "living-writing@1.0.0", written into exports. */
export const GENERATOR = `living-writing@${APP_VERSION}`;
