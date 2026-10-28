# Living Writing — v1 Spec

A local-first web app for writing stories and building worlds that **change over time**.
Think "git for worldbuilding": scenes are commits, they change the state of characters,
places, objects and relationships, and you can look at any entity *as it was* at any
point in the story's time.

Runs in the browser with no backend by default. An optional server mode (README, "Two ways to run it") keeps a
private vault per account on a small Node server; sharing a vault and live collaboration are not part of it.

---

## 1. Core concepts

### Entities
- Anything in the world: characters, places, objects, factions, relationships, concepts.
- **Entity types are user-defined** (create "Character", "Place", "Spell", …). Each type
  has a name, colour/icon, and optional default properties (a template, not a schema —
  entities can always add more).
- Each entity has:
  - a unique name/slug (what `[[links]]` point at) plus aliases
  - a markdown note (free text, full Obsidian-style syntax)
  - **base properties**: freeform key/value pairs. Values are text, number, boolean,
    a `[[link]]` to another entity, or a list of these.
- **Relationships** are just entities of a built-in `Relationship` type with a
  `between: [[a]], [[b]]` property, so they have state that evolves
  (`status: friends` → `status: enemies`).

### Time (relative, not dates)
- Time is a **partial order**, not a calendar. Things happen *before*, *after*, or
  *at the same time as* other things. No "days between" maths.
- The unit placed in time is a **Moment**. Every scene sits at exactly one moment.
  Several scenes (from any stories) can share a moment → they happen simultaneously.
- Moments are ordered by **constraints**: `A before B`. The constraint graph must stay
  acyclic; any edit that would create a cycle is rejected with a clear message.
- Two moments with no path between them are **unordered** (parallel / unknown order).
  That is allowed.
- Optional **time label** per moment (e.g. "Winter, Year 3", "The night of the fire").
  Display only — never used for ordering.

### Stories & scenes
- A **Story** is a named line of narrative: main story, side stories, short tales.
- A story contains **Scenes** in **telling order** (the order the reader reads them),
  optionally grouped into **Chapters**.
- Telling order is independent from chronological order, so flashbacks just work:
  a scene can be 10th in telling order but placed before scene 1 in time.
- A scene has: title, prose (markdown), its moment, and a list of **state changes**.

### State changes (the "commits")
- A state change says: at this scene, `entity.property` becomes `value`
  (set / remove / add-to-list / remove-from-list).
  Examples: `norman.status = dead`, `sword-of-ash.owner = [[mira]]`,
  `alice-bob.status = enemies`.
- Changes are **commits**: every change can carry a free-text **message**
  ("Falls defending the inn", "Learns the truth about Bob"). A commit may be *only* a
  message (op `note`) — structured properties are optional, not the main way to
  describe a character. Entity history reads like a git log.
- A change belongs to a scene and takes effect **after** that scene. Inside the scene
  (and anything before it in time), the entity is as it was entering the scene.
- Authored from the Inspector's Cast ("Commit change…" on an actor → message +
  optional property) or the scene's State changes panel. Entities can also be
  *created* in a scene (they don't exist before it) and *retired* (not after it).

### Living pages (the entity's page is versioned too)
- Every entity has a full markdown **page** (its note) and a **name**, and both are
  versioned over story time. A **revision** (op `revise`) at a scene sets a new page
  and/or a new name (`Strider → Aragorn`) from that scene on, with a commit message.
- The flow is: write a scene → update the characters' pages → write the next scene…
  Viewing story time 5 shows every page as committed by time 5: the entity tab, the
  [[link]] hover card and embeds all use the page and name at that point.
- One revision per entity per scene: committing again in the same scene amends it, and a
  revision equal to the page before the scene is dropped.
- The entity's history shows each revision as a line diff (+ added / − removed lines).
- Links resolve by any name the entity has had (`[[Aragorn]]` finds the renamed entity).
- Opened from the entity tab ("Revise page here") or the Cast ("Update page…").
- **Writing upwards.** Committing an earlier version (the base page via "Edit base page", or a
  revision made in the past) that *adds* lines offers them to every later version that stores
  its own page text. A preview shows each version's diff with a checkbox; nothing is written
  until confirmed, in the same undo step as the commit. Only pure additions flow (edited or
  deleted lines never do); a later version is never overwritten. Placement: after the line the
  addition followed, else before the line it preceded, else at the end of the same heading's
  section, else at the end of the page. Versions where the surroundings were rewritten and no
  heading matches are shown as conflicts and left unticked. (`src/core/pagePropagate.ts`)

### Resolving state ("norman @ some point")
- **State of entity E at moment M** = base properties, then apply every state change
  from scenes whose moment is **strictly before M** (reachable backwards in the graph),
  in a deterministic topological order; then the scene's own changes if viewing
  "after this scene".
- Changes from **unordered** moments are *not* applied, but the inspector lists them
  under "possibly relevant (order unknown)".
- If two applied changes to the same property have no order between them, show both
  values with a small "ambiguous" marker (no automatic contradiction checking in v1 —
  it's just visible).
- `latest` = state after all changes, using the topological order of all moments.

---

## 2. Link syntax (Obsidian-compatible, plus time)

Supported markdown: CommonMark + GFM (tables, task lists, strikethrough),
YAML frontmatter, `#tags` (nested `#tag/sub`), callouts (`> [!note]`), and:

| Syntax | Meaning |
|---|---|
| `[[norman]]` | Link. **Time-contextual**: inside a scene it resolves to Norman *at that scene's moment*; in a plain note it resolves to `latest`. |
| `[[norman\|the old man]]` | Alias display text |
| `[[norman#Backstory]]` | Link to heading |
| `![[norman]]` | Embed the note (rendered at the contextual time) |
| `[[norman@latest]]` | Force latest state |
| `[[norman@The Siege]]` | Norman at the moment of the scene named "The Siege" |
| `[[norman@before:The Siege]]` / `@after:` | Just before / just after that scene |

- Typing `[[` opens autocomplete (entities, scenes, aliases). Unknown link targets are
  shown as "unresolved" and can be created with one click (Obsidian behaviour).
- Typing the first letters of a page's name or alias (or of a later word of its name) suggests it, like an IDE: Tab
  writes it as a link, Enter still starts a new line. The command "Toggle name suggestions while I type" turns this off.
- **Hovering** a link shows a card with the entity's state at the resolved moment
  (key properties, e.g. `status: dead`, plus which scene last changed each property).
  **Clicking** opens the entity page pinned to that moment.
- Renaming an entity updates all links to it.

---

## 3. Screens — an editing-suite layout (think DaVinci Resolve, for stories)

The app is one workspace, not a set of pages. Long-form writing lives on the timeline,
so the timeline is always on screen and is the main way to move through the work.

```
┌ top bar: brand · undo/redo · Ctrl+K palette · vault menu ─────────────────────────┐
│ Left: Stories (tracks) │ Center: document tabs          │ Right: Inspector         │
│  + World (entities)    │  (scene editor / entity page / │  state of the world at   │
│                        │   story / types / search)      │  the playhead            │
├────────────────────────┴────────────────────────────────┴──────────────────────────┤
│ TIMELINE (docked, resizable, can be maximised)                                      │
│  toolbar: Fit, Move/Constrain, shortcuts, behaviour (zoom: wheel, keys, range bar)  │
│           playhead readout "Arc II · Chapter 4 · Gathering Storm"                   │
│  ruler with column ticks, draggable playhead                                        │
│  track per story: header (colour, name, eye, +) · arc band · chapter band · clips   │
│  overview strip: the whole work in miniature, visible window highlighted            │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Timeline (docked, bottom)** — the heart of the app.
   - The dock is as tall as its tracks need (up to 45% of the window); dragging its top edge keeps the height the
     writer gave it, and the timeline's ⚙ menu ("Timeline height") switches between the two.
   - One **track per story** (main story, side stories, entirely separate stories).
     Columns are chronological order (topological layers of the moment graph);
     simultaneous scenes share a column. Scenes are **clips**.
   - **Playhead**: a whole column (time is discrete), shown as a tinted band numbered in the ruler;
     click or drag along the ruler to pick the column under the pointer; ←/→ step.
     Position *x* means "at the start of column *x*: every clip ending at or before *x* has happened".
     The readout names the arc · chapter · scene you are in.
   - **Semantic zoom** (Ctrl+wheel around the cursor, Alt+wheel around the playhead, `=`/`-`/`0`/`1`/`Z`
     keys, Fit, the overview bar). Contract: whatever you point at stays still; with no pointer
     the playhead does, or the view centre when the playhead is off screen. Zoomed in shows full scene clips;
     zooming out collapses scenes into **chapter blocks**, then **arc blocks**, so you
     can see e.g. five chapters at a time and know where you are. An overview strip
     shows the whole work with a draggable viewport.
   - **Drag a clip** (or a story's track header, or a shift-selected group) onto another
     clip: left third = before, middle = same time, right third = after. **Move** mode
     rewrites placement; **Constrain** mode only adds a rule (time loops are rejected
     with a message). "+" on a clip inserts a scene right after it; double-click empty
     track space inserts a scene at that point.
   - **Tracks are added/removed on the timeline itself** (not deleted — just not shown):
     × on a track header removes it from the timeline; a "+ Track" menu re-adds hidden
     stories or creates a new one. Working on story A? Remove B's track. Remembered
     per browser.
   - **Focus mode**: the timeline can be hidden (button / Ctrl+J). Behaviour setting:
     *Always show*, *Auto-hide while typing* (default — collapses to a thin strip while
     you type in an editor; comes back on hover over the strip, Esc, or leaving the
     editor), *Hidden*.
   - Highlight scenes involving an entity.
   - Virtualised rendering so 2,000 clips stay smooth.
2. **Inspector (right) — the Cast** — follows the document you are working on, not
   pins. Empty for empty writing; as you type `[[norman]]` Norman appears (in order of
   first mention), resolved **at that scene's point in time**, one click to open.
   Actors/locations can also be added to a scene's cast manually (stored on the scene).
   Each card shows the entity's recent commits (messages) and properties at that time,
   plus "Commit change…" to record a new commit in this scene. With no scene open, the
   Cast shows the scene under the playhead. Ambiguous / unknown-order changes are marked.
   A second tab, **Scene**, holds placement-in-time and the full State changes list.
3. **Center document tabs**: **chapter document** (CodeMirror, live link decorations; see below),
   scene editor for a scene without a chapter, entity page (name, type, aliases, base properties, note,
   history, backlinks; its State follows the timeline playhead with previous/next-change buttons, or has
   its own time scrubber under the setting "State panel time"; it can also be a row on the timeline with a
   keyframe for each change), story page (chapters, **arcs**, reading
   order), entity type manager, search, tags.
   **Chapter document.** Opening a scene opens its whole chapter as one markdown document, scrolled
   to that scene. Scenes are the granular unit of time (cast, commits, placement on the timeline);
   the chapter is what you read and write:
   - Every `# Heading` line (outside code fences and author notes) is a scene: the heading is its
     title, the text under it is its prose. Text above the first heading is an untitled first scene.
   - Typing a new `# Heading` creates a scene at once, placed right after the scene above it in time
     and in reading order (drag it elsewhere on the timeline afterwards). Renaming a heading renames
     the scene everywhere, as before.
   - Deleting a heading (or its `#`) merges that scene into the scene above it: its prose joins the
     scene above, and its commits and hand-added cast move there. The first scene merges into the one
     below. A chapter never loses its last scene this way. Ctrl+Z restores it.
   - The scene under the cursor is the open scene: the quick panel (cast, When/Commits/Notes), the
     timeline highlight and the outline follow it. Opening a scene from anywhere scrolls to it.
   - Scenes without a chapter keep their own single-scene editor.

4. **Left panel** — built for 50 characters and 200 chapters:
   - An activity bar picks the tool: Stories, **Wiki**, Search, Notes, Tags (one world holds many
     stories; multiple worlds later).
   - **Wiki panel**: typed entities (characters / places / objects…) with type filter chips and a
     search box, shown as a tree by parent / children relations; click to open.
   - **Story pane** (below): a **story picker** dropdown ("which story am I working
     on?") showing only that story's arcs → chapters → scenes, collapsible.
5. **Command palette (Ctrl+K)**: fuzzy jump to entities/scenes/stories, full-text
   search (`/query`), and commands: move the playhead to a scene, zoom levels,
   new story / scene / entity, toggle timeline, toggle theme, export.

Stories have **chapters**; chapters can optionally be grouped into **arcs**.

---

## 3b. Writing features

1. **Affiliations** — an entity can belong to several groups at once (factions, guilds,
   families, crews), and memberships change over time.
   - Stored as the list property `affiliations` (links to group entities). Joining /
     leaving in a scene is a commit (`add` / `removeItem` on `affiliations`, usually with
     a message like "Joins the Night Watch"). Base affiliations live in base properties.
   - Entity types can be marked as **group types** (`EntityType.group = true`, e.g.
     Faction); group pickers suggest entities of those types.
   - Entity page: **Affiliations** section (chips at the selected time, "Join…" /
     "Leave" recorded either as base or as a commit in a chosen scene).
     Group page: **Members** at the selected time.
   - Cast cards show affiliation chips.
2. **Type gallery** — one-click presets: Character, Place, Faction (group), Item,
   Flora & Fauna, Lore, Event, Culture, Magic/System, Concept. Each preset has a colour,
   icon and *suggested* (never required) default properties. Nothing is forced — add only
   the types you use; custom types still work as before.
3. **Author notes** — comments in prose and notes, Obsidian `%% … %%`, HTML-style
   `<!-- … -->` (inline or multi-line), or a quick `// …` line comment: from the `//` to the end
   of the line, when the `//` starts a line or follows whitespace (so `https://…` is never a note).
   A `//` inside `%% … %%` or `<!-- … -->` is just content of that note.
   - Highlighted (muted, margin-note look) in the editor. Ctrl+/ inserts one: `// ` at the end of a
     line with text (or at the start of an empty line), or wraps a selection in `%% … %%`.
   - **Show / hide in the editor**: the "Notes: shown / hidden" toggle in the scene header (also
     Ctrl+Shift+/) collapses each note to a 💬 marker. Clicking a marker reveals that note until
     the cursor leaves it; a note the cursor is inside is always shown.
   - Hidden in preview and in exports; `[[links]]` inside them don't count as mentions, and they
     are left out of word counts.
   - "Author notes" view lists every note across the vault (story · chapter · scene,
     click to jump); the Inspector's Scene tab lists the open scene's notes.
4. **Manuscript export** — choose a story and a chapter range (or arc); output in
   reading order as **Markdown**, **HTML** (styled, print-ready → PDF) or **plain text**.
   Options: chapter headings, scene titles or scene breaks (`* * *`), keep author notes
   (off by default). `[[links]]` become plain text (alias or name), tags stay as text,
   frontmatter is dropped.

## 4. Tech & architecture

- **Vite + React + TypeScript (strict)**. React is not the speed risk; re-rendering the
  whole tree on every keystroke is. So:
  - **CodeMirror 6** for the editor (handles big documents, decorations for links,
    autocomplete) — not a React-controlled textarea.
  - **Zustand** (or similar) with fine-grained selectors so typing in a scene doesn't
    re-render the timeline.
  - State resolution is **memoised / incrementally cached** per (entity, moment);
    invalidated only by changes to the moment graph or state changes.
  - Target: typing stays smooth and timeline drag re-resolves in < 50 ms with the
    performance seed below.
- **Core engine as a pure TS module** (`src/core/`), no React or DOM imports:
  moment graph (constraints, cycle detection, topological layers, reachability),
  state resolution, link parsing/resolution, rename refactoring. This is the most
  tested part.
- **Persistence**: IndexedDB (via Dexie), autosave. Behind a `Storage` interface with two
  implementations: IndexedDB in the browser, and `ServerStorage` (`src/store/server.ts`) in server mode.
- **Export / import**: whole vault as JSON, and as a zip of markdown files with YAML
  frontmatter (entities as `.md`, scenes as `.md` with `moment` and `changes` in
  frontmatter) so the writing is never locked in.
- **Versions and migrations**: exports carry a format version and the browser database a schema
  version; an older one is upgraded step by step on open (`src/core/migrate.ts`), a newer one is
  refused with a message and nothing is overwritten. Frozen fixtures of every released format
  live in `src/core/fixtures/`. Fields a record carries that this version does not know are kept
  (`extra`) and written back, so newer data survives a round trip. Version 2 added the **review list** (scenes to look at again,
  with the reason; items close only when the writer closes them).
- **Folder sync** notices files changed outside the app: files only one side changed go with that
  side, edits in different places are merged line by line, and edits in the same place wait for
  the writer's choice. Nothing is written over a file that changed outside, and whatever either
  side loses is first copied to `.living-writing-backup/`.
- Undo/redo for edits, timeline moves and state changes; Undo and Redo name the step they undid
  when the edit was named.
- Light and dark theme. Calm, writer-friendly UI; keyboard-first where reasonable.
- Timeline settings (⚙): arcs, chapters and scenes can each be hidden on story tracks; the scrollbar above the overview bar is off by default (the overview scrolls and zooms). A scene clip shows its address and ◆n, the number of changes it makes to pages. The corner reads "Time n · label"; + Track is in the ruler corner. Dragging a story's name onto another story's name reorders the tracks (upper or lower half = before or after); dropping it on a scene still moves the whole story in time.
- The open scene's details (what happens, When, Changes, status; chapter and delete under ⋯) are in a bar above the text. The quick panel is the scene's name and Pin, the agent, the notes left in the text (this chapter, this scene, or everything) and the cast (a find box from 8 members). The timeline and its collapsed strip step between chapters (← Chapter / Chapter →). An auto-hidden timeline stays hidden until its strip is clicked, Esc or Ctrl+J; "Comes back by itself" (⚙) restores returning on click-away and strip hover.
- Two looks, stored per browser (command bar: Toggle look): Timetable (default; see DESIGN.md) numbers each scene in the outline as chapter.scene (the address the palette's go-to takes, `:4.1`), and Classic is the earlier warm design.

### Out of scope for v1
Branching / "what if" timelines, automatic contradiction detection (beyond the Problems list, which only suggests), multiple users,
sync, accounts, graph view, real calendar dates, mobile layout polish, multiple worlds.
**Retcon cascades** (e.g. a character no longer dies in chapter 2 — which of the 10
later chapters need revisiting?) are a known future need: later, show the ripple of a
changed/moved commit and produce a checklist of affected scenes.
(Keep the data model open to branching later: moments and changes should carry a
`timelineId`, defaulting to `main`.)

---

## 5. Demo seed vault

Ship a "Load demo world" button that creates a small world used by the tests:
- Types: Character, Place, Object, Relationship.
- Characters `norman`, `mira`, `alice`, `bob`; place `ashford`; object `sword-of-ash`;
  relationship `alice-bob` (`status: friends`).
- **Main story** with chapters 1–5, grouped into arcs "Arc I: Embers" (ch 1–3) and
  "Arc II: Ash" (ch 4–5). Chapter 3 scene "The Betrayal" sets
  `alice-bob.status = enemies`. Chapter 5 scene "The Fall of Ashford" sets
  `norman.status = dead` and `ashford.state = ruined`.
- **Side story** "Mira's Road" with 2 scenes, initially placed between chapters 2 and 3,
  one of which sets `sword-of-ash.owner = [[mira]]`.
- Chapter 1 prose contains `[[norman]] is eating his food.`
- The demo's changes carry commit messages (e.g. Norman: "Falls defending the inn").

A separate "performance seed" generator: 500 entities, 20 stories, 2,000 scenes,
5,000 state changes.

---

## 6. Acceptance criteria (definition of done)

All must hold:

1. `npm run build` succeeds with no TypeScript errors; `npm run lint` is clean.
2. `npm test` (Vitest) passes, with unit tests covering at least: constraint add/remove,
   cycle rejection, simultaneous moments, topological layering, reachability,
   state resolution (before/after/unordered/ambiguous), `@latest` / `@scene` /
   `@before:` / `@after:` link resolution, rename refactoring, export→import round trip.
3. `npm run test:e2e` (Playwright) passes, covering on the demo seed:
   - Hovering `[[norman]]` in chapter 1 shows `status: alive`; on the Norman entity page
     at `latest` it shows `status: dead`; scrubbing to chapter 4 (with the State panel time setting on
     its own slider) shows `alive`.
   - `alice-bob` shows `friends` in chapter 2 and `enemies` in chapter 4.
   - Dragging "Mira's Road" in the timeline to after chapter 5 makes
     `sword-of-ash.owner` empty when viewed at chapter 4 (it was `mira` before the move).
   - Dropping a scene "at the same time as" another puts both in the same column.
   - A drag that would create a cycle is rejected with a message and changes nothing.
   - Zooming the timeline out switches clips to chapter blocks, then arc blocks
     ("Arc II: Ash" visible); zooming in shows scene clips again.
   - The Cast follows the open scene: in "The Fall of Ashford" Norman's card shows
     `status: alive` (entering the scene); in a new empty scene the Cast is empty, and
     typing `[[Bob]]` makes Bob appear. With no scene open, moving the playhead past
     "The Fall of Ashford" shows Norman `status: dead` in the Cast of that point.
   - Committing a change from the Cast ("Commit change…" with a message) shows that
     message in the entity's history.
   - Removing "Mira's Road" from the timeline (× on its track) hides the track; "+ Track"
     brings it back. Typing in the scene editor auto-hides the timeline; Ctrl+J shows it.
   - Creating an entity type, an entity with freeform properties, and a new scene via
     "insert here" works, and `[[` autocomplete finds the new entity.
   - Reload the page → everything is still there (IndexedDB persistence).
   - Export markdown zip → clear vault → import → demo assertions above still pass.
4. With the performance seed loaded, a timeline drag re-resolves in < 50 ms
   (measured in a unit/bench test of the core engine) and the UI stays usable.
5. `README.md` explains how to run, the link syntax, and the time model.
