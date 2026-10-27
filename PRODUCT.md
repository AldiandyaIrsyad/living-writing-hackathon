# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Fiction writers drafting a long story or a series in a desktop browser, who do not want to re-read earlier chapters to keep their facts straight. Worldbuilders and game masters are an equal audience: for them the wiki and the timeline matter as much as the prose. The first people to see the product are hackathon judges watching a three-minute demo.

## Product Purpose

The writer only writes. An agent reads each scene they hand in and keeps a wiki of the story true: pages for people, places and things, a short-lived "state" per character, and checks that a new scene does not contradict what the wiki already knows. Success is a writer who never opens the wiki to stay consistent, yet can open it any time and trust it.

## Positioning

A version-controlled wiki for fiction, kept true by an agent. Every page has versions on a timeline, every line knows which scene wrote it, a flashback sees the story as it was at its own moment, and everything the agent wrote can be taken back in one click. A neighbouring writing tool could not truthfully claim the versioning plus the agent that maintains it.

## Operating Context

Long sessions in the editor with a left outline of arcs, chapters and scenes, the scene text in the middle, an inspector on the right (the agent's report, cast, commits), and a DaVinci-style timeline docked at the bottom with a track per story and rows for characters and wiki pages (a ◆ per version). Scenes are typed in markdown with `[[links]]`; the agent is run with **Check** and **Next**, or automatically. Works offline in the browser; server mode adds accounts and the agent.

## Capabilities and Constraints

React 19, zustand, CodeMirror 6; plain CSS with tokens in `src/ui/styles.css` and one CSS file per area. Light and dark themes exist. Terms: scene, chapter, arc, story, entity/page, state, keyframe, Check, Next, Take back. The agent runs on Meta Muse Spark models. Time is human-driven. Never remove features or change workflows for looks.

## Brand Commitments

Name: Living Writing. No other brand assets are binding; the visual identity is open and may be replaced entirely, including layout, per the user.

## Evidence on Hand

A demo story, "The Brackwood Orchard", a demo vault in the Vault menu, a 2:34 recorded demo. No logo, no customer or usage claims; none may be invented.

## Product Principles

1. The writer only writes: the interface recedes from the prose and the agent works beside it, never in front of it.
2. Everything the agent did is visible, grounded in the text, and one click from undone.
3. Time is a place you can stand in: the timeline, versions and flashbacks are navigated, not read about.
4. Never move or rewrite the writer's words without being asked.
5. Calm for hours of use; dense where the writer is managing a world.

## Accessibility & Inclusion

Keyboard-first (Ctrl K, timeline shortcuts); reduced-motion is respected; contrast must hold in light and dark.
