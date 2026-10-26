// The control that sets a scene's status (idea, draft, revised, done), or clears it.

import { STATUSES, STATUS_LABELS, isStatus, setSceneStatus } from '../core/status';
import type { Scene } from '../core/types';
import { update } from '../store/store';

export function StatusSelect({ scene, className, testId }: { scene: Scene; className: string; testId: string }) {
  return (
    <select
      className={className}
      aria-label="Scene status"
      data-testid={testId}
      value={scene.status ?? ''}
      onChange={(e) => update((v) => setSceneStatus(v, scene.id, isStatus(e.target.value) ? e.target.value : undefined))}
    >
      <option value="">No status</option>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
