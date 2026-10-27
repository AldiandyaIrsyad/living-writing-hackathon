# Living Writing

A worldbuilding and writing workspace where **the world changes as your stories happen**.
Characters die, friends become enemies, cities fall — and every link to them knows *when*
you are in the story.

Think of it as an editing suite for prose: stories are tracks on a timeline, scenes are
clips, a playhead says "now", and the Inspector shows the world as it is at that moment.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Open **Vault ▾ → Load demo world** to explore a small example, or
**Load large sample (2,000 scenes)** to try the timeline at scale.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm test` | Unit tests (Vitest) — core engine, links, markdown, export/import, perf budget |
| `npm run test:e2e` | End-to-end tests (Playwright, Chromium). First time: `npx playwright install chromium` |
| `npm run test:e2e:backend` | The same for server mode: starts the server and a backend build of the app |

Everything is stored locally in your browser (IndexedDB) and autosaved. Use
**Vault ▾ → Export** for a JSON backup or a zip of plain Markdown files.

### Two ways to run it

| | Frontend only (default) | With a server |
|---|---|---|
| Where the vault lives | Your browser (IndexedDB), optionally mirrored to a folder | A SQLite file on the server, one private vault per account |
| Accounts | None | Email and password sign-up and log-in |
| Develop | `npm run dev` | `npm run dev:full` (API on :8787 and the app on :5173; `PORT` / `WEB_PORT` move them) |
| Build | `npm run build` | `npm run build:full`, then `npm start` serves the app and the API from one process |
| Needs | Node 22+ | Node 24+ (built-in SQLite) |

The mode is fixed when the app is built (`VITE_BACKEND=1`, set by `--mode backend`), so a frontend-only build never
contacts a server. Server settings are environment variables: `PORT` (8787), `HOST` (127.0.0.1), `DB_PATH`
(`living-writing.db`), `STATIC_DIR` (`dist`), `ALLOW_SIGNUP=false` to close registration, and `SECURE_COOKIE=true` when
the server sits behind HTTPS. Folder sync is off in server mode; the zip and JSON exports are the backup path. A save
made from a tab that is behind the server's copy is refused rather than overwriting it ("changed on another device,
reload"). `npm run test:e2e:backend` runs the browser test for server mode.

### The story agent (server mode)

A model reads each scene you hand in and keeps the wiki current, so you only write the story. It runs in the Inspector's
"Story agent" section and needs the server: set `MODEL_API_KEY` (and optionally `META_API_BASE`, default
`https://api.meta.ai/v1`, and `AGENT_MODELS`, a comma-separated list the writer picks from in the panel, the first being
the default), then `npm run dev:full`. Keys can go in `.env.local` (copy `.env.local.example`; it is never committed).
Without a Meta key, `npm run dev:gemini` uses Google's Gemini instead (`GEMINI_API_KEY`, optional `GEMINI_API_BASE`,
default model `gemini-3.8-flash`) through its OpenAI-compatible endpoint; the panel says which service it talks to. The default list is Meta's chat models, Standard first: a `-contributor` model is
cheaper, but Meta may train its models on what is sent to it, so the panel warns when one is picked.

- **When it reads:** only when you press "Read this scene" (or "Read the chapter": its scenes in order, skipping
  those already read and unchanged) (default), when you leave a scene you edited, or a while
  after you stop typing (**Wait**: 5 seconds, 20 seconds by default, 1 or 2 minutes). A scene whose text has not
  changed since the last reading is not read again, a scene marked as an idea is only read when you ask (it is not
  canon yet), and loading the demo or importing a vault is not writing: its scenes wait until you ask or edit them.
- **A `[[link]]` with no page** gets a page, of the entity type the scene suggests (a person, a place, an object…); the
  panel lets you change the type in one click. Names you did not link are listed, each with "Link it" (and "Link all
  and read again", which gives them all pages in one reading); a short name that is part of one page's name links to
  that page ("Mara" → `[[Mara Voss|Mara]]`) rather than making a second one. Set **Names I
  didn't link → Link and file them** and the agent links a name where it first appears and makes its page, so you can
  write without `[[ ]]` at all. A name a letter or two off an existing page is never linked this way (it asks instead).
- **Untitled scenes** ("Untitled scene", "New scene"): the agent suggests a title ("Use it"), titles them, or leaves
  them, as you choose. A title you gave is never changed.
- **Thinking** sets how long the model thinks before it answers. Longer catches more but is slower: on Gemini, "High"
  takes about half a minute for a short scene, "Low" (its default here) a few seconds. "Model default" sends no
  setting, for a model that does not take one. A reading can be stopped (**Stop**), and the server gives up on a model
  call after 90 seconds (`AGENT_TIMEOUT_SECONDS`). While it reads, the panel says what it is looking up.
- **Pages are kept true, not only added to.** The agent adds a fact under the heading it belongs to, and rewrites or
  removes a line the story has made untrue. The edit is a page version from that scene on (earlier scenes keep the old
  page, so nothing is spoiled) and is carried into the page's later versions. Re-reading an earlier scene, or taking it
  back, updates those later versions too.
- **Your lines are yours.** Who wrote each line is read from the page's history. The agent may always rewrite its own
  lines; yours only with "Allow overwriting what I wrote in the wiki" on. Off (the default), its changes to your lines
  are offered with Apply / Keep mine. The same option covers property values you set (a value the type's template
  filled in does not count as yours). A page version you edit, or an agent edit you accept, becomes yours, and "Take
  back" leaves it alone.
- **Properties** the entity already has (status, owner…) are changed from the scene on when the story changes them.
  **Short-lived condition** (where they are, mood, what they know) is kept as one `state` property per scene, shown in
  the Cast, so the history is not full of "he's hungry" commits.
- **Facts a character only claims** (lies, rumours, dreams) are listed, never written, with "It's true, write it".
- **Possible inconsistencies** come with a quote from the scene and one from the wiki; one the agent cannot back with
  both quotes is dropped. A flashback is checked against the story as it was at its own place on the timeline.
- **Time:** the agent dates a scene with a label the timeline can order ("Late Autumn, 2026", "Winter, Year 3"), worked
  out from the latest dated scene before it plus any time the scene says has passed; "morning" is never written. It
  fills an empty label only where the date fits between the dated scenes around it, and otherwise only suggests one, as
  it does over yours. It never invents a year: date one scene (or say it in a chapter note) and it carries on from
  there. Time skips and dates are suggestions with Apply. It never moves a scene.
- **Chapter notes:** the box under a chapter's title holds notes on the whole chapter ("Set in late autumn, 2026.");
  the agent reads them with every scene in it.
- **Talking to the agent:** author notes (`%% this is not true, she is lying %%`) reach it marked as notes, where
  you left them. A note about the story outranks the scene; notes about the writing itself (pacing, "fix later") are
  ignored, and an idea a note only wonders about is never recorded as fact. Put a note next to what it is about: a
  `%% this section is a dream %%` right after the dream covers the dream, not the waking scene that follows. Say what
  the prose leaves open (`%% Gull is dead %%` when he only "went under"), since the agent records only what it can tell.
- **Sources:** the entity page's "Sources" button shows the page line by line, each run of lines tagged with the scene
  whose version wrote it (and "agent" when the agent did). Click a tag to open the scene.
- **A fact that was true all along:** what the agent writes goes into the page's later versions by itself. Under a
  page's edits, "Update from the beginning" writes them into every version before the scene too, back to the base
  page (offered only when the page has an earlier version that lacks them).
- **Too early:** a flashback is shown what its characters only gain in later scenes ("Not true yet in this scene"). One
  that already shows it (the scar, before the fight that gave it) is flagged like any contradiction, quoting the wiki
  line that comes later.
- **Take back** removes everything the agent wrote for a scene, including what "Update from the beginning" wrote into
  earlier versions. Agent changes carry an `agent` field (the model that wrote them) in the vault and in exports.

The browser builds the prompt and applies the answer; the server only relays one chat call (with the key) and is limited
to 120 calls per account per 10 minutes.

## The workspace

```
┌ top bar · Ctrl+K palette · undo/redo · Vault menu ──────────────────────────┐
│ Stories & World │ Document tabs (scenes, entities…)  │ Inspector            │
├─────────────────┴────────────────────────────────────┴──────────────────────┤
│ Timeline — tracks per story, clips per scene, arc & chapter bands, playhead │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Timeline** (bottom, drag its top edge to resize, ▴ to maximise)
  - One **track per story** — main story, side stories, or an entirely different tale.
  - **Playhead**: click/drag the ruler, or ←/→ (Shift = 5). The readout says which
    arc · chapter · scene you're in.
  - **Zoom**: Ctrl+wheel (around the cursor), Alt+wheel (around the playhead), or with the
    timeline focused `=` / `-` (around the playhead), `0` = **Fit**, `1` = scene size, `Z` =
    frame the chapter under the playhead (Shift+Z: its arc; also in the chapter bar's
    right-click menu). The overview strip below the tracks shows the whole work: drag an edge
    to zoom, drag the window to scroll. Chapter and arc bands stay above the clips at any zoom.
  - **Drag a clip** onto another clip — left third = *before*, middle = *same time*,
    right third = *after*. Drag a **track header** to move a whole story. Shift-click to
    select several clips. **Move** mode re-places them; **Constrain** mode only adds an
    ordering rule (contradictions are refused: "time loop").
  - **+** on a clip inserts a new scene right after it; double-click empty track space
    to insert there.
  - **Tracks**: ✕ on a track header takes that story off the timeline (it isn't deleted);
    **+ Track** brings it back or starts a new story.
  - **Focus mode**: the timeline auto-hides while you type (a thin strip remains — hover
    it, press Esc or Ctrl+J to bring it back). ⚙ switches between *Always show*,
    *Auto-hide while typing* and *Hidden*.
- **Inspector** (right)
  - **Cast**: follows the scene you're writing. It starts empty; every `[[name]]` you type
    joins it, shown as they are *entering this scene*, with their latest commits. Add
    actors/locations by hand, and **Commit change…** to record what happens to someone
    here (a message like "Loses his arm in the fire", plus an optional property).
    With no scene open, it shows the point under the playhead.
  - **Scene**: when the open scene happens (rules relative to other scenes, time label)
    and the full list of **commits** it makes.
- **Left panel** (pick a tool on the activity bar): **Stories** (a picker that shows only the
  story you're working on: arcs → chapters → scenes), the **Wiki** (typed entities with
  parent / children / sibling relations, filtered by type), **Search**, author **Notes** and
  **Tags**.
- **Command palette** (Ctrl+K): jump to anything; `/text` full-text search, `>` commands,
  `@` entities, `#` scenes. Shift+Enter adds an entity to the open scene's cast / moves
  the playhead to a scene.

### Commits

Every change to a character, place or relationship is a **commit** attached to a scene:
a message ("Falls defending the inn"), optionally with a structured property
(`status: dead`). It takes effect *after* that scene. An entity's page shows its history
as a git-style log.

## The time model

Time is **relative**, not a calendar. Every scene sits at a *moment*; moments are ordered
by rules like "A before B". Several scenes can share a moment (simultaneous). Moments with
no rule between them are simply *unordered* — that's allowed.

- The timeline lays moments out in columns (a valid chronological order of the rules).
- **State of an entity at a point** = its base properties, then every state change from
  scenes that are *strictly before* that point. Changes whose order is unknown are listed
  as "order unknown"; conflicting unordered values are flagged **ambiguous**.
- A scene's **reading order** (chapters, ↑/↓) is separate from its place in time, so
  flashbacks just work.
- Stories have chapters; chapters can be grouped into **arcs**.

## Link syntax (Obsidian-compatible)

| Syntax | Meaning |
|---|---|
| `[[norman]]` | Inside a scene: Norman *as he is entering that scene*. In a note: latest. |
| `[[norman\|the old man]]` | Alias text |
| `[[norman#Backstory]]` | Link to a heading |
| `![[norman]]` | Embed (rendered at the contextual time) |
| `[[norman@latest]]` | Always the latest state |
| `[[norman@The Siege]]` / `@before:The Siege` | Norman entering the scene "The Siege" |
| `[[norman@after:The Siege]]` | Just after that scene (its own changes applied) |

Also supported: `#tags` and `#nested/tags`, YAML frontmatter, callouts (`> [!note]`),
task lists, tables, strikethrough. Type `[[` for autocomplete; hover a link for a state
card; Ctrl+click a link in the editor to open it. Renaming an entity or scene rewrites
every link to it.

## Code map

- `src/core/` — pure TypeScript engine (no React): `graph.ts` (moment partial order,
  reachability bitsets, layering), `resolve.ts` (state at a time point), `timeline.ts`
  (move / constrain / insert / delete), `links.ts`, `markdown.ts`, `exchange.ts`
  (JSON + Markdown zip), `seed.ts`, `perfSeed.ts`.
- `src/store/` — zustand store (vault + undo/redo + UI state), `actions.ts` (vault edits), Dexie
  persistence (`db.ts`) and folder sync (`fsSync.ts`: the vault as Markdown files in a folder you pick).
  `server.ts` is server mode's client: accounts and `ServerStorage`.
- `server/` — the optional server (`app.ts`: Fastify, accounts, sessions, one vault per user in SQLite; `main.ts`: start-up).
- `src/ui/` — React UI: `timeline/` (zoom math in `zoom.ts`), `inspector/`, `editor/` (CodeMirror 6),
  `left/` (Stories, Wiki, Search, Notes, Tags), `relations/`, `affiliations/`, `export/`, `views/`.
- `src/core/fixtures/` — frozen files written by format version 1. Never edit them; add a new
  version beside them when the format changes.
- `e2e/` — Playwright tests.
