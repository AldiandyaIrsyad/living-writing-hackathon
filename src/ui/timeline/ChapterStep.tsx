// Previous / next chapter, on the timeline and its collapsed strip: the chapter of the open scene (or under the playhead).

import { chapterScenes } from '../../core/chapterDoc';
import { chaptersOfStory } from '../../store/actions';
import { flushEditors, useStore, useVault } from '../../store/store';
import { playheadContext } from '../follow';

export function ChapterStep() {
  const vault = useVault();
  const view = useStore((s) => s.view);
  const playhead = useStore((s) => s.playhead);
  const open = view.kind === 'scene' ? vault.scenes[view.id] : undefined;
  const scene = open ?? playheadContext(vault, playhead)?.scene;
  const chapterId = scene?.chapterId;
  const chapter = chapterId ? vault.chapters[chapterId] : undefined;
  const chapters = chapter ? chaptersOfStory(vault, chapter.storyId).filter((c) => chapterScenes(vault, c.id).length > 0) : [];
  const idx = chapter ? chapters.findIndex((c) => c.id === chapter.id) : -1;
  const prev = idx > 0 ? chapters[idx - 1] : undefined;
  const next = idx >= 0 ? chapters[idx + 1] : undefined;

  const go = (target: { id: string } | undefined) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!target) return;
    flushEditors();
    const st = useStore.getState();
    st.navigate({ kind: 'scene', id: chapterScenes(st.vault, target.id)[0].id });
  };

  return (
    <div className="tl-group tl-seg" role="group" aria-label="Chapters">
      <button className="tl-btn" onClick={go(prev)} disabled={!prev} title={prev ? `Previous chapter: ${prev.title || 'Untitled chapter'}` : 'This is the first chapter'} data-testid="tl-chapter-prev">
        ← Chapter
      </button>
      <button className="tl-btn" onClick={go(next)} disabled={!next} title={next ? `Next chapter: ${next.title || 'Untitled chapter'}` : 'This is the last chapter'} data-testid="tl-chapter-next">
        Chapter →
      </button>
    </div>
  );
}
