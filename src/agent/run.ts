// The story agent in the browser: reads a scene through the model (with read-only wiki tools), applies the answer as one
// undoable step, and decides when to run. Only the model call goes through the server (it holds the key); the prompt
// is built here and the answer applied here, against the vault as it is when the model finishes.

import { create } from 'zustand';
import { BACKEND } from '../store/server';
import { flushEditors, useStore } from '../store/store';
import { applyAgentOutput, parseAgentOutput, type AgentReport } from './apply';
import { SYSTEM_PROMPT, TOOLS, buildContext, runTool } from './context';
import type { Id } from '../core/types';

/** When the agent reads scenes on its own. Reading the open scene by hand is always possible. */
export type Trigger = 'off' | 'leave' | 'idle';

const TRIGGER_KEY = 'lw-agent-trigger';
const IDLE_MS = 20_000;
const MAX_STEPS = 5;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface AgentStore {
  trigger: Trigger;
  /** Null until the server has said whether it has a model key. */
  enabled: boolean | null;
  model: string | null;
  running: Id | null;
  error: string | null;
  /** What the last run of each scene did. Kept for this session only. */
  reports: Record<Id, AgentReport>;
  setTrigger: (t: Trigger) => void;
}

function loadTrigger(): Trigger {
  try {
    const t = localStorage.getItem(TRIGGER_KEY);
    return t === 'leave' || t === 'idle' ? t : 'off';
  } catch {
    return 'off';
  }
}

export const useAgent = create<AgentStore>((set) => ({
  trigger: loadTrigger(),
  enabled: null,
  model: null,
  running: null,
  error: null,
  reports: {},
  setTrigger: (trigger) => {
    try {
      localStorage.setItem(TRIGGER_KEY, trigger);
    } catch {
      // The choice only lasts for this session.
    }
    set({ trigger });
  },
}));

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `The server answered ${res.status}.`);
  return json;
}

/** One scene through the model: it may look things up a few times, then answers with the JSON the prompt asks for. */
async function askModel(sceneId: Id): Promise<{ text: string; model: string }> {
  const vault = useStore.getState().vault;
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildContext(vault, sceneId) },
  ];
  for (let step = 0; step < MAX_STEPS; step++) {
    // The last step offers no tools, so the model has to answer.
    const { message, model } = await post<{ message: ChatMessage; model: string }>('/api/agent/chat', { messages, ...(step < MAX_STEPS - 1 ? { tools: TOOLS } : {}) });
    messages.push(message);
    if (!message.tool_calls?.length) return { text: message.content ?? '', model };
    for (const call of message.tool_calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        // A call the model garbled gets the "give some text" answer back.
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: runTool(vault, sceneId, call.function.name, args) });
    }
  }
  throw new Error('The model kept looking things up instead of answering.');
}

/** The last prose the agent finished reading for each scene, so a scene that has not changed is not read again. */
const read = new Map<Id, string>();
/** Scenes the writer has edited since the page loaded: the only ones the agent reads on its own. */
const edited = new Set<Id>();
let queue: Promise<void> = Promise.resolve();
const queued = new Set<Id>();

async function readScene(sceneId: Id): Promise<void> {
  flushEditors();
  const start = useStore.getState().vault.scenes[sceneId];
  if (!start || start.prose.trim() === '') return;
  useAgent.setState({ running: sceneId, error: null });
  try {
    const { text, model } = await askModel(sceneId);
    const s = useStore.getState();
    // The writer kept typing while the model read: its answer is about text that no longer exists.
    if (s.vault.scenes[sceneId]?.prose !== start.prose) throw new Error('The scene changed while the agent was reading it.');
    const { vault, report } = applyAgentOutput(s.vault, sceneId, parseAgentOutput(text), model);
    s.commit(vault, undefined, `Agent: ${start.title || 'scene'}`);
    read.set(sceneId, start.prose);
    edited.delete(sceneId);
    useAgent.setState((a) => ({ reports: { ...a.reports, [sceneId]: report } }));
  } catch (e) {
    useAgent.setState({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    useAgent.setState({ running: null });
  }
}

/** Drops what the panel remembers about a scene's last reading. */
export function forgetReport(sceneId: Id): void {
  useAgent.setState((a) => ({ reports: Object.fromEntries(Object.entries(a.reports).filter(([id]) => id !== sceneId)) }));
}

/** Reads a scene after any reading already under way. A scene already waiting is not queued twice. */
export function enqueueScene(sceneId: Id): void {
  if (queued.has(sceneId)) return;
  queued.add(sceneId);
  queue = queue.then(() => readScene(sceneId)).finally(() => queued.delete(sceneId));
}

function readEdited(): void {
  for (const id of edited) if (useStore.getState().vault.scenes[id]?.prose !== read.get(id)) enqueueScene(id);
}

/** Starts watching the writing. Called once the vault has loaded; does nothing outside server mode. */
export function startAgent(): void {
  if (!BACKEND) return;
  void fetch('/api/agent')
    .then((r) => r.json() as Promise<{ enabled: boolean; model: string | null }>)
    .then((a) => useAgent.setState({ enabled: a.enabled, model: a.model }))
    .catch(() => useAgent.setState({ enabled: false }));

  let idle: ReturnType<typeof setTimeout> | null = null;
  useStore.subscribe((s, prev) => {
    if (s.vault.scenes !== prev.vault.scenes) {
      for (const scene of Object.values(s.vault.scenes)) if (scene.prose !== prev.vault.scenes[scene.id]?.prose && scene.prose.trim() !== '') edited.add(scene.id);
      if (idle) clearTimeout(idle);
      if (useAgent.getState().trigger === 'idle') idle = setTimeout(() => readEdited(), IDLE_MS);
    }
    // Leaving a scene (to another scene, or to anything that is not a scene) is the writer handing it in.
    const was = prev.view.kind === 'scene' ? prev.view.id : null;
    const now = s.view.kind === 'scene' ? s.view.id : null;
    if (was && was !== now && useAgent.getState().trigger === 'leave' && edited.has(was)) enqueueScene(was);
  });
}

/** The writer asked for this scene to be read, whatever the setting. */
export function readSceneNow(sceneId: Id): void {
  read.delete(sceneId);
  enqueueScene(sceneId);
}
