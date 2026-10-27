import { describe, expect, it } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import { useStore } from '../store/store';
import { openNextScene } from './stories';

/** Two chapters: a b in the first, c in the second, told in that order. */
function twoChapters() {
  const v = new VaultBuilder().scene('a').scene('b').scene('c').chain('a', 'b', 'c').build();
  v.chapters.one = { id: 'one', storyId: 's', title: 'One', order: 0 };
  v.chapters.two = { id: 'two', storyId: 's', title: 'Two', order: 1 };
  v.scenes.a.chapterId = v.scenes.b.chapterId = 'one';
  v.scenes.c.chapterId = 'two';
  useStore.setState({ vault: v });
}

const opened = () => {
  const { view } = useStore.getState();
  return view.kind === 'scene' ? view.id : null;
};

describe('Next', () => {
  it('goes to the following scene, into the next chapter when this one ends its chapter', () => {
    twoChapters();
    openNextScene('a');
    expect(opened()).toBe('b');
    openNextScene('b');
    expect(opened()).toBe('c');
  });

  it('starts a new scene in the same chapter after the story’s last one', () => {
    twoChapters();
    openNextScene('c');
    const made = useStore.getState().vault.scenes[opened()!];
    expect(Object.keys(useStore.getState().vault.scenes)).toHaveLength(4);
    expect(made.chapterId).toBe('two');
  });
});
