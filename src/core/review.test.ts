import { describe, expect, it } from 'vitest';
import { exportJSON, filesToVault, importJSON, vaultToFiles } from './exchange';
import { addReviewItems, openReviewItems, setReviewStatus } from './review';
import { VaultBuilder } from './testkit';
import { deleteScene } from './timeline';

const world = () => new VaultBuilder().scene('a').scene('b').chain('a', 'b').build();
const causes = (v: ReturnType<typeof world>) => openReviewItems(v).map((i) => `${i.sceneId}:${i.cause}`);

describe('the review list', () => {
  it('adding the same (scene, cause) twice keeps one open item, and a different cause or scene is a new one', () => {
    let v = addReviewItems(world(), [{ sceneId: 'a', cause: 'X' }]);
    v = addReviewItems(v, [{ sceneId: 'a', cause: 'X' }, { sceneId: 'a', cause: 'Y' }, { sceneId: 'b', cause: 'X' }]);
    expect(causes(v).sort()).toEqual(['a:X', 'a:Y', 'b:X']);
  });

  it('flags the same cause again once the writer has marked the first item done', () => {
    let v = addReviewItems(world(), [{ sceneId: 'a', cause: 'X' }]);
    v = setReviewStatus(v, Object.keys(v.reviewItems)[0], 'done');
    expect(causes(v)).toEqual([]);
    expect(causes(addReviewItems(v, [{ sceneId: 'a', cause: 'X' }]))).toEqual(['a:X']);
  });

  it('skips scenes that do not exist, and returns the same vault when nothing was added or changed', () => {
    const v = world();
    expect(addReviewItems(v, [{ sceneId: 'ghost', cause: 'X' }])).toBe(v);
    const flagged = addReviewItems(v, [{ sceneId: 'a', cause: 'X' }]);
    expect(setReviewStatus(flagged, Object.keys(flagged.reviewItems)[0], 'open')).toBe(flagged);
  });

  it('deleting a scene deletes its items, so nothing on the list points at a missing scene', () => {
    const v = deleteScene(addReviewItems(world(), [{ sceneId: 'a', cause: 'X' }, { sceneId: 'b', cause: 'X' }]), 'a');
    expect(causes(v)).toEqual(['b:X']);
  });

  it('survives export and import in both formats, with its status', () => {
    let v = addReviewItems(world(), [{ sceneId: 'a', cause: 'X' }, { sceneId: 'b', cause: 'Y' }]);
    v = setReviewStatus(v, Object.keys(v.reviewItems)[0], 'dismissed');
    expect(importJSON(exportJSON(v))).toStrictEqual(v);
    expect(filesToVault(vaultToFiles(v))).toStrictEqual(v);
  });
});
