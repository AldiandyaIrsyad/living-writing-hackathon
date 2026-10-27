---
name: Living Writing
description: An editing suite for stories, set like a Swiss railway timetable.
colors:
  paper: "#fbfaf5"
  paper-raised: "#ffffff"
  paper-sunk: "#f2f0e8"
  ink: "#16181c"
  ink-muted: "#5b5f66"
  ink-faint: "#8f9298"
  rule: "#d9d6ca"
  here-yellow: "#ffd100"
  here-yellow-soft: "#ffe566"
  fault-red: "#d52b1e"
  ok-green: "#1f7a4a"
  night: "#121316"
  night-ink: "#f2f0e8"
typography:
  ui:
    fontFamily: "Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
  reading:
    fontFamily: "Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  sm: "2px"
spacing:
  sm: "6px"
  md: "12px"
components:
  button:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
  outline-scene-current:
    backgroundColor: "{colors.here-yellow-soft}"
    textColor: "{colors.ink}"
---

# Design System: Living Writing

## Overview

**Creative north star: the timetable.** A story is read the way a traveller reads a departure board: every scene has an address (chapter.scene, the same one the palette's go-to understands, so `:4.1`), every character and wiki page is a straight line through the story, and one yellow mark says where you are now. Everything else steps back so the prose can be read for hours.

The surface is paper and ink: a pale paper ground, near-black type, hairline rules, square corners, no shadows. Colour is rationed. Yellow means "here" (the current scene, the playhead). Red means "wrong" (a contradiction, an error). Story and entity-type colours stay on the timeline, where they are data.

It refuses the warm cream, terracotta and rounded-card look of generic AI writing tools, and any decoration that competes with the scene text.

## Colors

- **Paper** (`#fbfaf5`) is the ground; **paper-raised** is for inputs and menus; **paper-sunk** for wells.
- **Ink** (`#16181c`) is text, rules, and the primary button. Muted and faint inks step down for secondary text.
- **Here-yellow** (`#ffd100`, soft `#ffe566`) is used only for place: the current scene band in the outline, the playhead, active toggles.
- **Fault-red** (`#d52b1e`) is only for contradictions, errors and destructive actions.
- Dark theme: **night** ground with paper-coloured ink; the yellow and red are unchanged in meaning.

## Typography

One sans (Helvetica Neue, falling back to Arial) for the whole interface, with bold weights for titles and section labels set small, uppercase and tracked. Scene addresses use tabular figures. The scene text itself, and rendered wiki prose, is set in a warm serif at a reading measure: it is the one place the interface stays literary.

## Layout

Four regions: an outline of numbered scenes on the left, the scene text in the middle, the inspector (agent report, cast, commits) on the right, and a timeline dock along the bottom with a track per story and a thin row per character or page. Density is high in the dock and outline and low around the prose. The dock is strictly linear: time runs left to right; rows never bend, branch or stack.

## Elevation & Depth

Flat. Menus and dialogs have a 1px ink outline and a hard 4px offset shadow at low opacity; nothing blurs.

## Shapes

Square (2px). Pills and circles survive only where they are data: status dots and keyframes. A keyframe is a small square diamond on its row's centre line.

## Components

- **Outline scene:** address in bold tabular figures (2.03), then title; the current scene sits on a yellow band.
- **Timeline cast row:** name at left, one straight line through the vertical centre in the row's colour from its first to its last keyframe over a faint full-width hairline, one small diamond per version (filled when the agent wrote it).
- **Buttons:** ink outline on paper; the primary is solid ink. Active toggles are yellow.
- **Notices:** boxed in ink; errors in red. No coloured side stripes.

## Do's and Don'ts

- Do keep yellow for "where you are" and red for "wrong"; nothing else.
- Do keep the dock linear, rows thin, lines straight and level with the row's name.
- Do give every scene its chapter.scene address wherever scenes are listed.
- Don't add shadows, gradients, rounded cards, or a warm accent colour.
- Don't set UI text in the reading serif; don't set prose in the UI sans.
- Don't mark cards with coloured side stripes.
- The earlier warm design remains available as the "Classic" look (command bar: Toggle look); don't delete it without asking.
