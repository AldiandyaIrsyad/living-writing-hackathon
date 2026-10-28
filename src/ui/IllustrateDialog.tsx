// Make a placeholder picture with the image model: an illustration for the moment just before the cursor (typed as
// /addillustration), or an entity's portrait. The story model drafts the prompt from the pages; the writer edits it,
// picks a style and which people's portraits are sent as references, looks at the picture, and only then keeps it.

import { useEffect, useRef, useState } from 'react';
import {
  askDraft,
  composePrompt,
  makePicture,
  MAX_REFERENCES,
  newImageAsset,
  pickCast,
  portraitMessages,
  sceneMessages,
  scenePages,
  storeImage,
  STYLES,
  useIllustrate,
} from '../agent/illustrate';
import type { Entity } from '../core/types';
import { updateEntity } from '../store/actions';
import { update, useStore } from '../store/store';
import { resizeDataUrl } from './imageUpload';
import './illustrate.css';

const STYLE_KEY = 'lw-illustration-style';

function savedStyle(): string {
  try {
    const id = localStorage.getItem(STYLE_KEY);
    return STYLES.some((s) => s.id === id) ? id! : STYLES[0].id;
  } catch {
    return STYLES[0].id;
  }
}

type Phase = 'drafting' | 'edit' | 'making' | 'preview';

export function IllustrateDialog() {
  const request = useIllustrate((s) => s.request);
  const close = useIllustrate((s) => s.close);
  const vault = useStore((s) => s.vault);
  const [phase, setPhase] = useState<Phase>('drafting');
  const [description, setDescription] = useState('');
  const [caption, setCaption] = useState('');
  const [style, setStyle] = useState(savedStyle);
  const [people, setPeople] = useState<{ entity: Entity; on: boolean }[]>([]);
  const [picture, setPicture] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  // A new request starts with the story model reading the pages.
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    abort.current = controller;
    setPhase('drafting');
    setError('');
    setPicture('');
    const v = useStore.getState().vault;
    const candidates = request.kind === 'scene' ? scenePages(v, request.sceneId, request.before).entities : [];
    const messages = request.kind === 'scene' ? sceneMessages(v, request) : portraitMessages(v, request.entityId);
    askDraft(messages, controller.signal)
      .then((draft) => {
        const named = pickCast(candidates, draft.characters);
        setDescription(draft.description);
        setCaption(draft.caption);
        setPeople(candidates.map((entity) => ({ entity, on: named.includes(entity) })));
        setPhase('edit');
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setDescription('');
        setCaption('');
        setPeople(candidates.map((entity) => ({ entity, on: false })));
        setPhase('edit');
      });
    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, close]);

  if (!request) return null;

  // Only portraits that are pictures in the vault can be sent; a link to somewhere else is not.
  const referenced = people.filter((p) => p.on && p.entity.image?.startsWith('data:image/')).slice(0, MAX_REFERENCES).map((p) => p.entity);
  const chosenStyle = STYLES.find((s) => s.id === style) ?? STYLES[0];
  const prompt = composePrompt(chosenStyle, referenced, description);

  const make = () => {
    const controller = new AbortController();
    abort.current = controller;
    setPhase('making');
    setError('');
    const portrait = request.kind === 'portrait';
    makePicture(prompt, referenced.map((e) => e.image!), portrait ? '1024x1024' : '1536x1024', controller.signal)
      .then((image) => resizeDataUrl(image, portrait ? 512 : 1024, 0.85))
      .then((src) => {
        setPicture(src);
        setPhase('preview');
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('edit');
      });
  };

  const keep = () => {
    const toast = useStore.getState().toast;
    if (request.kind === 'portrait') {
      update((v) => updateEntity(v, request.entityId, { image: picture, imageAi: true }));
      toast('info', 'Portrait set. It carries a “temporary” mark until you upload your own.');
    } else {
      const asset = newImageAsset(picture, prompt);
      storeImage(asset);
      const alt = caption.replace(/[[\]\n]/g, ' ').trim();
      request.insert(`\n\n![${alt}](img:${asset.id})\n\n`);
      toast('info', 'Illustration added. It carries a “temporary” mark until you replace it.');
    }
    close();
  };

  const title = request.kind === 'portrait' ? `Portrait of ${vault.entities[request.entityId]?.name ?? 'this page'}` : 'Illustrate this moment';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal impact-modal illustrate-modal" role="dialog" aria-modal="true" aria-label={title} data-testid="illustrate-dialog">
        <header className="impact-head">
          <h2 className="impact-heading">{title}</h2>
          <p className="impact-lead">A placeholder, marked “temporary” until you put a real illustration in its place.</p>
        </header>

        <div className="illustrate-body">
          {phase === 'drafting' && <p className="muted" data-testid="illustrate-drafting">Reading the pages and writing the prompt…</p>}
          {phase === 'making' && <p className="muted" data-testid="illustrate-making">Making the picture. This can take a minute…</p>}
          {error && (
            <p className="illustrate-error" role="alert" data-testid="illustrate-error">
              {error}
            </p>
          )}

          {phase === 'preview' && (
            <div className="illustrate-preview">
              <span className="ai-mark">
                <img src={picture} alt={caption || 'The new picture'} data-testid="illustrate-picture" />
              </span>
            </div>
          )}

          {phase === 'edit' && (
            <>
              <label className="illustrate-field">
                <span>What the picture shows</span>
                <textarea className="input" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="illustrate-description" />
              </label>
              {request.kind === 'scene' && (
                <label className="illustrate-field">
                  <span>Caption</span>
                  <input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} data-testid="illustrate-caption" />
                </label>
              )}
              <label className="illustrate-field illustrate-style">
                <span>Style</span>
                <select
                  className="select"
                  value={style}
                  data-testid="illustrate-style"
                  onChange={(e) => {
                    setStyle(e.target.value);
                    try {
                      localStorage.setItem(STYLE_KEY, e.target.value);
                    } catch {
                      // The choice only lasts for this dialog.
                    }
                  }}
                >
                  {STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {people.length > 0 && (
                <fieldset className="illustrate-people">
                  <legend>Keep their look from their portrait</legend>
                  {people.map((p, i) => {
                    const hasPortrait = !!p.entity.image?.startsWith('data:image/');
                    return (
                      <label key={p.entity.id} className={hasPortrait ? '' : 'faint'} title={hasPortrait ? undefined : 'No portrait uploaded: described in words only'}>
                        <input type="checkbox" checked={p.on} onChange={(e) => setPeople(people.map((q, j) => (j === i ? { ...q, on: e.target.checked } : q)))} />
                        {hasPortrait && <img src={p.entity.image} alt="" />}
                        {p.entity.name}
                        {!hasPortrait && ' (no portrait)'}
                      </label>
                    );
                  })}
                </fieldset>
              )}
            </>
          )}
        </div>

        <footer className="impact-foot">
          <button type="button" className="btn btn-ghost" onClick={close} data-testid="illustrate-cancel">
            {phase === 'preview' ? 'Discard' : 'Cancel'}
          </button>
          {phase === 'edit' && (
            <button type="button" className="btn btn-primary" onClick={make} disabled={!description.trim()} data-testid="illustrate-make">
              Make picture
            </button>
          )}
          {phase === 'preview' && (
            <>
              <button type="button" className="btn" onClick={() => setPhase('edit')} data-testid="illustrate-again">
                Change and make again
              </button>
              <button type="button" className="btn btn-primary" onClick={keep} data-testid="illustrate-keep">
                {request.kind === 'portrait' ? 'Use as portrait' : 'Insert'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
