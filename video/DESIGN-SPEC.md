# Living Writing — hackathon demo film: design spec

Mode: **autonomous free creation** (video-shotcraft), chosen by the user. The user also set: a ~2.5–3 min
captioned demo for hackathon judges, no voiceover, plan shown then built straight through.

## 0. Product brief

- **What it is.** A writing tool where the writer only writes. An agent reads each scene and keeps a
  versioned wiki of the story true: pages, short-lived character states, contradiction checks. Stories are
  tracks on a timeline; every page has versions in story time.
- **Audience.** Hackathon judges, watching once, often in a small player. Second audience: fiction writers
  and worldbuilders.
- **One-line claim.** *A wiki for fiction, kept true by an agent.* (From PRODUCT.md positioning.)
- **Must show.** (1) writing with `[[links]]`; (2) Check → agent files pages and states; (3) contradiction
  with both quotes; (4) Take back in one click; (5) timeline tracks + playhead, world as of a moment;
  (6) page versions; (7) ~~a flashback judged against its own past~~ (dropped: not reproducible with the real model; replaced by a scene's Changes); (8) Flow reader (role, tone); (9) the rest:
  placeholder portraits, Ctrl+K, 2,000-scene scale, light/dark, Markdown export.
- **Data.** Only the bundled public demo vault ("The Ashford Chronicle", "Mira's Road") and text typed for
  the film. A local throwaway test account. No customer, usage or performance claims (PRODUCT.md: none may
  be invented). Model output is captured once and frozen.

### Requirement → execution decisions

| Requirement | Decision |
|---|---|
| 2.5–3 min, captioned, no voice | 4530f @30fps = 2:31. Every product shot carries a caption ≥56px; title cards and the wordmark do not. |
| Judges, small player | Captions 56–60px, one idea per shot, slow camera (R3), hold ≥1s on every caption'd conclusion. |
| Real product, real behaviour | All UI from 2x screenshots of the running app (server mode, real Meta Muse Spark model, non-contributor model selected). Hand-made pieces only for title cards, wordmark, Flow cards. |
| No music given | Content rhythm, not beat-locked (music-beat-sync §0). BGM picked in stage 6 from the bundled set, low under captions; delivered with and without BGM. |
| "Agent on Meta Muse Spark" | Stated once, in the outro small line (fact from PRODUCT.md). |

## 1. Visual direction

Styleframe **skipped**: the product has a strict written design system (DESIGN.md "the timetable") and the
film reuses it directly; recorded per pipeline stage 1 step 4.

**Direction: "the timetable, filmed".** Paper and ink, hairline rules, square corners, no shadows, colour
rationed. Yellow means *here* (playhead, current scene, the caption marker). Red means *wrong* (only the
contradiction). Story colours only on the timeline. The literary serif appears only where prose is quoted.

| Token | Value | Use in the film |
|---|---|---|
| paper | `#fbfaf5` | ground of title cards, caption strip, outro |
| paper-sunk | `#f2f0e8` | stage behind screenshots |
| ink | `#16181c` | all type, rules, reticle |
| ink-muted / faint | `#5b5f66` / `#8f9298` | sub lines, labels |
| rule | `#d9d6ca` | hairlines |
| here-yellow | `#ffd100` / soft `#ffe566` | caption marker, accent word, underline, playhead |
| fault-red | `#d52b1e` | contradiction reticle only |
| night | `#121316` | Flow card backs |
| UI font | Helvetica Neue → Arial, bold for titles, uppercase tracked labels | captions, labels, wordmark lockup |
| reading serif | Palatino Linotype (Iowan Old Style first) | cold-open line, scene cards, title-card statements |
| radius | 2px | everything |

**Motion tokens** (preset "professional trust" nudged toward "calm care": a tool used for hours):
main move ~24f, `bezier(0.33,0,0.15,1)` for camera, `bezier(0,0,0.2,1)` for entrances, no overshoot except
where a card's landing calls for it (reticle snap, flip settle). Three words: *calm, exact, inked.*
No handheld shake, no glints, no particles (gold dust in the outro card is replaced by nothing; the
energy comes from the elements' flight and the wordmark press). Deviation from Q8 "launch-event" outro
noted: the brand forbids decoration that competes with text; the outro peaks by motion and sound instead.

## 2. Feature → shot map

| # | Feature | Card · style | Demo source |
|---|---|---|---|
| 1 | The problem | typewriter-moves · error-retype | demos/typography/typewriter-moves/TypewriterErrorRetype.tsx |
| 2 | Name + claim | letterspace-materialize | demos/opening/letterspace-materialize/LetterspaceMaterialize.tsx |
| 3 | The whole desk | overhead-camera-moves · tilt-reveal | demos/camera/overhead-camera-moves/TiltReveal.tsx |
| — | Act cards ×4 | paper-title-card | demos/typography/paper-title-card/PaperTitleCard.tsx |
| 4–7 | Write, Check, contradiction, Take back | PageCam over real screens; fui-hud-moves · reticle-lock-on ×2 (new page, contradiction) | assets/lib/PageCam.tsx; demos/effects/fui-hud-moves/ReticleLockOn.tsx |
| 8 | Timeline tracks | PageCam over real screen | assets/lib/PageCam.tsx |
| 9 | World as of a moment | timeline-travel (chapter ticks, real cast cards pop) | demos/data/timeline-travel/TimelineTravel.tsx |
| 10 | Page versions | before-after-slider-scrub (Mira's page, ch2 vs ch4) | demos/data/before-after-slider-scrub/BeforeAfterSliderScrub.tsx |
| 11 | A scene's changes (replaces the flashback "too early" shot, see S11) | PageCam over real screen | assets/lib/PageCam.tsx |
| 12 | Flow roles | card-flip-reveal (4 scenes → Setup / Turn / Escalation / Climax) | demos/transition/card-flip-reveal/CardFlipReveal.tsx |
| 13 | Flow panel | PageCam over real screen | assets/lib/PageCam.tsx |
| 14 | Placeholder portrait | PageCam over real screens | assets/lib/PageCam.tsx |
| 15 | The rest | quad-split-parallel-scenes | demos/rhythm/quad-split-parallel-scenes/QuadSplitParallelScenes.tsx |
| 16 | Sign-off | outro-group-photo-launch (paper version) | demos/outro/outro-group-photo-launch/OutroGroupPhotoLaunch.tsx |
| seams | | shot-transitions · A flash-cut (×2 max), otherwise camera travel on the same screen or the title card's own fade | assets/lib/FlashCut.tsx |

Each technique is protagonist once (P4). Reticle is used twice on different targets (card limit ≤2).

## 3. Storyboard (30fps, 1920×1080) — as built

Frames are absolute; `src/Film.tsx` `SHOT_LIST` is the source of truth. Captions are 56px sans on a paper
label with a yellow square, bottom centre.

| # | Frames | Shot | What is on screen | Caption |
|---|---|---|---|---|
| S01 | 0–180 | Cold open | Paper. Serif "Before chapter 31," then typed *re-read chapters 1–30* → hesitate → backspace → *just write.* ("write" gets a yellow marker) | (the typed line is the text) |
| S02 | 180–320 | Wordmark | **Living Writing** strokes itself in ink, sub "A wiki for fiction, kept true by an agent." Hold 54f. | — |
| S03 | 320–530 | Establishing | Real app (The Stranger, inspector, timeline) tilts up from flat; three 56px labels pop on the regions: Write · The world · Time | (the labels) |
| T1 | 530–585 | Title card | "The *agent* keeps the wiki." · 1 · THE AGENT | — |
| S04 | 585–1045 | Write | 13 real typing frames (incl. the real [[ autocomplete) composited with a per-character reveal at ~7 characters/s; camera follows, then moves to the inspector | Write the scene. Link people and places with [[brackets]]. |
| S05 | 1045–1525 | Check | Click Check → Checking… → report (New page: Nora, states). Ink reticle locks on "New page: Nora". | Press Check. The agent files a page for Nora and updates who is where. |
| S06 | 1525–1885 | Contradiction | Push into the flag; red reticle "Contradiction"; pan to the scene line, red underline | It catches contradictions, quoting your scene and the wiki line it breaks. |
| S07 | 1885–2155 | Take back | Hover + click "Take back 5 changes"; report clears, [[Nora]] unresolved again (yellow mark) | Everything the agent wrote is one click from undone. |
| T2 | 2155–2210 | Title card | "The *timeline* is story time." · 2 · THE TIMELINE | — |
| S08 | 2210–2540 | Tracks | Flash cut in; push to the timeline dock: two story tracks, arcs, chapters, playhead | Stories are tracks. Scenes are clips. Side stories run alongside. |
| S09 | 2540–2750 | Time travel | Axis with a fixed yellow playhead; world slides Start → Chapter 4 → Chapter 5; real State panels pop: Norman alive · Alice & Bob enemies · Norman dead + Ashford ruined; brake + push | Move the playhead. See the world as it stood then. |
| S10 | 2750–2990 | Versions | Mira's page as of Chapter 2 vs Chapter 5 ("cut her hair short"), slider fling then slow scrub to 88% | Every page keeps its versions, in story time. |
| S11 | 2990–3290 | Scene changes | **Changed from the plan**: The Fall of Ashford, click Changes → the panel (Norman status dead "Falls defending the inn"; Ashford state ruined "Burned in the night of the fall"). The planned flashback "too early" flag could not be reproduced with the real model in two tries, so it was not faked. | Each scene records what it changes. Norman falls. Ashford burns. |
| T3 | 3290–3345 | Title card | "*Flow* reads the shape of the story." · 3 · FLOW | — |
| S12 | 3345–3555 | Flow roles | Four paper scene cards (real openings) flip to night backs: Setup · Turn · Escalation · Climax with the model's tone | Flow places each scene in the whole story: its part and its tone. |
| S13 | 3555–3885 | Flow panel | Real Flow section for The Betrayal: Turn, tone, position, why, shift | It reads your outline and the wiki. It never writes the story for you. |
| T4 | 3885–3940 | Title card | "Portraits, search, *export.*" · 4 · MORE | — |
| S14 | 3940–4240 | Portrait | Norman's page → Make portrait → prompt dialog → Make picture → ink sketch with TEMPORARY watermark → portrait on the page | Placeholder portraits from the wiki, marked temporary until real art. |
| S15 | 4240–4390 | Montage | Flash cut; 2×2: Ctrl+K go-to · many stories on one timeline (the built-in large sample; no scale or speed claim) · dark theme · Export Markdown (.zip); each panel has its own 56px label | (the panel labels) |
| S16 | 4390–4630 | Outro | Real elements (agent report, Flow, State, contradiction, portrait, timeline strip, Mira's page) fly in, recede; **Living Writing** letterpress, yellow rule, "You write. The wiki keeps up.", small "Agent on Meta Muse Spark". Hold ≥120f. | — |

Total 4630f = 2:34.

## 4. Capture list (stage 4)

Server mode (`npm run dev:full`), 1920×1080 viewport, deviceScaleFactor 2, light theme, timetable look,
demo vault, model `muse-spark-1.3`. Script: `capture/capture.mjs` (Playwright, from the app's own devDeps).
Each state → `public/textures/<name>.png` + element boxes in `public/textures/layout.json`.

## 5. Sound (as built)

- BGM: `bgm-tech-house.mp3` (bundled Mixkit set; the only bundled track longer than the film, 288s), volume 0.2,
  enters with the wordmark at f180 with a 45f fade-in, fades over the last 60f. Delivered with and without BGM.
- SFX: Freesound, CC0 only, list and hashes in `public/audio/sfx/audio-manifest.json` and
  `FREESOUND-CREDITS.md`. Cue table `src/Sound.tsx` `cues()`: each cue pinned to `startOf(shot) + offset`,
  shifted by the file's measured energy peak and the output AAC offset.
  Typewriter keys per character (S01), pen stroke (S02, S06 underline), soft whooshes for camera moves and
  flash cuts, mouse clicks for every real click, a switch click for each reticle lock and S09/S15 pops, card
  flips (S12), paper slide for the title cards, cinematic riser → impact on the outro wordmark. No sparkle/chime
  (brand: no decoration that competes with text).

## 6. Deliberate deviations (recorded after the independent review)

- **Yellow.** In the product, yellow means "where you are". The film also uses it as its single accent, and
  only for the point of each frame: the caption square, the accent word on title cards, the outro rule.
  The Flow role chips are yellow because the real Flow panel draws them yellow (S13 shows it).
- **Gradients and dims.** Used only in film-level devices, never on product UI: the far end of the tilting
  desk fades into paper-sunk (S03), the reticle dims the frame by 10% (S05, S06), the flash cut (S08, S15).
- **Two wordmarks.** S02 draws the name as single-line strokes (letterspace-materialize); the outro sets it
  in the UI sans as the product shows its name. The opening is the flourish; the outro is the sign-off.
- **Card parameters changed.** timeline-travel stop push 1→1.10 (demo 1.28) so the enlarged State panels stay
  in frame; before-after scrub ends at 88% (demo 40%) so the new line is fully readable at rest; card-flip
  backs show the scene's part and tone (the film has no numbers to show), no floor reflection or sheen
  (brand: no glints); reticle lock glow omitted (brand: no glow); quad-split panels are calm screenshots
  with one whip push on the timeline panel; outro has no dust, stage light or sparkle.
- **Text size.** All film-made text is ≥32 px except the screenshots themselves; small UI text inside the real
  State panels (S09) is shown at 1.4× its real size.
- **S02 and S03 carry no caption**: S02 is the name and claim, S03 has three 56 px labels instead.
- **Sync record.** Output AAC offset 1.28 f (Remotion 4.0.484, AAC 48 kHz, mp4, Windows, 2026-11-04),
  checked with `scripts/audio-offset.py` on the no-BGM render. Residuals: clicks −0.17/−0.17/−0.18 f,
  switch +0.40/+0.39 f, impact +0.14 f (cross-correlation 1.00 each). Typing and pen are continuous beds
  started with the action, so their file peak is not used.
- **BGM licence.** `bgm-tech-house.mp3` comes from the skill's bundled Mixkit set, but the bundle's own
  record cannot name the original track ("verify before commercial use"). The no-BGM version is delivered
  so the music can be replaced.
