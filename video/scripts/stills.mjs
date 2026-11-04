// Render QA stills from one bundle: node scripts/stills.mjs out/qa 100 250 ...
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';

const [outDir, ...frames] = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const composition = await selectComposition({ serveUrl, id: 'DemoFilm', inputProps: { bgm: false } });
for (const f of frames.map(Number)) {
  await renderStill({ serveUrl, composition, frame: f, output: path.resolve(outDir, `f${String(f).padStart(4, '0')}.jpg`), imageFormat: 'jpeg', jpegQuality: 85, inputProps: { bgm: false }, chromiumOptions: { gl: 'angle' } });
  console.log('still', f);
}
