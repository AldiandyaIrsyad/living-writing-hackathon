// Server mode for development: the API server (restarts on change) and Vite, with the frontend built for it.
import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['--watch', 'server/main.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'backend'], { stdio: 'inherit' }),
];
// If either stops, stop both.
for (const child of children) {
  child.on('exit', (code) => {
    for (const other of children) other.kill();
    process.exit(code ?? 0);
  });
}
