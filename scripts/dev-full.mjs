// Server mode for development: the API server (restarts on change) and Vite, with the frontend built for it.
// `--provider=gemini` points the story agent at Gemini instead of Meta. Keys can sit in .env.local (never committed).
// PORT (8787) and WEB_PORT (5173) move the server and the app, e.g. when another checkout already uses 5173.
import { spawn } from 'node:child_process';

const provider = process.argv.find((a) => a.startsWith('--provider='))?.slice('--provider='.length);
const env = provider ? { ...process.env, AGENT_PROVIDER: provider } : process.env;

const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--env-file-if-exists=.env.local', '--watch', 'server/main.ts'], { stdio: 'inherit', env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'backend'], { stdio: 'inherit' }),
];
// If either stops, stop both.
for (const child of children) {
  child.on('exit', (code) => {
    for (const other of children) other.kill();
    process.exit(code ?? 0);
  });
}
