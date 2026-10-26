// Is the writer's work safe in this browser? The judgement is a pure function; `checkStorage` gathers its inputs.

import { getSyncState } from './fsSync';
import { BACKEND } from './server';
import { useStore } from './store';

export type StorageLevel = 'ok' | 'warn' | 'critical';

export interface StorageHealth {
  level: StorageLevel;
  /** One line for the Vault menu: whether the browser keeps the data, and how much room is used. */
  detail: string;
  /** Why, in words for the writer. Empty when everything is fine. */
  reason: string;
}

function megabytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** "Kept by the browser · 14 MB of 2.0 GB used": what is known, in the order a writer cares about. */
export function describeStorage(input: { persisted: boolean | null; usage?: number; quota?: number }): string {
  const parts = [input.persisted === true ? 'Kept by the browser' : input.persisted === false ? 'Not guaranteed by the browser' : 'Browser storage'];
  if (input.usage !== undefined && input.quota !== undefined && input.quota > 0) parts.push(`${megabytes(input.usage)} of ${megabytes(input.quota)} used`);
  return parts.join(' · ');
}

const WARN_AT = 0.8;
const CRITICAL_AT = 0.95;

/**
 * Browser storage is "best effort" unless the browser agreed to keep it; a connected, healthy folder is a second copy
 * that makes that matter much less. `persisted` is null when the browser cannot say.
 */
export function storageHealth(input: { persisted: boolean | null; usage?: number; quota?: number; folderOk: boolean }): StorageHealth {
  const { persisted, usage, quota, folderOk } = input;
  const detail = describeStorage({ persisted, usage, quota });
  const used = usage !== undefined && quota !== undefined && quota > 0 ? usage / quota : null;
  if (used !== null && used >= CRITICAL_AT) return { level: 'critical', detail, reason: 'Browser storage is almost full. Export a backup now, or free some space.' };
  if (used !== null && used >= WARN_AT) return { level: 'warn', detail, reason: 'Browser storage is getting full.' };
  if (persisted !== true && !folderOk) {
    return { level: 'warn', detail, reason: 'The browser may clear this site’s storage under pressure. Connect a folder or export a backup to be safe.' };
  }
  return { level: 'ok', detail, reason: '' };
}

/** Asks the browser to keep the vault, reads the quota and judges it. Browser APIs only; the judgement is storageHealth. */
export async function checkStorage(): Promise<StorageHealth> {
  if (BACKEND) return { level: 'ok', detail: 'Kept on the server', reason: '' };
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  let persisted: boolean | null = null;
  let usage: number | undefined;
  let quota: number | undefined;
  try {
    // Asking can raise a permission prompt in some browsers, so only once there is writing worth keeping.
    const hasWork = Object.keys(useStore.getState().vault.scenes).length > 0;
    if (storage?.persisted) persisted = (await storage.persisted()) || (hasWork && storage.persist ? await storage.persist() : false);
    const estimate = await storage?.estimate?.();
    usage = estimate?.usage;
    quota = estimate?.quota;
  } catch {
    // Storage hints are a convenience; an unreadable estimate just means no warning.
  }
  const sync = getSyncState().status;
  return storageHealth({ persisted, usage, quota, folderOk: sync === 'synced' || sync === 'syncing' });
}

/** At startup: ask for persistent storage, and say so only if the browser is nearly out of room. */
export async function watchStorage(): Promise<void> {
  const health = await checkStorage();
  if (health.level === 'critical') useStore.getState().toast('error', health.reason);
}

export type SafetyLevel = 'ok' | 'warn' | 'critical';

export interface Safety {
  level: SafetyLevel;
  /** The answer to "is my work safe right now?": the worst problem, or a plain yes. */
  headline: string;
  /** One line per place the work lives, in the order a writer thinks of them. */
  details: string[];
}

function clock(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleTimeString() : '';
}

/**
 * Combines the browser save, the folder sync and browser storage into one answer. The worst of them decides the level:
 * a failed save or sync, or storage nearly full, beats something that needs attention (permission, a changed folder,
 * a filling disk), which beats everything being fine. Pure.
 */
export function safetySummary(input: {
  save: 'saved' | 'saving' | 'error';
  savedAt: number | null;
  folder: { status: 'off' | 'needs-permission' | 'syncing' | 'synced' | 'error' | 'changed'; name?: string; lastSync?: number; error?: string };
  storage: StorageHealth | null;
  /** The vault lives on the Living Writing server rather than in this browser; folder sync does not apply. */
  server?: boolean;
}): Safety {
  const { save, savedAt, folder, storage, server } = input;
  const place = server ? 'the server' : 'this browser';
  const name = folder.name ?? 'the folder';
  const details: string[] = [];
  const critical: string[] = [];
  const warn: string[] = [];

  if (save === 'error') {
    details.push(`Saving to ${place} failed`);
    critical.push(`Saving to ${place} failed. Back up now.`);
  } else if (save === 'saving') details.push(`Saving to ${place}…`);
  else details.push(`Saved to ${place}${savedAt ? ` ${clock(savedAt)}` : ''}`);

  switch (server ? 'off' : folder.status) {
    case 'off':
      if (!server) details.push('No folder connected');
      break;
    case 'synced':
      details.push(`Synced to ${name}${folder.lastSync ? ` ${clock(folder.lastSync)}` : ''}`);
      break;
    case 'syncing':
      details.push(`Syncing to ${name}…`);
      break;
    case 'needs-permission':
      details.push(`${name} needs your permission to keep syncing`);
      warn.push(`${name} needs your permission to keep syncing. Click Reconnect.`);
      break;
    case 'changed':
      details.push(`Files in ${name} changed outside the app and are waiting for you`);
      warn.push(`Files in ${name} changed outside the app. Nothing is saved to the folder until you choose.`);
      break;
    case 'error':
      details.push(`Syncing to ${name} failed${folder.error ? `: ${folder.error}` : ''}`);
      critical.push(`Syncing to ${name} failed.`);
      break;
  }

  if (storage) {
    details.push(storage.detail);
    if (storage.level === 'critical') critical.push(storage.reason);
    else if (storage.level === 'warn') warn.push(storage.reason);
  }

  if (critical.length > 0) return { level: 'critical', headline: critical[0], details };
  if (warn.length > 0) return { level: 'warn', headline: warn[0], details };
  const where = server ? 'on the server' : folder.status === 'synced' || folder.status === 'syncing' ? 'in this browser and in the folder' : 'in this browser';
  return { level: 'ok', headline: `Your work is safe ${where}.`, details };
}
