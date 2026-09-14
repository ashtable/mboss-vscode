import type { KeyboardEvent, ReactNode } from 'react';

import { hooked } from './hook.js';

/**
 * The strip that switches which view of one thing is
 * on screen, and the panel it switches.
 *
 * A strip is a relationship rather than a row of
 * buttons: each tab names the panel it opens, the
 * panel names the tab that opened it, and somebody
 * who cannot see either still knows which of the
 * views they are in. Written once so that the five
 * strips in this extension are one thing to learn
 * and one thing to fix.
 *
 * Every word it draws arrives as a prop. Nothing
 * here is in any language, because this is drawn on
 * several surfaces in whatever language the editor
 * is running in.
 */

export type TabItem<Id extends string = string> = {
  id: Id;
  label: string;

  /** How many things are behind it. */
  count?: number;

  /** Refuses a pick, and stays where it is: a tab
   *  taken out of the strip is one nobody can find
   *  out about. */
  disabled?: boolean;

  /** The id of the hint that says why it refuses. */
  describedBy?: string;

  hook?: Record<string, string>;
};

/** The ids are a union wherever a view has one, so
 *  what comes back from a pick is the view's own
 *  type rather than a string it has to narrow. */
export function Tabs<Id extends string>({
  items,
  active,
  onPick,
  label,
  panel,
  controlsAll,
}: {
  items: readonly TabItem<Id>[];

  active: Id;

  onPick: (id: Id) => void;

  /** What the strip is a set of views of. */
  label: string;

  /** The id of the panel the tabs open. Each tab is
   *  named after it, so the pair can point at each
   *  other. */
  panel: string;

  /** Every tab points at the panel, not only the
   *  selected one: the strip whose tabs all filter
   *  one list drives something that is always
   *  there. */
  controlsAll?: boolean;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={walk}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="tab"
          role="tab"
          id={`${panel}-${item.id}`}
          aria-selected={item.id === active}
          aria-controls={
            controlsAll === true || item.id === active ? panel : undefined
          }
          aria-disabled={item.disabled === true ? true : undefined}
          aria-describedby={item.describedBy}
          tabIndex={item.id === active ? 0 : -1}
          onClick={() => {
            if (item.disabled === true) return;

            onPick(item.id);
          }}
          {...hooked(item.hook)}
        >
          {item.label}
          {item.count === undefined ? null : (
            <span className="tab-count">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Where an arrow key takes the focus.
 *
 * The whole strip is one tab stop and the arrows
 * walk inside it, so Tab moves past a set of views
 * rather than through every one of them. Picking is
 * left to Enter and Space: a pick repaints the
 * panel, and a strip that picked under an arrow key
 * would redraw everything on the way past it.
 *
 * A tab that refuses a pick is walked past like any
 * other, because somebody who cannot see the strip
 * has no other way to learn the view is there.
 */
function walk(event: KeyboardEvent<HTMLDivElement>): void {
  const tabs = [
    ...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
  ];
  const from = tabs.findIndex((tab) => tab === document.activeElement);
  if (from === -1) return;

  const to = along(event.key, from, tabs.length);
  if (to === undefined) return;

  // Otherwise Home and End take the panel with them.
  event.preventDefault();
  tabs[to]?.focus();
}

/** Which tab a key lands on. Both ends join up, so
 *  the strip has no dead end to back out of. */
function along(key: string, from: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowLeft':
      return (from - 1 + count) % count;
    case 'ArrowRight':
      return (from + 1) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

export function TabPanel({
  panel,
  active,
  focusStop,
  children,
  hook,
}: {
  panel: string;

  active: string;

  /** A panel holding nothing anybody can focus is
   *  somewhere a keyboard cannot reach, so it
   *  becomes a stop of its own. */
  focusStop?: boolean;

  children: ReactNode;

  hook?: Record<string, string>;
}) {
  return (
    <div
      className="tabpanel"
      role="tabpanel"
      id={panel}
      aria-labelledby={`${panel}-${active}`}
      tabIndex={focusStop === true ? 0 : undefined}
      {...hooked(hook)}
    >
      {children}
    </div>
  );
}
