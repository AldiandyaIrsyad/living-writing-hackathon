// Folder sync UI: the top-bar indicator, the connect flow, and the boot hook that restores the folder.
// The sync engine lives in store/fsSync.ts; this file decides which vault wins and talks to the store.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { filesToVault, vaultToFiles } from '../core/exchange';
import { settle, type Choice } from '../core/syncPlan';
import type { Vault } from '../core/types';
import { getSavedAt } from '../store/db';
import { BACKEND } from '../store/server';
import {
  applyOutside,
  backupFolderFiles,
  connectFolder,
  disconnectFolder,
  getSyncState,
  holdConflicts,
  holdUnreadable,
  isFolderSyncSupported,
  lookOutside,
  overwriteFolderWith,
  readFolderVault,
  requestAccess,
  restoreFolder,
  startAutoSync,
  subscribeSync,
  writeVault,
  type Conflict,
  type FolderInfo,
} from '../store/fsSync';
import { useStore } from '../store/store';
import { flushEditors } from './editor/Editor';
import './folder.css';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

const getVault = (): Vault => useStore.getState().vault;
const subscribeStore = (listener: () => void): (() => void) => useStore.subscribe(() => listener());

/** Same files, byte for byte, means the same vault as far as the folder is concerned. */
function sameVault(a: Vault, b: Vault): boolean {
  const fa = vaultToFiles(a);
  const fb = vaultToFiles(b);
  if (fa.size !== fb.size) return false;
  for (const [path, text] of fa) {
    if (fb.get(path) !== text) return false;
  }
  return true;
}

function loadIntoStore(vault: Vault): void {
  useStore.getState().replaceVault(vault);
  setTimeout(() => window.dispatchEvent(new Event('lw:timeline-fit')), 50);
}

/** Resolves once the vault from IndexedDB is in the store; before that the store is empty. */
function whenLoaded(): Promise<void> {
  return new Promise((resolve) => {
    if (useStore.getState().loaded) {
      resolve();
      return;
    }
    const unsubscribe = useStore.subscribe((s) => {
      if (s.loaded) {
        unsubscribe();
        resolve();
      }
    });
  });
}

/** Timestamps this close (ms) cannot tell which copy changed last. */
const CLOCK_TOLERANCE_MS = 2000;

/**
 * Reads the folder and brings it and the browser into line. Identical content: nothing to do.
 * Otherwise the newer copy wins: the folder's newest managed-file time against IndexedDB's last save.
 * If the two times are too close to call, the browser copy wins and the folder's files are kept
 * in .living-writing-backup first. Then keeps the folder in step with every change.
 */
async function syncFromFolder(): Promise<void> {
  const folder = await readFolderVault();
  const savedAt = (await getSavedAt()) ?? 0;
  const browserVault = getVault();
  if (!sameVault(folder.vault, browserVault)) {
    const gap = folder.modified - savedAt;
    if (gap > CLOCK_TOLERANCE_MS) {
      loadIntoStore(folder.vault); // the folder was changed after the browser last saved
    } else if (gap < -CLOCK_TOLERANCE_MS) {
      await writeBrowserCopy(browserVault); // the browser was changed after the folder was last written
    } else {
      const backup = await backupFolderFiles(folder.files);
      useStore.getState().toast('info', `Kept the folder's previous files in ${backup}.`);
      await writeBrowserCopy(browserVault);
    }
  }
  startAutoSync(getVault, subscribeStore, () => void absorbOutsideChanges());
}

let absorbing = false;

/**
 * The folder changed while the app was open. Reads it, plans file by file (see core/syncPlan.ts) and brings both sides
 * together: files only one side changed go with that side, files edited in different places are merged, and anything
 * edited in the same place waits for the writer's choice (`choices`). The vault changes as one undoable step, and
 * whatever either side loses is first copied to .living-writing-backup/.
 */
export async function absorbOutsideChanges(choices: Record<string, Choice> = {}): Promise<void> {
  if (absorbing) return;
  absorbing = true;
  const toast = (kind: 'error' | 'info', text: string) => useStore.getState().toast(kind, text);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      flushEditors(); // words typed in the last quarter second are not in the vault yet
      const ours = getVault();
      const look = await lookOutside(ours);
      const settled = settle(look.plan, look.ours, look.theirs, choices);
      if ('unresolved' in settled) {
        holdConflicts(look);
        return;
      }
      let merged: Vault;
      try {
        merged = filesToVault(settled.files);
      } catch (e) {
        holdUnreadable(errorMessage(e));
        return;
      }
      flushEditors();
      if (getVault() !== ours) continue; // the writer typed while the folder was being read: look again
      const mergedFiles = vaultToFiles(merged);
      const differs = mergedFiles.size !== look.ours.size || [...mergedFiles].some(([path, text]) => look.ours.get(path) !== text);
      if (differs) useStore.getState().commit(merged, undefined, 'Merge changes from the folder');
      const backup = await applyOutside(look, settled.files);
      toast(
        'info',
        differs ? `Picked up changes made outside the app. Undo puts them back.${backup ? ` Replaced files are kept in ${backup}.` : ''}` : backup ? `Folder updated. Replaced files are kept in ${backup}.` : 'The folder changed, but nothing needed merging.',
      );
      await writeBrowserCopy(getVault());
      return;
    }
    // The writer kept typing through every attempt; try again once they pause.
    setTimeout(() => void absorbOutsideChanges(choices), 2000);
  } catch (e) {
    toast('error', `Could not merge the folder's changes: ${errorMessage(e)}`);
  } finally {
    absorbing = false;
  }
}

/** Writes the browser copy to the folder. A failure is reported, and sync still starts so later edits retry. */
async function writeBrowserCopy(vault: Vault): Promise<void> {
  try {
    await writeVault(vault);
  } catch (e) {
    useStore.getState().toast('error', `Could not save to the folder: ${errorMessage(e)}`);
  }
}

/** Pick a folder, then decide which vault goes where. Used by the "Sync to folder" button and the popover. */
async function chooseFolder(): Promise<void> {
  const toast = (kind: 'error' | 'info', text: string) => useStore.getState().toast(kind, text);
  let info: FolderInfo;
  try {
    info = await connectFolder();
  } catch (e) {
    if (!isAbort(e)) toast('error', `Could not use that folder: ${errorMessage(e)}`);
    return;
  }

  if (info.hasVault && info.vault) {
    if (window.confirm(`Load the vault from ${info.name}? (Replaces what's in the browser)`)) {
      loadIntoStore(info.vault);
    } else if (!window.confirm(`Overwrite the vault files in ${info.name} with the vault in this browser? The files there will be replaced.`)) {
      await disconnectFolder();
      toast('info', 'Folder not connected. Its vault was left alone.');
      return;
    }
  }

  try {
    await writeVault(getVault());
    toast('info', `Syncing to ${info.name}.`);
  } catch (e) {
    toast('error', `Could not save to ${info.name}: ${errorMessage(e)}`);
  }
  // Keep watching even after a failed write: later edits retry, and the status says what went wrong.
  startAutoSync(getVault, subscribeStore, () => void absorbOutsideChanges());
}

/** Allow writing again, then bring the folder and the browser into line. Permission must come from this click. */
async function reconnect(): Promise<void> {
  const granted = await requestAccess();
  if (!granted) {
    useStore.getState().toast('info', 'Permission to the folder was not granted.');
    return;
  }
  try {
    await syncFromFolder();
  } catch (e) {
    useStore.getState().toast('error', `Could not read the folder: ${errorMessage(e)}`);
  }
}

async function stopSyncing(): Promise<void> {
  await disconnectFolder();
  useStore.getState().toast('info', 'Stopped syncing. The files stay in the folder.');
}

/** Restores the remembered folder once the vault has loaded. Call once, from App. */
let bootStarted = false;

export function useFolderSyncBoot(): void {
  useEffect(() => {
    if (bootStarted || BACKEND || !isFolderSyncSupported()) return;
    bootStarted = true;
    void (async () => {
      await whenLoaded();
      const restored = await restoreFolder();
      if (restored?.permission === 'granted') await syncFromFolder();
    })().catch((e: unknown) => console.error('Folder sync did not start', e));
  }, []);
}

function agoText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/** The current time, refreshed every second while `active`, so "Synced 2s ago" stays true. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Shown while the folder holds changes sync cannot settle alone: edits in the same place, or a folder it cannot read. */
export function FolderSyncBanner() {
  const sync = useSyncExternalStore(subscribeSync, getSyncState);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  if (sync.status !== 'changed') return null;
  const name = sync.folderName ?? 'the folder';

  if (sync.conflicts?.length) {
    const choose = (c: Conflict, choice: Choice) => {
      const next = { ...choices, [c.path]: choice };
      setChoices(next);
      if (sync.conflicts!.every((x) => next[x.path])) {
        setChoices({});
        void absorbOutsideChanges(next);
      }
    };
    return (
      <div className="folder-banner" role="alert" data-testid="folder-conflicts">
        <strong>Files in {name} were changed here and outside the app, in the same place.</strong>
        <p>Nothing is saved to the folder until you choose. The version you do not pick is kept in .living-writing-backup.</p>
        <ul>
          {sync.conflicts.map((c) => (
            <li key={c.path} data-testid="folder-conflict" data-path={c.path}>
              <span className="folder-banner-path">{c.path}</span>
              <button className={`btn btn-sm ${choices[c.path] === 'mine' ? 'active' : ''}`} onClick={() => choose(c, 'mine')}>
                {c.ours === null ? 'Keep it deleted here' : 'Keep mine'}
              </button>
              <button className={`btn btn-sm ${choices[c.path] === 'theirs' ? 'active' : ''}`} onClick={() => choose(c, 'theirs')}>
                {c.theirs === null ? 'Take the deletion' : 'Take theirs'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (sync.error) {
    return (
      <div className="folder-banner" role="alert" data-testid="folder-unreadable">
        <strong>{name} changed and cannot be read as a vault.</strong>
        <p>{sync.error}</p>
        <p>Nothing is saved to the folder until you choose.</p>
        <div className="folder-banner-actions">
          <button className="btn btn-sm" onClick={() => void absorbOutsideChanges()}>
            Check again
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => void overwriteFolderWith(getVault()).then((b) => useStore.getState().toast('info', `Folder replaced with this vault. What was there is kept in ${b}.`))}>
            Replace the folder with my vault
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="folder-banner" role="status" data-testid="folder-merging">
      Looking at changes made in {name}…
    </div>
  );
}

/** Top-bar indicator for folder sync. Renders nothing where the browser cannot use folders. */
export function FolderSyncStatus() {
  const sync = useSyncExternalStore(subscribeSync, getSyncState);
  const [open, setOpen] = useState(false);
  const now = useNow(sync.status === 'synced');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!isFolderSyncSupported()) return null;
  const name = sync.folderName ?? 'folder';

  if (sync.status === 'off') {
    return (
      <div className="folder-sync" data-testid="folder-sync" data-status="off">
        <button className="btn btn-sm" onClick={() => void chooseFolder()} title="Save the vault as Markdown files in a folder you choose">
          Sync to folder…
        </button>
      </div>
    );
  }

  if (sync.status === 'needs-permission') {
    return (
      <div className="folder-sync" data-testid="folder-sync" data-status="needs-permission">
        <button className="btn btn-sm folder-sync-reconnect" onClick={() => void reconnect()} title="Allow Living Writing to write to this folder again">
          Reconnect {name}
        </button>
      </div>
    );
  }

  const label =
    sync.status === 'syncing'
      ? 'Syncing…'
      : sync.status === 'synced'
        ? sync.lastSync !== undefined
          ? `Synced ${agoText(now - sync.lastSync)}`
          : 'Synced'
        : sync.status === 'changed'
          ? '⚠ Changed outside'
          : '⚠ Sync failed';

  return (
    <div className="folder-sync" data-testid="folder-sync" data-status={sync.status} ref={wrapRef}>
      <button
        className={`folder-sync-pill ${sync.status}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={sync.error ?? `Your vault is saved as Markdown files in ${name}`}
      >
        📁 {name} · {label}
      </button>
      {open && (
        <div className="menu folder-sync-menu" role="dialog" aria-label="Folder sync">
          <div className="folder-sync-title">{name}</div>
          <div className="folder-sync-meta">{sync.lastSync !== undefined ? `Last saved ${new Date(sync.lastSync).toLocaleTimeString()}` : 'Not saved yet'}</div>
          {sync.error && <div className="folder-sync-error">{sync.error}</div>}
          <p className="folder-sync-note">Your vault is saved as Markdown files in this folder.</p>
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false);
              void chooseFolder();
            }}
          >
            Open another folder…
          </button>
          <button
            className="menu-item btn-danger"
            onClick={() => {
              setOpen(false);
              void stopSyncing();
            }}
          >
            Stop syncing
          </button>
        </div>
      )}
    </div>
  );
}
