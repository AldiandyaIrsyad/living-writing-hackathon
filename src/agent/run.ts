// The story agent in the browser: reads a scene through the model (with read-only wiki tools), applies the answer as one
// undoable step, and decides when to run. Only the model call goes through the server (it holds the key); the prompt
// is built here and the answer applied here, against the vault as it is when the model finishes.

import { create } from 'zustand';
import { BACKEND } from '../store/server';
import { flushEditors, useStore } from '../store/store';
import { chapterScenes } from '../core/chapterDoc';
import { applyAgentOutput, parseAgentOutput, type AgentReport } from './apply';
import { readFlow, stopFlow } from './flow';
import { SYSTEM_PROMPT, TOOLS, buildContext, runTool, type SceneTitles } from './context';
import type { Id } from '../core/types';

/** When the agent reads scenes on its own. Reading the open scene by hand is always possible. */
export type Trigger = 'off' | 'leave' | 'idle';

/**
 * How long a thinking model may think before it answers ("default" sends nothing and lets the model decide). Thinking
 * longer catches more, but slowly: Gemini on its own default takes half a minute for a short scene, on "low" a few seconds.
 */
export type Effort = 'default' | 'low' | 'medium' | 'high';
const EFFORTS: Effort[] = ['default', 'low', 'medium', 'high'];

/** What names the writer did not link become. "list": they are only reported. "link": the agent links and files them. */
export type LinkNames = 'list' | 'link';

const TRIGGER_KEY = 'lw-agent-trigger';
const MODEL_KEY = 'lw-agent-model';
const EFFORT_KEY = 'lw-agent-effort';
const LINK_NAMES_KEY = 'lw-agent-link-names';
const TITLES_KEY = 'lw-agent-titles';
const SETTINGS_OPEN_KEY = 'lw-agent-settings-open';
const OVERWRITE_KEY = 'lw-agent-overwrite';
const FLOW_KEY = 'lw-agent-flow-with-check';
const REPORTS_KEY = 'lw-agent-reports-v2';
const IDLE_KEY = 'lw-agent-idle-seconds';
/** How long "After I stop typing" waits, in seconds: a writer who stops to think may want longer than one who stops to check. */
export const IDLE_CHOICES = [5, 20, 60, 120];
const MAX_STEPS = 5;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface AgentStore {
  trigger: Trigger;
  /** One of IDLE_CHOICES. */
  idleSeconds: number;
  setIdleSeconds: (s: number) => void;
  /** Null until the server has said whether it has a model key. */
  enabled: boolean | null;
  /** Does the server have an image model too? Pictures (/addillustration, portraits) are offered only then. */
  images: boolean;
  /** The model service the server talks to, by name (Meta, or Google Gemini as a stand-in). */
  provider: string | null;
  /** The models the server offers, its default first. */
  models: string[];
  /** The writer's pick among `models`. */
  model: string | null;
  /** May the agent rewrite or remove lines the writer wrote on a wiki page? Off: it only offers those edits. */
  allowOverwrite: boolean;
  /** Does each reading of a scene also read its place in the story's flow (src/agent/flow.ts)? Off: only when asked. */
  flowWithCheck: boolean;
  setFlowWithCheck: (on: boolean) => void;
  /** Null until the server has said which service it is: the default depends on it. */
  effort: Effort | null;
  linkNames: LinkNames;
  sceneTitles: SceneTitles;
  /** Are the agent's settings unfolded in the panel? */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  running: Id | null;
  /** Scenes queued for reading, the one being read included. */
  waiting: number;
  /** What the reading under way is doing, in words. */
  progress: string | null;
  /** Why the last reading of a scene failed, by scene: one scene failing in a batch does not hide behind the next. */
  errors: Record<Id, string>;
  /** What the last run of each scene did, kept in this browser. */
  reports: Record<Id, AgentReport>;
  setTrigger: (t: Trigger) => void;
  setModel: (m: string) => void;
  setAllowOverwrite: (on: boolean) => void;
  setEffort: (e: Effort) => void;
  setLinkNames: (l: LinkNames) => void;
  setSceneTitles: (t: SceneTitles) => void;
  /** Replace (or with null, forget) what the panel shows for a scene's last reading. */
  setReport: (sceneId: Id, report: AgentReport | null) => void;
}

/** A "-contributor" model is cheaper, but Meta may train its models on what is sent to it: here, the manuscript. */
export const isContributor = (model: string): boolean => model.endsWith('-contributor');

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice only lasts for this session.
  }
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function loadTrigger(): Trigger {
  const t = recall(TRIGGER_KEY);
  return t === 'leave' || t === 'idle' ? t : 'off';
}

function loadReports(): Record<Id, AgentReport> {
  try {
    const raw: unknown = JSON.parse(recall(REPORTS_KEY) ?? '{}');
    return typeof raw === 'object' && raw !== null ? (raw as Record<Id, AgentReport>) : {};
  } catch {
    return {};
  }
}

export const useAgent = create<AgentStore>((set) => ({
  trigger: loadTrigger(),
  idleSeconds: ((s) => (IDLE_CHOICES.includes(s) ? s : 20))(Number(recall(IDLE_KEY))),
  setIdleSeconds: (idleSeconds) => {
    remember(IDLE_KEY, String(idleSeconds));
    set({ idleSeconds });
  },
  enabled: null,
  images: false,
  provider: null,
  models: [],
  model: null,
  allowOverwrite: recall(OVERWRITE_KEY) === 'true',
  flowWithCheck: recall(FLOW_KEY) === 'true',
  setFlowWithCheck: (flowWithCheck) => {
    remember(FLOW_KEY, String(flowWithCheck));
    set({ flowWithCheck });
  },
  effort: null,
  linkNames: recall(LINK_NAMES_KEY) === 'link' ? 'link' : 'list',
  sceneTitles: ((t) => (t === 'leave' || t === 'set' ? t : 'suggest'))(recall(TITLES_KEY)),
  settingsOpen: recall(SETTINGS_OPEN_KEY) !== 'false',
  setSettingsOpen: (settingsOpen) => {
    remember(SETTINGS_OPEN_KEY, String(settingsOpen));
    set({ settingsOpen });
  },
  running: null,
  waiting: 0,
  progress: null,
  errors: {},
  reports: loadReports(),
  setTrigger: (trigger) => {
    remember(TRIGGER_KEY, trigger);
    set({ trigger });
  },
  setModel: (model) => {
    remember(MODEL_KEY, model);
    set({ model });
  },
  setAllowOverwrite: (allowOverwrite) => {
    remember(OVERWRITE_KEY, String(allowOverwrite));
    set({ allowOverwrite });
  },
  setEffort: (effort) => {
    remember(EFFORT_KEY, effort);
    set({ effort });
  },
  setLinkNames: (linkNames) => {
    remember(LINK_NAMES_KEY, linkNames);
    set({ linkNames });
  },
  setSceneTitles: (sceneTitles) => {
    remember(TITLES_KEY, sceneTitles);
    set({ sceneTitles });
  },
  setReport: (sceneId, report) =>
    set((a) => {
      const reports = { ...a.reports };
      if (report) reports[sceneId] = report;
      else delete reports[sceneId];
      remember(REPORTS_KEY, JSON.stringify(reports));
      return { reports };
    }),
}));

const without = (errors: Record<Id, string>, sceneId: Id): Record<Id, string> => {
  const rest = { ...errors };
  delete rest[sceneId];
  return rest;
};

/**
 * Logging out forgets the reports: they quote the manuscript and the wiki, and this browser may be shared. (A report
 * is only what the panel shows about a reading; what the agent wrote stays in the vault, with Take back.)
 */
export function forgetReports(): void {
  try {
    localStorage.removeItem(REPORTS_KEY);
  } catch {
    // Nothing was kept.
  }
}

/** The reading under way, so the writer can stop it. */
let stopper: AbortController | null = null;

/** How many times a call the model service was too busy for is tried again before the reading gives up. */
const BUSY_RETRIES = 2;

async function post<T>(path: string, body: object, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    const json = (await res.json()) as T & { error?: string; retryAfter?: number };
    if (res.ok) return json;
    if (!json.retryAfter || attempt === BUSY_RETRIES) throw new Error(json.error ?? `The server answered ${res.status}.`);
    useAgent.setState({ progress: `${json.error} Trying again in ${json.retryAfter} s…` });
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(done, json.retryAfter! * 1000);
      signal.addEventListener('abort', () => (clearTimeout(timer), fail(signal.reason)), { once: true });
    });
  }
}

/** One scene through the model: it may look things up a few times, then answers with the JSON the prompt asks for. */
async function askModel(sceneId: Id, signal: AbortSignal): Promise<{ text: string; model: string }> {
  const vault = useStore.getState().vault;
  const { model: picked, effort, linkNames, sceneTitles } = useAgent.getState();
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildContext(vault, sceneId, { linkNames: linkNames === 'link', sceneTitles }) },
  ];
  // With an empty wiki there is nothing to look up, and every lookup costs a whole round with the model.
  const steps = Object.keys(vault.entities).length ? MAX_STEPS : 1;
  for (let step = 0; step < steps; step++) {
    // The last step offers no tools, so the model has to answer; some models still try, unless told.
    if (step > 0 && step === steps - 1) messages.push({ role: 'user', content: 'No more lookups. Answer now with the JSON object, from what you have.' });
    const { message, model } = await post<{ message: ChatMessage; model: string }>(
      '/api/agent/chat',
      { messages, model: picked, ...(effort && effort !== 'default' ? { effort } : {}), ...(step < steps - 1 ? { tools: TOOLS } : {}) },
      signal,
    );
    messages.push(message);
    if (!message.tool_calls?.length) return { text: message.content ?? '', model };
    const looked: string[] = [];
    for (const call of message.tool_calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        // A call the model garbled gets the "give some text" answer back.
      }
      const input = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
      looked.push(String(input.name ?? input.query ?? ''));
      messages.push({ role: 'tool', tool_call_id: call.id, content: runTool(vault, sceneId, call.function.name, args) });
    }
    useAgent.setState({ progress: `Looked up ${looked.filter(Boolean).join(', ') || 'the wiki'}; thinking again…` });
  }
  throw new Error('The model kept looking things up instead of answering.');
}

/**
 * The prose the agent last read for each scene, and as its reading left it (names linked): a scene back at either, as
 * after an Undo, has not changed and is not read again.
 */
const read = new Map<Id, string[]>();
/** Scenes the writer has edited since the page loaded: the only ones the agent reads on its own. */
const edited = new Set<Id>();
let queue: Promise<void> = Promise.resolve();
const queued = new Set<Id>();
/** Bumped by Stop: readings queued before it are dropped. */
let generation = 0;

/**
 * `asked`: the writer asked for this reading (a button), rather than the agent reading on its own. True when the
 * answer was applied.
 */
async function readScene(sceneId: Id, asked: boolean): Promise<boolean> {
  flushEditors();
  const start = useStore.getState().vault.scenes[sceneId];
  if (!start || start.prose.trim() === '') return false;
  useAgent.setState((a) => ({ running: sceneId, progress: null, errors: without(a.errors, sceneId) }));
  stopper = new AbortController();
  try {
    const { text, model } = await askModel(sceneId, stopper.signal);
    const s = useStore.getState();
    // Deleted while it was read: there is nothing to apply the answer to, and nothing went wrong.
    if (!s.vault.scenes[sceneId]) return false;
    // The writer kept typing while the model read: its answer is about text that no longer exists.
    if (s.vault.scenes[sceneId]?.prose !== start.prose) {
      // Reading on its own, the agent reads it again when the writer next pauses or leaves: no need to say anything.
      if (!asked) return false;
      throw new Error('The scene changed while the agent was reading it.');
    }
    const { allowOverwrite, linkNames, sceneTitles } = useAgent.getState();
    const { vault, report } = applyAgentOutput(s.vault, sceneId, parseAgentOutput(text), { model, allowOverwrite, linkNames: linkNames === 'link', sceneTitles });
    s.commit(vault, undefined, `Agent: ${start.title || 'scene'}`);
    // Linking names changes the prose: that is not the writer editing it again.
    read.set(sceneId, [start.prose, vault.scenes[sceneId].prose]);
    edited.delete(sceneId);
    useAgent.getState().setReport(sceneId, report);
    return true;
  } catch (e) {
    // Stopped by the writer: nothing went wrong.
    if (!stopper?.signal.aborted) useAgent.setState((a) => ({ errors: { ...a.errors, [sceneId]: e instanceof Error ? e.message : String(e) } }));
    return false;
  } finally {
    stopper = null;
    useAgent.setState({ running: null, progress: null });
  }
}

/** The writer stops the reading under way, and those waiting; nothing is applied. */
export function stopReading(): void {
  generation++;
  stopper?.abort();
  stopFlow();
}

/** Reads a scene after any reading already under way. A scene already waiting is not queued twice. */
export function enqueueScene(sceneId: Id, asked = true): void {
  if (queued.has(sceneId)) return;
  queued.add(sceneId);
  useAgent.setState({ waiting: queued.size });
  const at = generation;
  queue = queue
    // Stop drops what was waiting too.
    .then(() => (at === generation ? readScene(sceneId, asked) : false))
    // The flow is read after the Check, in the same queue, so the two calls never overlap.
    .then((applied) => (applied && at === generation && useAgent.getState().flowWithCheck ? readFlow(sceneId) : undefined))
    .finally(() => {
      queued.delete(sceneId);
      useAgent.setState({ waiting: queued.size });
    });
}

/**
 * The writer asked for a whole chapter: its scenes in reading order, each after the one before (a later scene is read
 * with what the earlier ones wrote). Scenes read since the page loaded and not changed since are skipped.
 */
export function readChapter(chapterId: Id): void {
  for (const s of chapterScenes(useStore.getState().vault, chapterId)) if (s.prose.trim() && !read.get(s.id)?.includes(s.prose)) enqueueScene(s.id);
}

/** Reading on its own, the agent skips a scene marked as an idea: it is not canon yet. */
function readOnItsOwn(sceneId: Id): void {
  const scene = useStore.getState().vault.scenes[sceneId];
  if (scene && scene.status !== 'idea' && !read.get(sceneId)?.includes(scene.prose)) enqueueScene(sceneId, false);
}

function readEdited(): void {
  for (const id of edited) readOnItsOwn(id);
}

/** Starts watching the writing. Called once the vault has loaded; does nothing outside server mode. */
export function startAgent(): void {
  if (!BACKEND) return;
  void fetch('/api/agent')
    .then((r) => r.json() as Promise<{ enabled: boolean; images?: boolean; provider: string | null; models: string[] }>)
    .then((a) => {
      // A model remembered from before is kept only while the server still offers it.
      const saved = recall(MODEL_KEY);
      // Gemini thinks for half a minute by default, and on "medium" a scene with a few lookups can still pass the
      // server's time limit; "low" answers in seconds. Other services decide for themselves unless the writer says
      // otherwise, as not every one takes the setting.
      const effort = recall(EFFORT_KEY) as Effort | null;
      useAgent.setState({
        enabled: a.enabled,
        images: a.images === true,
        provider: a.provider,
        models: a.models,
        model: saved && a.models.includes(saved) ? saved : (a.models[0] ?? null),
        effort: effort && EFFORTS.includes(effort) ? effort : a.provider === 'Google Gemini' ? 'low' : 'default',
      });
    })
    .catch(() => useAgent.setState({ enabled: false }));

  let idle: ReturnType<typeof setTimeout> | null = null;
  useStore.subscribe((s, prev) => {
    if (s.vault.scenes !== prev.vault.scenes) {
      // A scene that was not there before arrived whole (the demo, an import), and is not the writer writing it.
      for (const scene of Object.values(s.vault.scenes)) {
        const before = prev.vault.scenes[scene.id];
        if (before && scene.prose !== before.prose && scene.prose.trim() !== '') edited.add(scene.id);
      }
      if (idle) clearTimeout(idle);
      const { trigger, idleSeconds } = useAgent.getState();
      // The writer may switch the setting during the wait: it is asked again when the wait is over.
      if (trigger === 'idle') idle = setTimeout(() => useAgent.getState().trigger === 'idle' && readEdited(), idleSeconds * 1000);
    }
    // Leaving a scene (to another scene, or to anything that is not a scene) is the writer handing it in.
    const was = prev.view.kind === 'scene' ? prev.view.id : null;
    const now = s.view.kind === 'scene' ? s.view.id : null;
    if (was && was !== now && useAgent.getState().trigger === 'leave' && edited.has(was)) readOnItsOwn(was);
  });
}

/**
 * The writer took back what the agent did here, links in the text included. The text that leaves is theirs again, not
 * an edit to read: reading it would put back what they just took back.
 */
export function tookBack(sceneId: Id): void {
  read.set(sceneId, [...(read.get(sceneId) ?? []), useStore.getState().vault.scenes[sceneId].prose]);
  edited.delete(sceneId);
}

/** The writer asked for this scene to be read, whatever the setting. */
export function readSceneNow(sceneId: Id): void {
  read.delete(sceneId);
  enqueueScene(sceneId);
}
