// Folder sync: keeps the vault as the same Markdown + YAML layout in a folder the user picks
// (File System Access API, Chromium/Edge). Browser-only. IndexedDB stays the cache. This module
// never touches the store: callers pass the vault in and receive it back.

import Dexie, { type Table } from 'dexie';
import { INDEX_FILE, filesToVault, vaultToFiles } from '../core/exchange';
import { conflictsOf, planSync, type Decision } from '../core/syncPlan';
import type { Vault } from '../core/types';

export type SyncStatusKind = 'off' | 'needs-permission' | 'syncing' | 'synced' | 'error' | 'changed';

export interface SyncState {
  status: SyncStatusKind;
  folderName?: string;
  /** Epoch ms of the last completed write. */
  lastSync?: number;
  error?: string;
  /** Managed files that changed in the folder behind the app's back and have not been taken in yet. Nothing is written while this is set. */
  changed?: string[];
  /** Files edited both here and outside in the same place: the writer chooses. */
  conflicts?: Conflict[];
}

export interface Conflict {
  path: string;
  /** The vault's version of the file (null: it has none). */
  ours: string | null;
  /** The folder's version (null: it was deleted there). */
  theirs: string | null;
}

export interface FolderInfo {
  name: string;
  hasVault: boolean;
  /** Present when `hasVault` is true: the vault the folder already holds. */
  vault?: Vault;
}

const PICKER_ID = 'living-writing';
const DEBOUNCE_MS = 1000;
const FOLDER_KEY = 'folder';

// ---------------------------------------------------------------------------
// The remembered folder handle (IndexedDB, separate from the vault database)
// ---------------------------------------------------------------------------

interface HandleRow {
  key: string;
  handle: FileSystemDirectoryHandle;
}

class FolderDB extends Dexie {
  constructor() {
    super('living-writing-fs');
    this.version(1).stores({ handles: 'key' });
  }
  handleRows(): Table<HandleRow, string> {
    return this.table('handles');
  }
}

let folderDb: FolderDB | null = null;

function handleRows(): Table<HandleRow, string> {
  folderDb ??= new FolderDB();
  return folderDb.handleRows();
}

// ---------------------------------------------------------------------------
// Observable state
// ---------------------------------------------------------------------------

let state: SyncState = { status: 'off' };
const listeners = new Set<() => void>();

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------
// Session: the connected folder and what is known to be on disk in it
// ---------------------------------------------------------------------------

/** What a file looked like when last seen: enough to notice a change without reading its text. */
interface FileMeta {
  size: number;
  modified: number;
}

interface Session {
  root: FileSystemDirectoryHandle;
  /** Text of every managed file as it is on disk: from the last write, or the last scan. */
  known: Map<string, string>;
  /** Size and modification time of those files at the same moment; null until the first scan or write gives a baseline. */
  meta: Map<string, FileMeta> | null;
}

let session: Session | null = null;

/** Writes and reads run one at a time, in call order. */
let chain: Promise<void> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isFolderSyncSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isDomError(e: unknown, name: string): boolean {
  return e instanceof DOMException && e.name === name;
}

/** The files this module owns: the index, and .md files under Entities/ and Stories/. Nothing else is read or deleted. */
function isManagedPath(path: string): boolean {
  if (path === INDEX_FILE) return true;
  return path.endsWith('.md') && (path.startsWith('Entities/') || path.startsWith('Stories/'));
}

function isFile(handle: FileSystemHandle): handle is FileSystemFileHandle {
  return handle.kind === 'file';
}

function isDirectory(handle: FileSystemHandle): handle is FileSystemDirectoryHandle {
  return handle.kind === 'directory';
}

/** What the folder holds: the managed files' text, and the newest of their modification times (epoch ms). */
interface FolderScan {
  files: Map<string, string>;
  meta: Map<string, FileMeta>;
  modified: number;
}

async function readInto(file: FileSystemFileHandle, path: string, scan: FolderScan): Promise<void> {
  const f = await file.getFile();
  scan.files.set(path, await f.text());
  scan.meta.set(path, { size: f.size, modified: f.lastModified });
  scan.modified = Math.max(scan.modified, f.lastModified);
}

/** Collects the managed files in the folder. Only the index and Entities/, Stories/ are walked. */
async function scanManagedFiles(root: FileSystemDirectoryHandle): Promise<FolderScan> {
  const scan: FolderScan = { files: new Map(), meta: new Map(), modified: 0 };
  for await (const entry of root.values()) {
    if (isFile(entry) && entry.name === INDEX_FILE) {
      await readInto(entry, INDEX_FILE, scan);
    } else if (isDirectory(entry) && (entry.name === 'Entities' || entry.name === 'Stories')) {
      await scanDirectory(entry, entry.name, scan);
    }
  }
  return scan;
}

async function scanDirectory(dir: FileSystemDirectoryHandle, prefix: string, scan: FolderScan): Promise<void> {
  for await (const entry of dir.values()) {
    const path = `${prefix}/${entry.name}`;
    if (isDirectory(entry)) {
      await scanDirectory(entry, path, scan);
    } else if (isFile(entry) && isManagedPath(path)) {
      await readInto(entry, path, scan);
    }
  }
}

/** Walks to a subfolder. `cache` holds the handles already reached in one pass. */
async function folderFor(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  create: boolean,
  cache: Map<string, FileSystemDirectoryHandle>,
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  let key = '';
  for (const segment of segments) {
    key = key === '' ? segment : `${key}/${segment}`;
    const hit = cache.get(key);
    if (hit) {
      dir = hit;
      continue;
    }
    dir = await dir.getDirectoryHandle(segment, { create });
    cache.set(key, dir);
  }
  return dir;
}

function splitPath(path: string): { folders: string[]; name: string } {
  const parts = path.split('/');
  const name = parts.pop() ?? path;
  return { folders: parts, name };
}

async function writeFile(
  root: FileSystemDirectoryHandle,
  path: string,
  text: string,
  cache: Map<string, FileSystemDirectoryHandle>,
): Promise<void> {
  const { folders, name } = splitPath(path);
  const dir = await folderFor(root, folders, true, cache);
  const file = await dir.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  try {
    await stream.write(text);
    await stream.close();
  } catch (e) {
    await stream.abort().catch(() => undefined);
    throw e;
  }
}

async function removeFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const { folders, name } = splitPath(path);
  try {
    const dir = await folderFor(root, folders, false, new Map());
    await dir.removeEntry(name);
  } catch (e) {
    if (!isDomError(e, 'NotFoundError')) throw e;
  }
}

async function requireWritable(root: FileSystemDirectoryHandle): Promise<void> {
  if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new DOMException('Permission to write to the folder was not granted.', 'NotAllowedError');
  }
}

async function fileFor(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle | null> {
  const { folders, name } = splitPath(path);
  try {
    const dir = await folderFor(root, folders, false, new Map());
    return await dir.getFileHandle(name);
  } catch (e) {
    if (isDomError(e, 'NotFoundError') || isDomError(e, 'TypeMismatchError')) return null;
    throw e;
  }
}

/** The size and modification time of one file, or null when there is none. Reads no text. */
async function statPath(root: FileSystemDirectoryHandle, path: string): Promise<FileMeta | null> {
  const handle = await fileFor(root, path);
  if (!handle) return null;
  const f = await handle.getFile();
  return { size: f.size, modified: f.lastModified };
}

async function statDirectory(dir: FileSystemDirectoryHandle, prefix: string, out: Map<string, FileMeta>): Promise<void> {
  for await (const entry of dir.values()) {
    const path = `${prefix}/${entry.name}`;
    if (isDirectory(entry)) await statDirectory(entry, path, out);
    else if (isFile(entry) && isManagedPath(path)) {
      const f = await entry.getFile();
      out.set(path, { size: f.size, modified: f.lastModified });
    }
  }
}

/** Size and modification time of every managed file in the folder. */
async function statManagedFiles(root: FileSystemDirectoryHandle): Promise<Map<string, FileMeta>> {
  const out = new Map<string, FileMeta>();
  for await (const entry of root.values()) {
    if (isFile(entry) && entry.name === INDEX_FILE) {
      const f = await entry.getFile();
      out.set(INDEX_FILE, { size: f.size, modified: f.lastModified });
    } else if (isDirectory(entry) && (entry.name === 'Entities' || entry.name === 'Stories')) {
      await statDirectory(entry, entry.name, out);
    }
  }
  return out;
}

const sameMeta = (a: FileMeta | null | undefined, b: FileMeta | null | undefined): boolean => (a ?? null) === (b ?? null) || (!!a && !!b && a.size === b.size && a.modified === b.modified);

/** Which of these files have been changed, created or deleted in the folder since the session last saw them. */
async function changedOutside(s: Session, paths: readonly string[]): Promise<string[]> {
  if (!s.meta) return [];
  const out: string[] = [];
  for (const path of paths) if (!sameMeta(s.meta.get(path), await statPath(s.root, path))) out.push(path);
  return out;
}

/** Called when a write finds the folder changed behind the app's back; sync then looks at what changed (see startAutoSync). */
let onOutsideChange: (() => void) | null = null;

/**
 * Brings the folder from `baseline` (what is on disk) to `next`: writes only the files whose text
 * changed, and deletes managed files that `next` no longer has. Records each step in the session.
 */
async function writeFiles(s: Session, next: ReadonlyMap<string, string>, baseline: ReadonlyMap<string, string>): Promise<void> {
  // Until the writer has dealt with what changed in the folder, writing would overwrite it.
  if (state.changed?.length) return;
  setState({ status: 'syncing', error: undefined });
  try {
    await requireWritable(s.root);
    const cache = new Map<string, FileSystemDirectoryHandle>();
    const stale = [...baseline.keys()].filter((path) => !next.has(path) && isManagedPath(path));
    const rewritten = [...next].filter(([path, text]) => baseline.get(path) !== text).map(([path]) => path);
    // A file we are about to replace or delete must be the one we last saw. Anything else is somebody else's work.
    const clash = await changedOutside(s, [...stale, ...rewritten]);
    if (clash.length > 0) {
      setState({ status: 'changed', changed: clash, error: undefined });
      onOutsideChange?.();
      return;
    }
    for (const path of stale) {
      await removeFile(s.root, path);
      s.known.delete(path);
      s.meta?.delete(path);
    }
    for (const [path, text] of next) {
      if (baseline.get(path) === text) continue;
      await writeFile(s.root, path, text, cache);
      s.known.set(path, text);
      if (s.meta) {
        const seen = await statPath(s.root, path);
        if (seen) s.meta.set(path, seen);
      }
    }
    setState({ status: 'synced', lastSync: Date.now(), error: undefined });
  } catch (e) {
    if (isDomError(e, 'NotAllowedError')) setState({ status: 'needs-permission', error: undefined });
    else setState({ status: 'error', error: errorMessage(e) });
    throw e;
  }
}

function adopt(root: FileSystemDirectoryHandle, known: Map<string, string>, meta: Map<string, FileMeta> | null): void {
  stopWatching();
  session = { root, known, meta };
  setState({ status: 'syncing', folderName: root.name, lastSync: undefined, error: undefined });
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

/**
 * Asks the user for a folder and looks at what is in it. Writes nothing. The folder becomes the
 * current one and is remembered for the next visit. Any sync to the previous folder stops here.
 * Throws (AbortError) if the user cancels the picker, and an Error if the folder's vault is unreadable.
 */
export async function connectFolder(): Promise<FolderInfo> {
  const picker = window.showDirectoryPicker;
  if (typeof picker !== 'function') throw new Error('This browser cannot sync to a folder.');
  const root = await picker.call(window, { mode: 'readwrite', id: PICKER_ID });

  const { files, meta } = await scanManagedFiles(root);
  const hasVault = files.has(INDEX_FILE);
  // Throws for an unreadable vault, before anything is switched or remembered.
  const vault = hasVault ? filesToVault(files) : undefined;
  await saveHandle(root);
  adopt(root, files, meta);
  return vault ? { name: root.name, hasVault: true, vault } : { name: root.name, hasVault: false };
}

async function saveHandle(root: FileSystemDirectoryHandle): Promise<void> {
  await handleRows().put({ key: FOLDER_KEY, handle: root });
}

/**
 * Reloads the remembered folder, without asking for permission. A granted folder is ready to use;
 * otherwise the status becomes needs-permission until requestAccess() runs from a click.
 */
export async function restoreFolder(): Promise<{ name: string; permission: PermissionState } | null> {
  if (!isFolderSyncSupported()) return null;
  const row = await handleRows().get(FOLDER_KEY);
  if (!row) return null;
  const root = row.handle;
  const permission = await root.queryPermission({ mode: 'readwrite' });
  adopt(root, new Map(), null);
  setState({ status: permission === 'granted' ? 'off' : 'needs-permission' });
  return { name: root.name, permission };
}

/** Asks the user to allow writing to the connected folder again. Call it straight from a click handler. */
export async function requestAccess(): Promise<boolean> {
  const s = session;
  if (!s) return false;
  const permission = await s.root.requestPermission({ mode: 'readwrite' });
  if (permission === 'granted') return true;
  setState({ status: 'needs-permission' });
  return false;
}

/** Stops syncing and forgets the folder. The files in it are left as they are. */
export async function disconnectFolder(): Promise<void> {
  stopWatching();
  session = null;
  setState({ status: 'off', folderName: undefined, lastSync: undefined, error: undefined });
  await handleRows()
    .delete(FOLDER_KEY)
    .catch((e: unknown) => console.warn('Could not forget the sync folder', e));
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

/**
 * Writes the vault to the connected folder. Only files whose text changed since the last write
 * (or the scan on connect) are written; managed files the vault no longer produces are deleted.
 * `previousFiles` overrides what is assumed to be on disk; by default it is the session's record.
 */
export function writeVault(vault: Vault, previousFiles?: ReadonlyMap<string, string>): Promise<void> {
  const s = session;
  const next = vaultToFiles(vault);
  return enqueue(async () => {
    if (!s || s !== session) return; // disconnected, or another folder was chosen meanwhile
    await writeFiles(s, next, previousFiles ?? s.known);
  });
}

/**
 * Reads the vault from the connected folder, with the managed files it was read from and their
 * newest modification time (epoch ms, 0 when there are none). The files read become the record of
 * what is on disk.
 */
export function readFolderVault(): Promise<{ vault: Vault; files: ReadonlyMap<string, string>; modified: number }> {
  const s = session;
  return enqueue(async () => {
    if (!s || s !== session) throw new Error('No folder is connected.');
    try {
      const scan = await scanManagedFiles(s.root);
      s.known = scan.files;
      s.meta = scan.meta;
      return { vault: filesToVault(scan.files), files: scan.files, modified: scan.modified };
    } catch (e) {
      setState({ status: 'error', error: errorMessage(e) });
      throw e;
    }
  });
}

/** Reads the vault from the connected folder. The files read become the record of what is on disk. */
export async function readVault(): Promise<Vault> {
  return (await readFolderVault()).vault;
}

/**
 * Copies the given managed files into `.living-writing-backup/<time>/` before they are overwritten.
 * Returns that folder's path. Backup folders are never read or deleted by sync.
 */
export function backupFolderFiles(files: ReadonlyMap<string, string>): Promise<string> {
  const s = session;
  return enqueue(async () => {
    if (!s || s !== session) throw new Error('No folder is connected.');
    // Colons are not allowed in Windows file names, so the ISO time is made file-name safe.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `.living-writing-backup/${stamp}`;
    const cache = new Map<string, FileSystemDirectoryHandle>();
    for (const [path, text] of files) {
      if (isManagedPath(path)) await writeFile(s.root, `${base}/${path}`, text, cache);
    }
    return base;
  });
}

// ---------------------------------------------------------------------------
// Auto sync
// ---------------------------------------------------------------------------

let unsubscribeStore: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let pendingVault: (() => Vault) | null = null;
let flushListenersAdded = false;

function flushWhenHidden(): void {
  if (document.visibilityState === 'hidden') flushPendingWrite();
}

/**
 * Follows the vault: after a change, waits for a second of quiet and then writes. It also writes
 * once right away, so the folder catches up with the vault at the start. Call after the folder's
 * vault has been read or written, and the vault in the store matches it.
 */
export function startAutoSync(getVault: () => Vault, subscribe: (listener: () => void) => () => void, onOutside?: () => void): void {
  if (!session) throw new Error('Connect a folder before starting sync.');
  stopWatching();
  onOutsideChange = onOutside ?? null;
  startPolling();
  let seen = getVault();
  unsubscribeStore = subscribe(() => {
    const current = getVault();
    if (current === seen) return;
    seen = current;
    scheduleWrite(getVault);
  });
  if (!flushListenersAdded) {
    // Hiding the tab or closing the page writes the pending change now, not a second later.
    window.addEventListener('pagehide', flushPendingWrite);
    document.addEventListener('visibilitychange', flushWhenHidden);
    flushListenersAdded = true;
  }
  scheduleWrite(getVault);
}

function scheduleWrite(getVault: () => Vault): void {
  if (!session) return;
  pendingVault = getVault;
  if (timer !== null) clearTimeout(timer);
  if (!state.changed?.length) setState({ status: 'syncing' });
  timer = setTimeout(() => {
    timer = null;
    runPendingWrite();
  }, DEBOUNCE_MS);
}

function runPendingWrite(): void {
  const getVault = pendingVault;
  pendingVault = null;
  if (getVault) void writeVault(getVault()).catch((e: unknown) => console.error('Folder sync failed', e));
}

/** Writes at once instead of waiting for the debounce, e.g. when the page is closing. */
function flushPendingWrite(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
  runPendingWrite();
}

function stopWatching(): void {
  stopPolling();
  onOutsideChange = null;
  unsubscribeStore?.();
  unsubscribeStore = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pendingVault = null;
}

// ---------------------------------------------------------------------------
// Changes made outside the app
// ---------------------------------------------------------------------------

const POLL_MS = 8000;
let poller: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  stopPolling();
  poller = setInterval(() => {
    if (document.visibilityState === 'visible') void detectOutsideChanges().catch((e: unknown) => console.warn('Could not check the folder for changes', e));
  }, POLL_MS);
  document.addEventListener('visibilitychange', checkWhenVisible);
}

function stopPolling(): void {
  if (poller !== null) clearInterval(poller);
  poller = null;
  document.removeEventListener('visibilitychange', checkWhenVisible);
}

function checkWhenVisible(): void {
  if (document.visibilityState === 'visible') void detectOutsideChanges().catch((e: unknown) => console.warn('Could not check the folder for changes', e));
}

/**
 * Looks at the folder's files (size and time only) for anything that is not as sync last left it. If something is,
 * writing stops, the status becomes "changed", and the outside-change handler runs. Returns the paths found.
 */
export function detectOutsideChanges(): Promise<string[]> {
  const s = session;
  return enqueue(async () => {
    if (!s || s !== session || !s.meta || state.changed?.length) return state.changed ?? [];
    const now = await statManagedFiles(s.root);
    const paths = new Set([...s.meta.keys(), ...now.keys()]);
    const changed = [...paths].filter((p) => !sameMeta(s.meta!.get(p), now.get(p)));
    if (changed.length === 0) return [];
    setState({ status: 'changed', changed, error: undefined });
    onOutsideChange?.();
    return changed;
  });
}

/** The three versions of the files and what to do with each: see core/syncPlan.ts. */
export interface OutsideLook {
  ours: Map<string, string>;
  base: ReadonlyMap<string, string>;
  theirs: Map<string, string>;
  plan: Map<string, Decision>;
}

/** Reads the folder and plans, for each file, which side wins. Writes nothing and changes nothing. */
export function lookOutside(vault: Vault): Promise<OutsideLook> {
  const s = session;
  return enqueue(async () => {
    if (!s || s !== session) throw new Error('No folder is connected.');
    const scan = await scanManagedFiles(s.root);
    const ours = vaultToFiles(vault);
    return { ours, base: new Map(s.known), theirs: scan.files, plan: planSync(s.known, ours, scan.files) };
  });
}

/** The folder's files cannot be read as a vault; writing stays stopped until the writer says what to do. */
export function holdUnreadable(message: string): void {
  setState({ status: 'changed', changed: ['(the folder)'], conflicts: undefined, error: message });
}

/** Records files the writer must choose between, and keeps writing stopped until they have. */
export function holdConflicts(look: OutsideLook): Conflict[] {
  const conflicts = conflictsOf(look.plan).map((path) => ({ path, ours: look.ours.get(path) ?? null, theirs: look.theirs.get(path) ?? null }));
  setState({ status: 'changed', changed: conflicts.map((c) => c.path), conflicts, error: undefined });
  return conflicts;
}

const sameText = (a: string | undefined, b: string | undefined): boolean => a?.replace(/\r\n/g, '\n') === b?.replace(/\r\n/g, '\n');

/**
 * Makes the folder hold `files` (the settled result of a plan) and records that as what is on disk. Before anything
 * is replaced or deleted in the folder, the folder's copy goes to .living-writing-backup/<time>/folder/, and the vault's
 * copy of any file the folder's version replaced goes to .../app/. Returns the backup path, or null if nothing needed one.
 */
export function applyOutside(look: OutsideLook, files: ReadonlyMap<string, string>): Promise<string | null> {
  const s = session;
  return enqueue(async () => {
    if (!s || s !== session) throw new Error('No folder is connected.');
    try {
      await requireWritable(s.root);
      const cache = new Map<string, FileSystemDirectoryHandle>();
      const lostInFolder = [...look.theirs].filter(([path, text]) => !sameText(files.get(path), text));
      const lostInApp = [...look.ours].filter(([path, text]) => !sameText(files.get(path), text));
      let backup: string | null = null;
      if (lostInFolder.length > 0 || lostInApp.length > 0) {
        backup = `.living-writing-backup/${new Date().toISOString().replace(/[:.]/g, '-')}`;
        for (const [path, text] of lostInFolder) await writeFile(s.root, `${backup}/folder/${path}`, text, cache);
        for (const [path, text] of lostInApp) await writeFile(s.root, `${backup}/app/${path}`, text, cache);
      }
      for (const [path, text] of files) {
        if (!sameText(look.theirs.get(path), text)) await writeFile(s.root, path, text, cache);
      }
      for (const path of look.theirs.keys()) {
        if (!files.has(path) && isManagedPath(path)) await removeFile(s.root, path);
      }
      s.known = new Map(files);
      s.meta = await statManagedFiles(s.root);
      setState({ status: 'synced', lastSync: Date.now(), changed: undefined, conflicts: undefined, error: undefined });
      return backup;
    } catch (e) {
      if (isDomError(e, 'NotAllowedError')) setState({ status: 'needs-permission', error: undefined });
      else setState({ status: 'error', error: errorMessage(e) });
      throw e;
    }
  });
}

/**
 * The folder cannot be read as a vault (say, its index file was deleted). Takes the folder as it is as the baseline, so
 * the next write replaces it with this vault, after backing up what was there. Only for the writer's explicit choice.
 */
export function overwriteFolderWith(vault: Vault): Promise<string> {
  const s = session;
  return enqueue(async () => {
    if (!s || s !== session) throw new Error('No folder is connected.');
    const scan = await scanManagedFiles(s.root);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `.living-writing-backup/${stamp}/folder`;
    const cache = new Map<string, FileSystemDirectoryHandle>();
    for (const [path, text] of scan.files) await writeFile(s.root, `${base}/${path}`, text, cache);
    s.known = scan.files;
    s.meta = scan.meta;
    setState({ status: 'syncing', changed: undefined, conflicts: undefined, error: undefined });
    return base;
  }).then(async (base) => {
    await writeVault(vault);
    return base;
  });
}
