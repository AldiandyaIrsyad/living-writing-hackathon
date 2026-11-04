// The story's flow, read for the writer: where a scene sits in the whole story (arc, chapter, how far through), what it
// does there (setup, turn, aftermath...), how it feels against the scenes told before it, and where a character's mood
// on the page does not fit the state the wiki has them in. It only reads: it never suggests prose or plot.
//
// One model call with the scene and the story's outline; no tools, as the states it needs are given. The reading is
// kept in this browser, per scene, and is out of date once the scene's text changes.

import { create } from 'zustand';
import { buildGraph } from '../core/graph';
import { findEntity, parseLinks } from '../core/links';
import { formatValue, Resolver } from '../core/resolve';
import type { Id, Scene, Vault } from '../core/types';
import { useStore, flushEditors } from '../store/store';
import { entitiesNamedIn, sceneText, sceneWithNotes } from './context';
import { useAgent } from './run';

export const ROLES = ['setup', 'complication', 'escalation', 'turn', 'climax', 'aftermath', 'breather', 'bridge', 'flashback', 'unclear'] as const;
export type Role = (typeof ROLES)[number];

export interface MoodCheck {
  entity: string;
  /** The state the wiki has them in as the scene begins, as the model was shown it. */
  state: string;
  /** Copied from the scene. */
  sceneQuote: string;
  note: string;
}

export interface FlowReading {
  position: string;
  role: Role;
  why: string;
  tone: string;
  /** How the tone compares to the scenes told just before; empty when there are none. */
  shift: string;
  moodChecks: MoodCheck[];
  /** The outline was too thin to place the scene with any confidence. */
  thin: boolean;
  model: string;
  /** A fingerprint of the prose that was read: a scene that no longer matches it has been written since. */
  prose: string;
}

export const FLOW_SYSTEM = `You read a story's structure for its writer, inside a writing tool. The writer writes the story; you only say where a scene sits in it and how it feels, so they can see the shape of what they have written. You never write or suggest prose, plot, or what should happen next.

You are given the story's outline in reading order (arcs, chapters, and every scene with its status and the writer's synopsis, or its opening words when it has none), the endings of the scenes told just before this one, the state each character is in as this scene begins, and the scene itself.

Answer with ONE JSON object and nothing else:
{"position": "...", "role": "...", "why": "...", "tone": "...", "shift": "...", "moodChecks": [{"entity": "...", "state": "...", "sceneQuote": "...", "note": "..."}]}

Rules:
- position: one short line placing the scene in the whole story: its arc and chapter, and how far through them it falls ("early in Arc I, opening its second chapter", "the last scene of Arc II"). Judge against the whole outline, scenes planned after it included (status idea, or only a synopsis).
- role: what the scene does for the story where it stands. One of: setup (introduces people, places, a situation or a question), complication (something gets in the way), escalation (stakes or pressure rise), turn (a reversal or revelation that changes the story's direction), climax (the confrontation that resolves the central conflict of its arc or of the story), aftermath (living with what just happened), breather (a quiet pause before or after something big), bridge (moves people, time or the telling between threads), flashback (told out of order to show the past), unclear. Use climax only for the scene that resolves its arc's central conflict: most scenes are not climaxes, and a tense or violent scene is not one by that alone. Otherwise pick the role that fits best from the outline and the scene. Answer unclear only when you are told the outline is thin and the scene itself does not make its role plain; then say so in position.
- why: one or two sentences naming the scenes around it, by title, that make it that role.
- tone: three to six words for how the scene feels (tender, uneasy, wry, dread-filled...).
- shift: one short sentence on how its tone compares to the scenes told just before it ("lighter than the two scenes before it"). Empty when no scene comes before it.
- moodChecks: a character whose state as the scene begins does not fit how the scene shows them, when the scene gives no reason: someone grieving since the last scene who jokes freely, someone badly wounded who moves easily. "state" is copied from what you were shown, "sceneQuote" verbatim from the scene, "note" says the mismatch in one sentence. A change the scene itself narrates (she laughs for the first time since the funeral) is not a mismatch. When in doubt, report nothing.
- [Writer's note: ...] in the scene text is the writer's comment, not story text; what it says about the story outranks the scene.
- Write in the language of the scene. Invent nothing.`;

const SYNOPSIS_LIMIT = 160;
const ENDING_LIMIT = 600;
/** How many scenes told just before this one the model is shown the endings of, for the tone shift. */
const ENDINGS = 2;

const byOrder = <T extends { order: number }>(a: T, b: T): number => a.order - b.order;
const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The story's scenes in reading (telling) order. */
function storyScenes(vault: Vault, storyId: Id): Scene[] {
  return Object.values(vault.scenes)
    .filter((s) => s.storyId === storyId)
    .sort(byOrder);
}

/** Too little written or planned to place a scene in its story: fewer than three scenes with text or a synopsis. */
export function thinOutline(vault: Vault, storyId: Id): boolean {
  return storyScenes(vault, storyId).filter((s) => s.prose.trim() || s.synopsis?.trim()).length < 3;
}

/**
 * Scenes told out of order: each one that happens, in story time, before a scene told ahead of it. A scene not yet on
 * the timeline (Someday) has no time and is never one.
 */
function flashbacks(vault: Vault, scenes: Scene[]): Set<Id> {
  const graph = buildGraph(vault);
  const out = new Set<Id>();
  let latest = -1;
  for (const s of scenes) {
    if (s.someday) continue;
    const at = graph.topoIndex(s.momentId);
    if (at < latest) out.add(s.id);
    latest = Math.max(latest, at);
  }
  return out;
}

/** The story's outline, arcs and chapters around their scenes in reading order, with this scene marked. */
export function outline(vault: Vault, sceneId: Id): string {
  const scene = vault.scenes[sceneId];
  const scenes = storyScenes(vault, scene.storyId);
  const chapters = Object.values(vault.chapters)
    .filter((c) => c.storyId === scene.storyId)
    .sort(byOrder);
  const arcs = Object.values(vault.arcs)
    .filter((a) => a.storyId === scene.storyId)
    .sort(byOrder);
  const back = flashbacks(vault, scenes);

  const sceneLine = (s: Scene, address: string) => {
    const bits = [`${address} "${s.title || 'Untitled scene'}"`, s.status ? `[${s.status}]` : '', s.prose.trim() ? '' : '(not written yet)'];
    // Without a synopsis, the scene's opening words say what it is about, so a story nobody summarised still has a shape.
    if (s.synopsis?.trim()) bits.push(`: ${cut(oneLine(s.synopsis), SYNOPSIS_LIMIT)}`);
    else if (s.id !== sceneId && s.prose.trim()) bits.push(`opens: "${cut(oneLine(sceneText(s.prose)), SYNOPSIS_LIMIT)}"`);
    if (s.labels?.length) bits.push(`· marked: ${s.labels.join(', ')}`);
    if (back.has(s.id)) bits.push('· told out of order: happens before scenes told earlier');
    if (s.someday) bits.push('· not placed on the timeline');
    if (s.id === sceneId) bits.push('  <-- THIS SCENE');
    return `    ${bits.filter(Boolean).join(' ')}`;
  };

  const lines: string[] = [];
  let arcShown: Id | undefined;
  chapters.forEach((ch, i) => {
    if (ch.arcId && ch.arcId !== arcShown && vault.arcs[ch.arcId]) {
      arcShown = ch.arcId;
      lines.push(`Arc ${arcs.findIndex((a) => a.id === ch.arcId) + 1} of ${arcs.length}: ${vault.arcs[ch.arcId].title}`);
    } else if (!ch.arcId && arcShown) {
      arcShown = undefined;
      lines.push('(chapters in no arc)');
    }
    const own = scenes.filter((s) => s.chapterId === ch.id);
    lines.push(`  Chapter ${i + 1} of ${chapters.length}: ${ch.title || 'Untitled'}${ch.labels?.length ? ` · marked: ${ch.labels.join(', ')}` : ''}${own.length ? '' : ' (no scenes yet)'}`);
    own.forEach((s, j) => lines.push(sceneLine(s, `${i + 1}.${String(j + 1).padStart(2, '0')}`)));
  });
  const loose = scenes.filter((s) => !s.chapterId || !vault.chapters[s.chapterId]);
  if (loose.length) {
    lines.push(chapters.length ? '  Scenes in no chapter:' : '  Scenes (the story has no chapters):');
    loose.forEach((s) => lines.push(sceneLine(s, `s${scenes.indexOf(s) + 1}`)));
  }
  const n = scenes.indexOf(scene) + 1;
  return [`Story: ${vault.stories[scene.storyId]?.name ?? ''} · this scene is ${n} of ${scenes.length} in reading order`, ...lines].join('\n');
}

/** The user message: the outline, the endings of the scenes told just before, the cast's states, and the scene. */
export function flowContext(vault: Vault, sceneId: Id): string {
  const scene = vault.scenes[sceneId];
  const scenes = storyScenes(vault, scene.storyId);
  const before = scenes
    .slice(0, scenes.indexOf(scene))
    .filter((s) => s.prose.trim())
    .slice(-ENDINGS);
  const endings = before.map((s) => {
    const text = sceneText(s.prose);
    return `"${s.title || 'Untitled scene'}" ends:\n"""\n${text.length > ENDING_LIMIT ? `…${text.slice(-ENDING_LIMIT)}` : text}\n"""`;
  });

  const ids = new Set(entitiesNamedIn(vault, scene.prose));
  for (const l of parseLinks(scene.prose)) {
    const e = findEntity(vault, l.target);
    if (e) ids.add(e.id);
  }
  const r = new Resolver(vault);
  const states = [...ids].flatMap((id) => {
    const at = r.entityBefore(id, { sceneId });
    const state = at.props.state && formatValue(at.props.state.value);
    return state ? [`- ${at.name}: ${state}`] : [];
  });
  const chapter = scene.chapterId ? vault.chapters[scene.chapterId] : undefined;

  return [
    `Outline:\n${outline(vault, sceneId)}`,
    thinOutline(vault, scene.storyId) ? 'The outline is thin: little of the story is written or planned yet.' : '',
    chapter?.note ? `Chapter notes from the writer (they hold for every scene in "${chapter.title}"):\n${chapter.note}` : '',
    endings.length ? `Scenes told just before this one:\n${endings.join('\n\n')}` : 'No scene is told before this one.',
    `Characters' states as this scene begins:\n${states.join('\n') || '(none recorded)'}`,
    `This scene: "${scene.title || 'Untitled scene'}"\n"""\n${sceneWithNotes(scene.prose)}\n"""`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const text = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

/** The model's answer as a reading. A reply with no JSON in it is an error: there is nothing to show. */
export function parseFlow(reply: string): Omit<FlowReading, 'thin' | 'model' | 'prose'> {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0];
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json ?? '') as Record<string, unknown>;
  } catch {
    throw new Error('The model did not answer with a reading.');
  }
  const role = text(raw.role).toLowerCase();
  const moodChecks = (Array.isArray(raw.moodChecks) ? raw.moodChecks : []).flatMap((m): MoodCheck[] => {
    const o = typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : {};
    const check = { entity: text(o.entity), state: text(o.state), sceneQuote: text(o.sceneQuote), note: text(o.note) };
    return check.entity && check.note ? [check] : [];
  });
  return {
    position: text(raw.position),
    role: (ROLES as readonly string[]).includes(role) ? (role as Role) : 'unclear',
    why: text(raw.why),
    tone: text(raw.tone),
    shift: text(raw.shift),
    moodChecks,
  };
}

/** A short fingerprint of a scene's prose (FNV-1a), to tell a reading of this text from one of an older draft. */
export function proseFingerprint(prose: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < prose.length; i++) h = Math.imul(h ^ prose.charCodeAt(i), 0x01000193);
  return `${prose.length}:${(h >>> 0).toString(36)}`;
}

/** Has the scene been written since this reading? */
export const isStale = (reading: FlowReading, scene: Scene): boolean => reading.prose !== proseFingerprint(scene.prose);

const READINGS_KEY = 'lw-flow-readings-v1';

function loadReadings(): Record<Id, FlowReading> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(READINGS_KEY) ?? '{}');
    return typeof raw === 'object' && raw !== null ? (raw as Record<Id, FlowReading>) : {};
  } catch {
    return {};
  }
}

function keep(readings: Record<Id, FlowReading>): void {
  try {
    localStorage.setItem(READINGS_KEY, JSON.stringify(readings));
  } catch {
    // The readings only last for this session.
  }
}

interface FlowStore {
  readings: Record<Id, FlowReading>;
  /** The scene being read. */
  running: Id | null;
  /** Why the last reading of a scene failed, by scene. */
  errors: Record<Id, string>;
  /** The writer dismissed a mood check: it fits after all. */
  dismiss: (sceneId: Id, check: MoodCheck) => void;
}

export const useFlow = create<FlowStore>((set) => ({
  readings: loadReadings(),
  running: null,
  errors: {},
  dismiss: (sceneId, check) =>
    set((f) => {
      const reading = f.readings[sceneId];
      if (!reading) return {};
      const readings = { ...f.readings, [sceneId]: { ...reading, moodChecks: reading.moodChecks.filter((m) => m !== check) } };
      keep(readings);
      return { readings };
    }),
}));

/** Logging out forgets the readings: they quote the manuscript, and this browser may be shared. */
export function forgetFlow(): void {
  try {
    localStorage.removeItem(READINGS_KEY);
  } catch {
    // Nothing was kept.
  }
}

let stopper: AbortController | null = null;

export function stopFlow(): void {
  stopper?.abort();
}

/** Reads the scene's place in the story through the model and keeps the reading. Errors are kept per scene, not thrown. */
export async function readFlow(sceneId: Id): Promise<void> {
  flushEditors();
  const vault = useStore.getState().vault;
  const scene = vault.scenes[sceneId];
  if (!scene || scene.prose.trim() === '') return;
  const { model, effort } = useAgent.getState();
  useFlow.setState((f) => {
    const errors = { ...f.errors };
    delete errors[sceneId];
    return { running: sceneId, errors };
  });
  stopper = new AbortController();
  try {
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: FLOW_SYSTEM },
          { role: 'user', content: flowContext(vault, sceneId) },
        ],
        model,
        ...(effort && effort !== 'default' ? { effort } : {}),
      }),
      signal: stopper.signal,
    });
    const json = (await res.json()) as { message?: { content?: string | null }; model?: string; error?: string };
    if (!res.ok) throw new Error(json.error ?? `The server answered ${res.status}.`);
    const reading: FlowReading = { ...parseFlow(json.message?.content ?? ''), thin: thinOutline(vault, scene.storyId), model: json.model ?? model ?? '', prose: proseFingerprint(scene.prose) };
    useFlow.setState((f) => {
      const readings = { ...f.readings, [sceneId]: reading };
      keep(readings);
      return { readings };
    });
  } catch (e) {
    if (!stopper?.signal.aborted) useFlow.setState((f) => ({ errors: { ...f.errors, [sceneId]: e instanceof Error ? e.message : String(e) } }));
  } finally {
    stopper = null;
    useFlow.setState({ running: null });
  }
}
