// Home: your stories, with one click back to where you left off in each.

import { useMemo, useRef } from 'react';
import { buildStoryCards, type StoryCard } from '../../core/home';
import { formatCompact, formatCount } from '../../core/wordcount';
import { useStore, useVault } from '../../store/store';
import { OPEN_IMPORT_NOTES_EVENT } from '../ImportNotesDialog';
import { importVaultFile, loadDemo } from '../io';
import { appendScene, createStory } from '../stories';
import './home.css';

function placeLabel(card: StoryCard): string {
  const r = card.resume;
  if (!r) return '';
  const title = r.scene.title || 'Untitled scene';
  return r.chapterTitle ? `${r.chapterTitle} · ${title}` : title;
}

function storyMeta(card: StoryCard): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (card.chapters > 0) parts.push(plural(card.chapters, 'chapter'));
  parts.push(plural(card.scenes, 'scene'), `${formatCompact(card.words)} words`);
  return parts.join(' · ');
}

export function HomeView() {
  const vault = useVault();
  const visits = useStore((s) => s.lastVisits);
  const navigate = useStore((s) => s.navigate);
  const cards = useMemo(() => buildStoryCards(vault, visits), [vault, visits]);
  const importRef = useRef<HTMLInputElement>(null);

  const empty = Object.keys(vault.entities).length + Object.keys(vault.scenes).length + cards.length === 0;
  const hero = cards[0]?.visitedAt != null ? cards[0] : null;
  const rest = hero ? cards.slice(1) : cards;

  const open = (card: StoryCard) => {
    if (card.resume) navigate({ kind: 'scene', id: card.resume.scene.id });
    else appendScene(card.story.id);
  };

  return (
    <div className="view">
      <div className="view-narrow home">
        {empty ? (
          <>
            <h1 className="view-title home-title">Living Writing</h1>
            <p className="prose muted home-lede">
              A world that changes as your stories happen. Scenes sit in relative time and every scene can change the people, places and things in it.
            </p>
            <div className="row" style={{ marginTop: 24 }}>
              <button className="btn btn-primary" onClick={createStory} data-testid="home-new-story">
                Start a story
              </button>
              <button className="btn" onClick={loadDemo} data-testid="home-load-demo">
                Load the demo world
              </button>
              <button className="btn" onClick={() => importRef.current?.click()} data-testid="home-import">
                Open an export…
              </button>
              <button className="btn" onClick={() => window.dispatchEvent(new Event(OPEN_IMPORT_NOTES_EVENT))} data-testid="home-import-notes">
                Import notes…
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".json,.zip"
                hidden
                data-testid="home-import-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importVaultFile(f);
                  e.target.value = '';
                }}
              />
            </div>
            <p className="muted small" style={{ marginTop: 12 }}>
              An export is a .json file or a .zip of Markdown made by this app (Vault menu → Export). Opening one replaces what is here.
            </p>
          </>
        ) : (
          <>
            {hero && (
              <section className="home-hero" style={{ ['--story' as string]: hero.story.color }} data-testid="home-hero">
                <div className="section-title home-kicker">Continue where you left off</div>
                <div className="home-hero-story">{hero.story.name}</div>
                <div className="home-hero-place">{placeLabel(hero)}</div>
                <div className="row home-hero-actions">
                  <button className="btn btn-primary" onClick={() => open(hero)} data-testid="home-continue">
                    Continue writing
                  </button>
                  <span className="muted small" title={`${formatCount(hero.words)} words in the story`}>
                    {storyMeta(hero)}
                  </span>
                </div>
              </section>
            )}

            <div className="section-title">{hero ? 'Other stories' : 'Your stories'}</div>
            <div className="home-grid">
              {rest.map((card) => (
                <article key={card.story.id} className="home-card" style={{ ['--story' as string]: card.story.color }} data-testid="home-story">
                  <button type="button" className="home-card-main" onClick={() => open(card)}>
                    <span className="home-card-name">{card.story.name}</span>
                    <span className="muted small">{storyMeta(card)}</span>
                    <span className="home-card-place">{card.resume ? `${card.visitedAt === null ? 'Start at' : 'Continue'}: ${placeLabel(card)}` : 'No scenes yet — add the first'}</span>
                  </button>
                  <div className="home-card-tools">
                    <button className="btn btn-sm btn-ghost" onClick={() => navigate({ kind: 'story', id: card.story.id })}>
                      Story page
                    </button>
                    {card.resume && (
                      <button className="btn btn-sm btn-ghost" onClick={() => appendScene(card.story.id)}>
                        + Scene
                      </button>
                    )}
                  </div>
                </article>
              ))}
              <button type="button" className="home-card home-card-new" onClick={createStory} data-testid="home-new-story">
                + New story
              </button>
            </div>

            <div className="row home-foot">
              <button className="btn" onClick={() => useStore.getState().setSwitcherOpen(true)}>
                Jump to… (Ctrl K)
              </button>
              <span className="muted small">
                {Object.keys(vault.entities).length} entities · {Object.keys(vault.changes).length} changes
              </span>
            </div>
          </>
        )}

        <details className="home-help">
          <summary>Link syntax</summary>
          <table className="props small">
            <tbody>
              <tr>
                <th>[[norman]]</th>
                <td>Norman as he is at this point of the story (inside a scene), or latest (in notes)</td>
              </tr>
              <tr>
                <th>[[norman@latest]]</th>
                <td>Always the latest state</td>
              </tr>
              <tr>
                <th>[[norman@The Siege]]</th>
                <td>Norman entering the scene “The Siege”</td>
              </tr>
              <tr>
                <th>[[norman@after:The Siege]]</th>
                <td>Just after that scene (its own changes applied)</td>
              </tr>
              <tr>
                <th>[[norman|the old man]] · [[norman#Bio]] · ![[norman]]</th>
                <td>Alias · heading · embed</td>
              </tr>
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}
