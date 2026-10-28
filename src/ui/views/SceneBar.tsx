// The open scene's details, in the middle where the writer is: a line of what happens, when it happens, its status,
// and what it changes about the story. They used to live in the quick panel, away from the text.

import { useState } from 'react';
import { momentConcrete } from '../../core/concrete';
import { deleteScene } from '../../core/timeline';
import type { Id, Scene, Vault } from '../../core/types';
import { chaptersOfStory, setSceneChapter, updateSceneSynopsis } from '../../store/actions';
import { update, useStore, useVault } from '../../store/store';
import { sceneAddresses } from '../goto';
import { StatusSelect } from '../StatusSelect';
import { ChangesPanel, PlacementPanel } from './SceneView';

type DrawerKey = 'when' | 'changes' | 'more';
const DRAWERS_KEY = 'lw.scenebar.drawers';

function loadDrawer(): DrawerKey | null {
  try {
    const raw = window.localStorage.getItem(DRAWERS_KEY);
    return raw === 'when' || raw === 'changes' ? raw : null;
  } catch {
    return null;
  }
}

function saveDrawer(key: DrawerKey | null): void {
  try {
    if (key === null || key === 'more') window.localStorage.removeItem(DRAWERS_KEY);
    else window.localStorage.setItem(DRAWERS_KEY, key);
  } catch {
    // Remembering which drawer was open is a convenience only.
  }
}

/** Titles of the scenes at a moment, or the moment's concrete date / label when none has a scene. */
function titlesAt(vault: Vault, momentId: Id, except?: Id): string {
  const titles = Object.values(vault.scenes)
    .filter((s) => s.momentId === momentId && s.id !== except)
    .map((s) => s.title);
  return titles.join(', ') || momentConcrete(vault.moments[momentId]) || 'an unnamed moment';
}

/** Where a scene sits in time, in a few words: its date if it has one, then "after The Betrayal", "same time as…", or "not placed yet". */
export function placementPhrase(vault: Vault, scene: Scene): string {
  const m = scene.momentId;
  const concrete = momentConcrete(vault.moments[m]);
  const incoming = Object.values(vault.constraints).find((c) => c.after === m);
  let rel = 'not placed yet';
  if (incoming) rel = `after ${titlesAt(vault, incoming.before)}`;
  else {
    const outgoing = Object.values(vault.constraints).find((c) => c.before === m);
    if (outgoing) rel = `before ${titlesAt(vault, outgoing.after)}`;
    else if (Object.values(vault.scenes).some((s) => s.momentId === m && s.id !== scene.id)) {
      rel = `same time as ${titlesAt(vault, m, scene.id)}`;
    }
  }
  return concrete ? (rel === 'not placed yet' ? concrete : `${concrete} · ${rel}`) : rel;
}

/** `withMore` adds the chapter and delete drawer, for a scene opened inside its chapter. */
export function SceneBar({ scene, withMore }: { scene: Scene; withMore: boolean }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const [open, setOpen] = useState<DrawerKey | null>(loadDrawer);
  const toggle = (key: DrawerKey) => {
    const next = open === key ? null : key;
    setOpen(next);
    saveDrawer(next);
  };
  const changes = Object.values(vault.changes).filter((c) => c.sceneId === scene.id).length;
  const address = sceneAddresses(vault, scene.storyId).get(scene.id);

  return (
    <div className="scene-bar" data-testid="scene-bar">
      <div className="scene-bar-row">
        <span className="scene-bar-name" title="The scene you are writing in">
          {address && <span className="scene-bar-addr">{address}</span>} {scene.title || 'Untitled scene'}
        </span>
        <Chip testId="scene-chip-when" open={open === 'when'} onClick={() => toggle('when')} title="When this scene happens, relative to the others">
          When: {placementPhrase(vault, scene)}
        </Chip>
        <Chip testId="scene-chip-changes" open={open === 'changes'} onClick={() => toggle('changes')} title="What this scene changes about people and places (a death, a move, a new owner…)">
          Changes ({changes})
        </Chip>
        <StatusSelect scene={scene} className="select small" testId="scene-status" />
        {withMore && (
          <Chip testId="scene-chip-more" open={open === 'more'} onClick={() => toggle('more')} title="Move to another chapter, or delete this scene">
            ⋯
          </Chip>
        )}
      </div>
      <input
        className="input small scene-bar-synopsis"
        placeholder="What happens in this scene (optional, one line)"
        aria-label="Scene synopsis"
        data-testid="scene-synopsis"
        defaultValue={scene.synopsis ?? ''}
        key={`${scene.id}:${scene.synopsis ?? ''}`}
        onBlur={(e) => e.target.value.trim() !== (scene.synopsis ?? '') && update((v) => updateSceneSynopsis(v, scene.id, e.target.value))}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      {open === 'when' && (
        <div className="scene-bar-drawer" data-testid="scene-drawer-when">
          <PlacementPanel scene={scene} />
        </div>
      )}
      {open === 'changes' && (
        <div className="scene-bar-drawer" data-testid="scene-drawer-changes">
          <ChangesPanel scene={scene} />
        </div>
      )}
      {open === 'more' && (
        <div className="scene-bar-drawer scene-bar-more" data-testid="scene-drawer-more">
          <select
            className="select small"
            aria-label="Chapter"
            value={scene.chapterId ?? ''}
            onChange={(e) => update((v) => setSceneChapter(v, scene.id, e.target.value || null))}
          >
            <option value="">No chapter</option>
            {chaptersOfStory(vault, scene.storyId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || 'Untitled chapter'}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-danger"
            data-testid="scene-delete"
            title="Delete this scene and what it changes. To fold it into the scene above instead, delete its # heading."
            onClick={() => {
              if (!window.confirm(`Delete scene “${scene.title}”?`)) return;
              update((v) => deleteScene(v, scene.id));
              navigate({ kind: 'home' });
            }}
          >
            Delete scene
          </button>
        </div>
      )}
    </div>
  );
}

function Chip({ testId, open, onClick, title, children }: { testId: string; open: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" className={`scene-chip${open ? ' on' : ''}`} aria-expanded={open} data-testid={testId} title={title} onClick={onClick}>
      {children}
    </button>
  );
}
