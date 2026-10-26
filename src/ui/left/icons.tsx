// Line icons for the activity bar: 24-unit grid drawn at 20px, stroked with currentColor.

import type { ReactNode } from 'react';

/** The icons an entity type can use, by the generic word stored in `EntityType.icon`. */
export const TYPE_ICON_NAMES = ['user', 'users', 'flag', 'map', 'box', 'paw', 'leaf', 'spark', 'scroll', 'bolt', 'bulb', 'link', 'circle'] as const;
export type TypeIconName = (typeof TYPE_ICON_NAMES)[number];

export type IconName = 'book' | 'library' | 'plus' | 'search' | 'pencil' | 'hash' | 'sliders' | TypeIconName;

const ICONS: Record<IconName, ReactNode> = {
  book: (
    <>
      <path d="M12 6.6C10.3 5.3 7.9 4.7 4 4.9v13.2c3.9-.2 6.3.4 8 1.7 1.7-1.3 4.1-1.9 8-1.7V4.9c-3.9-.2-6.3.4-8 1.7z" />
      <path d="M12 6.6v13.2" />
    </>
  ),
  library: (
    <>
      <path d="M4.5 4.5h3.5v15H4.5z" />
      <path d="M9.5 4.5H13v15H9.5z" />
      <path d="M15 5.6l3.3-.9 3.2 14.2-3.3.9z" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c0-3.9 3.1-6.4 7-6.4s7 2.5 7 6.4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" />
      <path d="M15.6 14.2c3-.2 5.4 1.4 5.4 4.3" />
    </>
  ),
  flag: (
    <>
      <path d="M6 21V4" />
      <path d="M6 5c3-1.6 5 1.6 8 0 1.7-.9 4-.4 4-.4v8s-2.3-.5-4 .4c-3 1.6-5-1.6-8 0" />
    </>
  ),
  map: (
    <>
      <path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  box: (
    <>
      <path d="M12 3l8 4v10l-8 4-8-4V7z" />
      <path d="M4 7l8 4 8-4" />
      <path d="M12 11v10" />
    </>
  ),
  paw: (
    <>
      <circle cx="6.8" cy="10.5" r="1.7" />
      <circle cx="10.4" cy="6.4" r="1.7" />
      <circle cx="14.6" cy="6.4" r="1.7" />
      <circle cx="18.2" cy="10.5" r="1.7" />
      <path d="M12.5 12c-3 0-5.5 3.1-5.5 5.2 0 1.7 1.4 2.3 2.7 2 .9-.2 1.8-.6 2.8-.6s1.9.4 2.8.6c1.3.3 2.7-.3 2.7-2 0-2.1-2.5-5.2-5.5-5.2z" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19C5 10.5 10 5.5 19 5c0 9-4.5 14-12 14" />
      <path d="M5 19c3-3.2 6-5.2 9-6.6" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5l1.9 5.4 5.4 1.9-5.4 1.9L12 18.1l-1.9-5.4-5.4-1.9 5.4-1.9z" />
      <path d="M18.5 16.5v3.5" />
      <path d="M16.8 18.2h3.5" />
    </>
  ),
  scroll: (
    <>
      <path d="M7 3.5h8l4 4v13H7z" />
      <path d="M15 3.5v4h4" />
      <path d="M10 12h6" />
      <path d="M10 16h6" />
    </>
  ),
  bolt: <path d="M13 3L5.5 13H11l-1 8L18.5 11H13z" />,
  bulb: (
    <>
      <path d="M9.5 18.5h5" />
      <path d="M10.5 21h3" />
      <path d="M12 3a6 6 0 0 0-3.4 10.9c.6.5 1 1.2 1 2.1h4.8c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="6.5" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20" />
    </>
  ),
  pencil: (
    <>
      <path d="M4.5 19.5L5 16 15.5 5.5a2.1 2.1 0 0 1 3 3L8 19z" />
      <path d="M13.5 7.5l3 3" />
    </>
  ),
  hash: (
    <>
      <path d="M9.5 4L7.5 20" />
      <path d="M16.5 4l-2 16" />
      <path d="M4.5 9h16" />
      <path d="M3.5 15h16" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9" />
      <path d="M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 17h3" />
      <path d="M11 17h9" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
};

export function ActIcon({ name }: { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

/**
 * An entity type's icon: its drawing when the stored word is one we have, otherwise the type's first letter, so a
 * custom type is still told apart at a glance. Takes the type's colour.
 */
export function TypeIcon({ icon, name, color }: { icon: string; name: string; color?: string }) {
  const known = (TYPE_ICON_NAMES as readonly string[]).includes(icon);
  return (
    <span className="type-glyph" style={color ? { color } : undefined} aria-hidden="true">
      {known ? <ActIcon name={icon as TypeIconName} /> : <span className="type-glyph-letter">{(name.trim()[0] ?? '?').toUpperCase()}</span>}
    </span>
  );
}
