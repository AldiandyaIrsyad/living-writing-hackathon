// An entity's life as a document: the scenes it is in, in story order, and what changed at each. Composes what the
// entity page already holds (commits, revisions, appearances) into one readable arc.

import { formatValue, type Resolver } from '../core/resolve';
import type { Id, Vault } from '../core/types';
import { sceneCast } from './cast';

export interface PropChange {
  name: string;
  /** "—" when the property was not set. */
  before: string;
  after: string;
}

export interface LifeStep {
  sceneId: Id;
  sceneTitle: string;
  chapterTitle: string | null;
  props: PropChange[];
  /** The entity came into existence or stopped existing in this scene. */
  existence?: 'begins' | 'ends';
  renamedTo?: string;
  pageRevised: boolean;
  /** True when nothing changed here: the entity is only in the scene. */
  quiet: boolean;
}

/** Every scene the entity is in (mentioned, added to the cast, or changed there), in story order, with what changed. */
export function entityLife(vault: Vault, resolver: Resolver, entityId: Id): LifeStep[] {
  if (!vault.entities[entityId]) return [];
  const g = resolver.graph;
  const scenes = Object.values(vault.scenes)
    .filter((s) => sceneCast(vault, s).some((m) => m.entityId === entityId))
    .sort((a, b) => g.topoIndex(a.momentId) - g.topoIndex(b.momentId) || a.order - b.order);

  return scenes.map((scene) => {
    const before = resolver.entityAt(entityId, resolver.atScene(scene.id, false));
    const after = resolver.entityAt(entityId, resolver.atScene(scene.id, true));
    const props: PropChange[] = [];
    for (const name of new Set([...Object.keys(before.props), ...Object.keys(after.props)])) {
      const was = formatValue(before.props[name]?.value);
      const now = formatValue(after.props[name]?.value);
      if (was !== now) props.push({ name, before: was, after: now });
    }
    const step: LifeStep = {
      sceneId: scene.id,
      sceneTitle: scene.title,
      chapterTitle: scene.chapterId ? (vault.chapters[scene.chapterId]?.title ?? null) : null,
      props,
      pageRevised: before.note !== after.note,
      quiet: false,
    };
    if (!before.exists && after.exists) step.existence = 'begins';
    else if (before.exists && !after.exists) step.existence = 'ends';
    if (before.name !== after.name) step.renamedTo = after.name;
    step.quiet = props.length === 0 && step.existence === undefined && step.renamedTo === undefined && !step.pageRevised;
    return step;
  });
}
