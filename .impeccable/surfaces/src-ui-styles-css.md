---
version: 1
slug: "src-ui-styles-css"
primary_target: "src/ui/styles.css"
related_targets: []
---

## Direction contract

THESIS: The editing suite is a timetable. The story is read as numbered departures (chapter.scene), the dock is a straight-line track per character and page, and everything else gets out of the way of the prose. It refuses the warm-cream, terracotta, rounded-card SaaS look and any decorative chrome.

OWN-WORLD: Paper-white ground (#fbfaf5), near-black ink (#16181c), Fahrplan yellow (#ffd100) only for "where you are" (current scene, playhead), one signal red (#d52b1e) only for contradictions and warnings. Helvetica/Arial for all UI, tabular figures for scene addresses (2.03), hairline 1-2px ink rules, square corners, no shadows. Prose stays in a warm serif. Dark theme inverts to ink ground with the same yellow and red.

STORY: The writer sees where they are in the story the way a traveller sees a departure board: an address, a line, a now. Time is a place; the dock is straight and linear like an editing timeline, with thin coloured lines through the middle of each track aligned to the track's name and a diamond per version. No diagonals, no branching.

FIRST VIEWPORT: Left outline of numbered scenes (2.01...) with the current one on a yellow band; centre the scene prose in serif at a reading measure; right inspector with the agent report and Check / Next; bottom dock of thin horizontal tracks, each with its name at left, one coloured centre line, diamonds at versions, and a yellow playhead.

FORM: The Timetable (Swiss railway timetables, Marey graph), position 4 on the ordered list, assigned by the roll; seed: seed:70c32c9a65ec57f1. Raises: scene address from the Boarding pass, one strict module from the Grid specimen. User steer: keep the dock's linearity (no up/down diagonals), thinner lines, coloured centre line aligned with the track name. Old look stays as a "Classic" look setting.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
