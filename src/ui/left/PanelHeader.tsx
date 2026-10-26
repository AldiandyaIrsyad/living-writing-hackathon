// Header row of a left panel: uppercase title, then small actions on the right.

import type { ReactNode } from 'react';

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="lp-head">
      <span className="lp-head-title">{title}</span>
      <span className="lp-grow" />
      {children}
    </div>
  );
}
