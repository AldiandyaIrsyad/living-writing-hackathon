// Story-level actions shared by the sidebar and the home page.

import { insertScene } from '../core/timeline';
import type { Id, Scene } from '../core/types';
import { addStory, chapterForNewScene } from '../store/actions';
import { getGraph, useStore } from '../store/store';

/** Creates "New story" (numbered when the name is taken) and opens its page. */
export function createStory(): void {
  const st = useStore.getState();
  const taken = new Set(Object.values(st.vault.stories).map((s) => s.name));
  let name = 'New story';
  for (let i = 2; taken.has(name); i++) name = `New story ${i}`;
  const r = addStory(st.vault, name);
  st.commit(r.vault);
  st.setCurrentStory(r.id);
  st.navigate({ kind: 'story', id: r.id });
}

/**
 * Appends a scene after the story's chronologically last scene (or floats it when there is none) and opens it. A scene
 * belongs in a chapter: with no chapter given it joins the last scene's (see chapterForNewScene).
 */
export function appendScene(storyId: Id, chapterId?: Id): void {
  const st = useStore.getState();
  let v = st.vault;
  const graph = getGraph(v);
  let last: Scene | null = null;
  let lastIndex = -Infinity;
  for (const s of Object.values(v.scenes)) {
    if (s.storyId !== storyId || s.someday) continue;
    const index = graph.topoIndex(s.momentId);
    if (index > lastIndex) {
      lastIndex = index;
      last = s;
    }
  }
  if (!chapterId) ({ vault: v, chapterId } = chapterForNewScene(v, storyId, last?.id ?? null));
  const r = insertScene(v, { storyId, title: 'New scene', chapterId }, last ? 'after' : null, last?.id ?? null);
  st.commit(r.vault);
  st.navigate({ kind: 'scene', id: r.sceneId });
}

/** Creates a Someday (unplaced) scene in the story's Someday tray (creating a first story if none exists yet) and opens it. */
export function appendSomedayScene(storyId?: Id | null): void {
  const st = useStore.getState();
  let v = st.vault;
  let targetStoryId = storyId ?? st.currentStoryId ?? Object.values(v.stories).sort((a, b) => a.order - b.order)[0]?.id ?? null;
  if (!targetStoryId) {
    const addedSt = addStory(v, 'New story');
    v = addedSt.vault;
    targetStoryId = addedSt.id;
    st.setCurrentStory(targetStoryId);
  }
  const r = insertScene(v, { storyId: targetStoryId, title: 'New scene', chapterId: null }, null, null);
  const sc = r.vault.scenes[r.sceneId];
  const next = { ...r.vault, scenes: { ...r.vault.scenes, [r.sceneId]: { ...sc, someday: true } } };
  st.commit(next);
  st.navigate({ kind: 'scene', id: r.sceneId });
}
