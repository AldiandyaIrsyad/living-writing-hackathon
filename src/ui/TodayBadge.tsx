// Net words written today, and progress toward an optional daily goal. Shown in the top bar once there is something to show.

import { formatCount } from '../core/wordcount';
import { getDailyGoal, setDailyGoal, useTodaysWriting } from '../store/stats';

/** Asks for a daily goal; empty or 0 clears it. */
export function askDailyGoal(): void {
  const current = getDailyGoal();
  const answer = window.prompt('Daily word goal (leave empty for none):', current === null ? '' : String(current));
  if (answer === null) return;
  const n = Number(answer.trim());
  setDailyGoal(answer.trim() === '' || !Number.isFinite(n) ? null : n);
}

export function TodayBadge() {
  const { today, goal } = useTodaysWriting();
  if (today === 0 && goal === null) return null;
  const met = goal !== null && today >= goal;
  return (
    <button className={`btn btn-sm ${met ? 'active' : ''}`} onClick={askDailyGoal} title="Net words written today. Click to set a daily goal." data-testid="today-badge">
      Today +{formatCount(today)}
      {goal !== null && ` / ${formatCount(goal)}${met ? ' ✓' : ''}`}
    </button>
  );
}
