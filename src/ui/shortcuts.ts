// Every keyboard shortcut the app documents, in one place for the cheat sheet (press ? or use the palette).

export interface Shortcut {
  keys: string[];
  what: string;
}

export interface ShortcutGroup {
  title: string;
  rows: Shortcut[];
}

export const TIMELINE_SHORTCUTS: Shortcut[] = [
  { keys: ['←', '→'], what: 'Move the playhead one column (Shift: five)' },
  { keys: ['Home', 'End'], what: 'Playhead to the start or the end' },
  { keys: ['['], what: 'Previous chapter start' },
  { keys: [']'], what: 'Next chapter start' },
  { keys: [','], what: 'Previous scene start' },
  { keys: ['.'], what: 'Next scene start' },
  { keys: ['Ctrl', 'wheel'], what: 'Zoom around the cursor' },
  { keys: ['Alt', 'wheel'], what: 'Zoom around the playhead (the centre if it is off screen)' },
  { keys: ['=', '-'], what: 'Zoom in or out around the playhead' },
  { keys: ['0'], what: 'Fit the whole work' },
  { keys: ['1'], what: 'Scene size: one scene comfortably wide' },
  { keys: ['Alt', '[ ]'], what: 'Back and forward through the views you jumped between' },
  { keys: ['Z'], what: 'Frame the chapter under the playhead (Shift: its arc)' },
  { keys: ['drag'], what: 'Overview: drag a window edge to zoom, the window to scroll' },
  { keys: ['click'], what: 'Overview: centre the view on that point' },
  { keys: ['double-click'], what: 'Overview: fit the whole work. On a chapter or arc band: frame it' },
];

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    rows: [
      { keys: ['Ctrl', 'K'], what: 'Command palette: jump to anything, run commands' },
      { keys: ['?'], what: 'This cheat sheet' },
      { keys: ['Ctrl', 'Z'], what: 'Undo (Ctrl+Shift+Z or Ctrl+Y: redo)' },
      { keys: ['Ctrl', 'W'], what: 'Close the current tab (palette: Reopen closed tab)' },
      { keys: ['Ctrl', 'B'], what: 'Show or hide the side panel (in the editor it is bold)' },
      { keys: ['Ctrl', 'Alt', 'B'], what: 'Show or hide the quick panel' },
      { keys: ['Ctrl', 'J'], what: 'Show or hide the timeline' },
      { keys: ['Ctrl', 'Shift', 'Space'], what: 'Quick capture: file an idea in the Inbox without leaving the page' },
      { keys: ['Ctrl', 'Shift', 'F'], what: 'Focus writing: hide panels and timeline (Esc to leave)' },
    ],
  },
  {
    title: 'Command palette',
    rows: [
      { keys: ['/'], what: 'Search all text' },
      { keys: ['>'], what: 'Commands only' },
      { keys: ['@'], what: 'Entities only' },
      { keys: ['#'], what: 'Scenes only' },
    ],
  },
  {
    title: 'Writing',
    rows: [
      { keys: ['Ctrl', 'B'], what: 'Bold' },
      { keys: ['Ctrl', 'I'], what: 'Italic' },
      { keys: ['Ctrl', 'Shift', 'X'], what: 'Strikethrough' },
      { keys: ['Ctrl', 'E'], what: 'Inline code' },
      { keys: ['Ctrl', '/'], what: 'Author note: wrap the selection, or add one at the end of the line' },
      { keys: ['Ctrl', 'Shift', '/'], what: 'Show or collapse author notes' },
    ],
  },
  { title: 'Timeline (click it first)', rows: TIMELINE_SHORTCUTS },
];
