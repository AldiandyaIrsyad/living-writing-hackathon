import { describe, expect, it } from 'vitest';
import { VaultBuilder } from '../../core/testkit';
import { chooseTarget, pinLabel } from './target';

const vault = () => {
  const v = new VaultBuilder().scene('a').scene('b').scene('c').build();
  v.chapters.c1 = { id: 'c1', storyId: 's', title: 'Chapter 2', order: 0 };
  v.scenes.a = { ...v.scenes.a, chapterId: 'c1', title: 'The Ford' };
  return v;
};

describe('chooseTarget', () => {
  it('a pin wins over the open scene and the playhead; then the open scene; then the playhead', () => {
    const v = vault();
    expect(chooseTarget(v, 'a', 'b', 'c')).toEqual({ sceneId: 'a', source: 'pinned' });
    expect(chooseTarget(v, null, 'b', 'c')).toEqual({ sceneId: 'b', source: 'writing' });
    expect(chooseTarget(v, null, null, 'c')).toEqual({ sceneId: 'c', source: 'playhead' });
    expect(chooseTarget(v, null, null, null)).toBeNull();
  });

  it('ignores a pin or open scene that no longer exists instead of showing nothing', () => {
    const v = vault();
    expect(chooseTarget(v, 'gone', 'b', 'c')).toEqual({ sceneId: 'b', source: 'writing' });
    expect(chooseTarget(v, null, 'gone', 'c')).toEqual({ sceneId: 'c', source: 'playhead' });
  });
});

describe('pinLabel', () => {
  it('names the chapter and the scene, or just the scene when it has no chapter', () => {
    const v = vault();
    expect(pinLabel(v, 'a')).toBe('Chapter 2 · The Ford');
    expect(pinLabel(v, 'b')).toBe('b');
    expect(pinLabel(v, 'gone')).toBe('');
  });
});
