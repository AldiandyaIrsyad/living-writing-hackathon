// Affiliations on the entity page: the groups an entity belongs to (chips, join / leave) and the
// members of a group. Membership is pure data in the vault; see core/affiliations.ts.

import { useState } from 'react';
import { affiliationsAt, groupCandidates, joinGroup, leaveGroup, membersAt, type AffiliationWhere } from '../../core/affiliations';
import type { Entity, Id, Scene, TimePoint, Vault } from '../../core/types';
import { getResolver, update, useStore, useVault } from '../../store/store';
import './affiliations.css';

/** Commits a vault edit; says so when it changed nothing (e.g. already a member at that point). */
export function commitAffiliation(fn: (v: Vault) => Vault): void {
  const before = useStore.getState().vault;
  update(fn);
  if (useStore.getState().vault === before) useStore.getState().toast('info', 'Nothing to change: already the same at that point.');
}

function chapterOrStory(vault: Vault, scene: Scene): string {
  return (scene.chapterId && vault.chapters[scene.chapterId]?.title) || vault.stories[scene.storyId]?.name || '';
}

function groupColor(vault: Vault, entity: Entity): string | undefined {
  return vault.entityTypes[entity.typeId]?.color;
}

interface ChipProps {
  vault: Vault;
  groupId: Id;
  onOpen: () => void;
  onLeave?: () => void;
  isLeaving?: boolean;
}

function Chip({ vault, groupId, onOpen, onLeave, isLeaving }: ChipProps) {
  const group = vault.entities[groupId];
  return (
    <span className={`aff-chip-wrap ${isLeaving ? 'is-leaving' : ''}`}>
      <button
        type="button"
        className="aff-chip"
        data-testid="affiliation-chip"
        data-group={group.name}
        title={`Open ${group.name}`}
        onClick={onOpen}
      >
        <span className="aff-dot" style={{ background: groupColor(vault, group) }} aria-hidden />
        {group.name}
      </button>
      {onLeave && (
        <button type="button" className="aff-x" aria-label={`Leave ${group.name}`} title="Leave…" onClick={onLeave}>
          ×
        </button>
      )}
    </span>
  );
}

/** Compact read-only chips of the groups an entity belongs to at a point in time. */
export function AffiliationChips({ entityId, tp, compact = false }: { entityId: Id; tp: TimePoint; compact?: boolean }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const ids = affiliationsAt(getResolver(vault), entityId, tp);
  if (!ids.length) return compact ? null : <div className="aff-empty faint small">No affiliations</div>;
  return (
    <div className="aff-chips">
      {ids.map((groupId) => (
        <Chip key={groupId} vault={vault} groupId={groupId} onOpen={() => navigate({ kind: 'entity', id: groupId, at: tp })} />
      ))}
    </div>
  );
}

/** Choose when a join or leave takes effect: from the start (base properties) or after a scene. */
export function WhenSelect({ scenes, value, onChange, testId }: { scenes: Scene[]; value: string; onChange: (v: string) => void; testId: string }) {
  const vault = useVault();
  return (
    <select className="select small aff-when" aria-label="When" data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="base">From the start (base)</option>
      {scenes.map((s) => (
        <option key={s.id} value={s.id}>
          After “{s.title}” · {chapterOrStory(vault, s)}
        </option>
      ))}
    </select>
  );
}

export function whereOf(when: string, message?: string): AffiliationWhere {
  // A scene only picks the moment: the join or leave sits on the timeline there, so moving that scene leaves it be.
  return when === 'base' ? 'base' : { at: getResolver(useStore.getState().vault).clipEnd(when), message };
}

/** Entity page panel: current groups with leave, plus a join form. */
export function AffiliationsPanel({ entity, tp, sceneOptions }: { entity: Entity; tp: TimePoint; sceneOptions: Scene[] }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const current = affiliationsAt(getResolver(vault), entity.id, tp);

  const [groupId, setGroupId] = useState<Id>('');
  const [when, setWhen] = useState('base');
  const [message, setMessage] = useState('');
  const [leaving, setLeaving] = useState<Id | null>(null);
  const [leaveWhen, setLeaveWhen] = useState('base');

  const candidates = groupCandidates(vault).filter((e) => e.id !== entity.id && !current.includes(e.id));
  const groups = candidates.filter((e) => vault.entityTypes[e.typeId]?.group);
  const others = candidates.filter((e) => !vault.entityTypes[e.typeId]?.group);

  const join = () => {
    if (!groupId) return;
    commitAffiliation((v) => joinGroup(v, entity.id, groupId, whereOf(when, message.trim())));
    setGroupId('');
    setMessage('');
  };

  const leave = () => {
    if (!leaving) return;
    commitAffiliation((v) => leaveGroup(v, entity.id, leaving, whereOf(leaveWhen)));
    setLeaving(null);
  };

  return (
    <section className="panel" data-testid="affiliations-panel">
      <div className="panel-head">
        Affiliations <span className="grow" />
        <span className="faint small">{current.length || ''}</span>
      </div>
      <div className="panel-body stack">
        {current.length ? (
          <div className="aff-chips">
            {current.map((id) => (
              <Chip
                key={id}
                vault={vault}
                groupId={id}
                isLeaving={leaving === id}
                onOpen={() => navigate({ kind: 'entity', id, at: tp })}
                onLeave={() => {
                  setLeaving(leaving === id ? null : id);
                  setLeaveWhen('base');
                }}
              />
            ))}
          </div>
        ) : (
          <div className="aff-empty faint small">Not part of any group at this point.</div>
        )}

        {leaving && (
          <div className="aff-confirm small" data-testid="leave-row">
            <span>
              Leave <b>{vault.entities[leaving]?.name}</b>
            </span>
            <WhenSelect scenes={sceneOptions} value={leaveWhen} onChange={setLeaveWhen} testId="leave-when" />
            <span className="grow" />
            <button type="button" className="btn btn-sm btn-danger" data-testid="leave-submit" onClick={leave}>
              Leave
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLeaving(null)}>
              Cancel
            </button>
          </div>
        )}

        <div className="aff-join stack">
          <div className="row">
            <select
              className="select small grow"
              aria-label="Group to join"
              data-testid="join-group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Join…</option>
              {groups.length > 0 && (
                <optgroup label="Groups">
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="Other entities">
                  {others.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div className="row">
            <WhenSelect scenes={sceneOptions} value={when} onChange={setWhen} testId="join-when" />
          </div>
          <div className="row">
            <input
              className="input grow"
              aria-label="Commit message"
              data-testid="join-message"
              placeholder={when === 'base' ? 'Message applies to scenes only' : 'Commit message (optional)'}
              value={message}
              disabled={when === 'base'}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
            <button type="button" className="btn btn-sm" data-testid="join-submit" disabled={!groupId} onClick={join}>
              Join
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Group page panel: who is affiliated with this entity at the selected time. Hidden for ordinary entities without members. */
export function MembersPanel({ group, tp }: { group: Entity; tp: TimePoint }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const members = membersAt(getResolver(vault), group.id, tp).map((id) => vault.entities[id]);
  const isGroupType = vault.entityTypes[group.typeId]?.group === true;
  if (!isGroupType && !members.length) return null;
  return (
    <section className="panel" data-testid="members-panel">
      <div className="panel-head">
        Members <span className="grow" />
        <span className="faint small" data-testid="members-count">
          {members.length}
        </span>
      </div>
      <div className="panel-body">
        {members.length === 0 ? (
          <div className="aff-empty faint small">No one belongs to {group.name} at this point.</div>
        ) : (
          <ul className="aff-members">
            {members.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="aff-member"
                  data-testid="group-member"
                  onClick={() => navigate({ kind: 'entity', id: m.id, at: tp })}
                >
                  <span className="aff-dot" style={{ background: groupColor(vault, m) }} aria-hidden />
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
