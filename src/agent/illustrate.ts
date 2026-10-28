// Pictures made by an image model, as placeholders until the writer has real illustrations: a scene illustration (typed as
// /addillustration in the editor) and an entity's portrait. The story model first reads the page and writes the image
// prompt; the writer can change it; the picture comes back marked as AI-made, and the app shows it with a "temporary"
// watermark. The server holds the key (server/app.ts, /api/agent/image).

import { create } from 'zustand';
import { formatValue } from '../core/resolve';
import type { Entity, Id, ImageAsset, Vault } from '../core/types';
import { getResolver, useStore } from '../store/store';
import { entitiesNamedIn, describeEntity } from './context';
import { useAgent } from './run';

export interface Style {
  id: string;
  label: string;
  /** Said to the image model before anything else. */
  prompt: string;
}

export const STYLES: Style[] = [
  { id: 'anime', label: 'Anime', prompt: 'Anime style illustration: clean line art, expressive faces, soft cel shading, rich colour.' },
  { id: 'watercolor', label: 'Watercolour', prompt: 'Watercolour illustration: loose washes, visible paper texture, soft edges, muted colour.' },
  { id: 'comic', label: 'Comic', prompt: 'Comic book illustration: bold ink outlines, flat colour, dynamic composition.' },
  { id: 'ink', label: 'Ink sketch', prompt: 'Black ink sketch on paper: fine cross-hatching, no colour.' },
  { id: 'realistic', label: 'Realistic', prompt: 'Realistic painterly illustration: natural light, detailed, cinematic composition.' },
];

/** Reference pictures the image model takes in one call (the server allows the same). */
export const MAX_REFERENCES = 4;

/** What the dialog is asked to make: a picture for the moment just before the cursor, or a portrait of an entity. */
export type IllustrateRequest =
  | {
      kind: 'scene';
      /** The scene being written, for what the pages said at that point in the story. */
      sceneId?: Id;
      /** Everything in the editor before the cursor. */
      before: string;
      /** Puts the picture's markdown into the text at the cursor. */
      insert: (markdown: string) => void;
    }
  | { kind: 'portrait'; entityId: Id };

interface IllustrateStore {
  request: IllustrateRequest | null;
  open: (request: IllustrateRequest) => void;
  close: () => void;
}

export const useIllustrate = create<IllustrateStore>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

/** What the story model says about the moment. */
export interface Draft {
  /** What the picture shows, in plain words; the writer edits this. */
  description: string;
  /** Short, for the image's caption in the text. */
  caption: string;
  /** Entities in the picture, by page name. */
  characters: string[];
}

const PASSAGE_LIMIT = 6000;
const PAGE_LIMIT = 700;

const SCENE_SYSTEM = `You write prompts for an image model that draws one illustration for a story.
You are given pages of the characters and places named so far, and the story text up to the point where the writer asked for an illustration.
Find the LAST moment of the text (its final sentences) and illustrate that moment, not the whole passage.
Reply with JSON only: {"description": string, "caption": string, "characters": string[]}.
- "description": 2 to 4 sentences for the image model: the setting, who is there and what each is doing, the mood and the light. Describe each person's appearance from their page (hair, clothes, age, build) so they look the same in every picture. Never put text, speech bubbles or writing in the picture.
- "caption": at most 8 words.
- "characters": the exact page names (as given in the headings) of the people and places that appear in this moment; leave out anyone only mentioned.`;

const PORTRAIT_SYSTEM = `You write prompts for an image model that draws one portrait of a story's character, place or object from its wiki page.
Reply with JSON only: {"description": string, "caption": string, "characters": []}.
- "description": 2 to 4 sentences for the image model: for a person, their face, hair, age, build and clothes, shown from the chest up facing the viewer against a plain, simple background; for a place or object, a clear single view of it. Use only what the page says; invent nothing that contradicts it. Never put text or writing in the picture.
- "caption": at most 8 words.`;

/** The prose as the model should read it: pictures and their data are not story. */
function cleanPassage(before: string): string {
  const text = before.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
  return text.length > PASSAGE_LIMIT ? `…${text.slice(-PASSAGE_LIMIT)}` : text;
}

/** The pages the model is shown, and the entities they stand for (those named in the text so far). */
export function scenePages(vault: Vault, sceneId: Id | undefined, before: string): { text: string; entities: Entity[] } {
  const entities = entitiesNamedIn(vault, before).map((id) => vault.entities[id]);
  if (!entities.length) return { text: '(no pages yet)', entities };
  const r = getResolver(vault);
  const text = entities
    .map((e) => {
      if (sceneId && vault.scenes[sceneId]) return describeEntity(vault, r, e.id, sceneId);
      const at = r.entityAt(e.id, { kind: 'latest' });
      return `### ${at.name}\n${at.note.slice(0, PAGE_LIMIT)}`;
    })
    .join('\n\n');
  return { text, entities };
}

export function sceneMessages(vault: Vault, request: Extract<IllustrateRequest, { kind: 'scene' }>): { role: 'system' | 'user'; content: string }[] {
  const { text } = scenePages(vault, request.sceneId, request.before);
  return [
    { role: 'system', content: SCENE_SYSTEM },
    { role: 'user', content: `Pages:\n${text}\n\nStory text so far:\n${cleanPassage(request.before)}` },
  ];
}

export function portraitMessages(vault: Vault, entityId: Id): { role: 'system' | 'user'; content: string }[] {
  const at = getResolver(vault).entityAt(entityId, { kind: 'latest' });
  const type = vault.entityTypes[vault.entities[entityId].typeId]?.name ?? '';
  const props = Object.entries(at.props).map(([k, p]) => `- ${k}: ${formatValue(p.value)}`);
  const page = `### ${at.name} [${type}]\n${props.join('\n')}\n\n${at.note.slice(0, PAGE_LIMIT * 2).trim() || '(empty page)'}`;
  return [
    { role: 'system', content: PORTRAIT_SYSTEM },
    { role: 'user', content: page },
  ];
}

/** The model's answer as a draft. A reply that is not the JSON asked for is still a description the writer can edit. */
export function parseDraft(text: string): Draft {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (json) {
    try {
      const raw = JSON.parse(json) as Record<string, unknown>;
      if (typeof raw.description === 'string' && raw.description.trim()) {
        return {
          description: raw.description.trim(),
          caption: typeof raw.caption === 'string' ? raw.caption.trim() : '',
          characters: Array.isArray(raw.characters) ? raw.characters.filter((c): c is string => typeof c === 'string') : [],
        };
      }
    } catch {
      // Not JSON after all: the text below is used as it is.
    }
  }
  return { description: text.replace(/```(?:json)?/g, '').trim(), caption: '', characters: [] };
}

/** The entities of `candidates` the model named, in the model's order. */
export function pickCast(candidates: Entity[], named: string[]): Entity[] {
  const byName = new Map(candidates.map((e) => [e.name.toLowerCase(), e]));
  const out: Entity[] = [];
  for (const n of named) {
    const e = byName.get(n.trim().toLowerCase());
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/**
 * What the image model is told: the style, which reference picture is whom (so each person keeps their face), then the
 * description. `cast` are the people whose portraits are sent, in the order they are sent.
 */
export function composePrompt(style: Style, cast: { name: string }[], description: string): string {
  const refs = cast.length
    ? `The reference pictures, in order: ${cast.map((c, i) => `${i + 1} is ${c.name}`).join('; ')}. Draw each of them to look exactly like their reference picture.`
    : '';
  return [style.prompt, refs, description.trim(), 'No text, captions or speech bubbles in the picture.'].filter(Boolean).join('\n\n');
}

/** One call to the story model, answered in the JSON the prompts ask for. */
export async function askDraft(messages: { role: string; content: string }[], signal: AbortSignal): Promise<Draft> {
  const { model, effort } = useAgent.getState();
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, model, ...(effort && effort !== 'default' ? { effort } : {}) }),
    signal,
  });
  const json = (await res.json()) as { message?: { content?: string }; error?: string };
  if (!res.ok) throw new Error(json.error ?? `The server answered ${res.status}.`);
  return parseDraft(json.message?.content ?? '');
}

/** One call to the image model: the picture as a data URL. */
export async function makePicture(prompt: string, references: string[], size: '1024x1024' | '1536x1024', signal: AbortSignal): Promise<string> {
  const res = await fetch('/api/agent/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, references, size }),
    signal,
  });
  const json = (await res.json()) as { image?: string; error?: string };
  if (!res.ok || !json.image) throw new Error(json.error ?? `The server answered ${res.status}.`);
  return json.image;
}

/** A stored picture of the writer's vault, made by a model. */
export function newImageAsset(src: string, prompt: string): ImageAsset {
  return { id: `img_${crypto.randomUUID().slice(0, 12)}`, src, ai: true, prompt, created: Date.now() };
}

/** Keeps a new picture in the vault's image store, as one undoable step. */
export function storeImage(asset: ImageAsset): void {
  const s = useStore.getState();
  s.commit({ ...s.vault, images: { ...s.vault.images, [asset.id]: asset } }, undefined, 'Add illustration');
}
