// Export / import / clear — browser side of core/exchange.
import { exportJSON, exportMarkdownZip, importJSON, importMarkdownZip } from '../core/exchange';
import { createDemoVault } from '../core/seed';
import { starterVault } from '../core/presets';
import { clearStorage, flushPendingSave, useStore } from '../store/store';
import { flushEditors } from './editor/Editor';

function download(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fit the timeline once the new vault has rendered. */
function fitSoon() {
  setTimeout(() => window.dispatchEvent(new Event('lw:timeline-fit')), 50);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportVaultJSON() {
  flushEditors();
  download(exportJSON(useStore.getState().vault), `living-writing-${stamp()}.json`, 'application/json');
}

export async function exportVaultZip() {
  flushEditors();
  const bytes = await exportMarkdownZip(useStore.getState().vault);
  download(bytes as BlobPart, `living-writing-${stamp()}.zip`, 'application/zip');
}

export async function importVaultFile(file: File) {
  const s = useStore.getState();
  try {
    const vault = file.name.toLowerCase().endsWith('.json') ? importJSON(await file.text()) : await importMarkdownZip(await file.arrayBuffer());
    s.replaceVault(vault);
    fitSoon();
    s.toast('info', `Imported ${Object.keys(vault.entities).length} entities and ${Object.keys(vault.scenes).length} scenes.`);
  } catch (e) {
    s.toast('error', `Import failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function clearVault() {
  flushEditors();
  await flushPendingSave();
  await clearStorage();
  const s = useStore.getState();
  s.replaceVault(starterVault());
  s.navigate({ kind: 'home' });
}

export function loadDemo() {
  const s = useStore.getState();
  const hasContent = Object.keys(s.vault.entities).length + Object.keys(s.vault.scenes).length > 0;
  if (hasContent && !window.confirm('Replace the current vault with the demo world? Export first if you want to keep it.')) return;
  s.replaceVault(createDemoVault());
  fitSoon();
}

/** A big generated world (2,000 scenes) for trying the timeline at scale. */
export async function loadLargeSample() {
  const s = useStore.getState();
  if (!window.confirm('Replace the current vault with a large generated sample (2,000 scenes)? Export first if you want to keep your work.')) return;
  const { createPerfVault } = await import('../core/perfSeed');
  s.replaceVault(createPerfVault());
  fitSoon();
}
