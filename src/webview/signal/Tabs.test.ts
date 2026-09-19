import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TabPanel, Tabs, type TabItem } from './Tabs.js';

/**
 * The markup the shared tab strip writes.
 *
 * What it is painted as is asked on a page, where a
 * stylesheet exists; this is the other half — the
 * ids that join a tab to the panel it opens, and
 * what a tab that refuses a pick says about itself.
 * A strip whose `aria-controls` points at nothing
 * looks right and tells a screen reader nothing.
 *
 * Called rather than written as a tag, because this
 * tier runs no JSX. The two-letter words are this
 * spec's own, standing in for a view's: nothing
 * under this directory is in any language.
 */

const VIEWS: readonly TabItem[] = [
  { id: 'ab', label: 'Ab' },
  { id: 'cd', label: 'Cd' },
];

function strip(over: Partial<Parameters<typeof Tabs>[0]> = {}) {
  return Tabs({
    items: VIEWS,
    active: 'ab',
    onPick: () => {},
    label: 'ef',
    panel: 'gh',
    ...over,
  });
}

/**
 * The tabs inside the strip, as the elements they
 * are.
 *
 * A pick is a handler rather than an attribute, so
 * there is nothing in the rendered string to read
 * it off. This tier has no page to click on, so the
 * handler is called where it was written.
 */
function tabsOf(
  drawn: ReactElement,
): readonly ReactElement<{ onClick: () => void }>[] {
  const { children } = drawn.props as {
    children: readonly ReactElement<{ onClick: () => void }>[];
  };

  return children;
}

describe('the tab strip every panel is switched with', () => {
  it('names every tab after the panel it opens', () => {
    const drawn = renderToStaticMarkup(strip());

    expect(drawn).toContain('role="tablist"');
    expect(drawn).toContain('aria-label="ef"');
    expect(drawn).toContain('id="gh-ab"');
    expect(drawn).toContain('id="gh-cd"');
  });

  /**
   * One panel is mounted, so one tab points at it.
   * The exception is a strip whose tabs all drive
   * the same list, where every one of them does.
   */
  it('points only the selected tab at the panel', () => {
    expect(
      renderToStaticMarkup(strip()).match(/aria-controls="gh"/g),
    ).toHaveLength(1);

    expect(
      renderToStaticMarkup(strip({ controlsAll: true })).match(
        /aria-controls="gh"/g,
      ),
    ).toHaveLength(2);
  });

  /** The panel says which tab opened it, so
   *  somebody landing in it knows what they are
   *  reading. */
  it('labels the panel with the tab that is selected', () => {
    const drawn = renderToStaticMarkup(
      TabPanel({ panel: 'gh', active: 'cd', children: undefined }),
    );

    expect(drawn).toContain('role="tabpanel"');
    expect(drawn).toContain('id="gh"');
    expect(drawn).toContain('aria-labelledby="gh-cd"');
    expect(drawn).not.toContain('tabindex');
  });

  /** A panel holding nothing anybody can focus is
   *  somewhere a keyboard cannot reach, so it
   *  becomes a stop of its own. */
  it('gives a panel nothing can be focused in a stop of its own', () => {
    const drawn = renderToStaticMarkup(
      TabPanel({
        panel: 'gh',
        active: 'ab',
        focusStop: true,
        children: undefined,
      }),
    );

    expect(drawn).toContain('tabindex="0"');
  });

  /**
   * One tab stop for the strip, on the tab that is
   * selected: Tab moves past the strip rather than
   * through it, and the arrows are what walk it.
   */
  it('keeps one tab stop, on the tab that is selected', () => {
    const drawn = renderToStaticMarkup(strip());

    expect(drawn.match(/tabindex="0"/g)).toHaveLength(1);
    expect(drawn.match(/tabindex="-1"/g)).toHaveLength(1);
  });

  /**
   * Refused rather than removed: a tab taken out of
   * the strip is one nobody can find out about, so
   * it stays where it was, says it is not available
   * and says why.
   */
  it('keeps a tab that refuses a pick in the strip, with its reason', () => {
    const items: TabItem[] = [
      VIEWS[0] as TabItem,
      { id: 'cd', label: 'Cd', disabled: true, describedBy: 'ij' },
    ];
    const drawn = renderToStaticMarkup(strip({ items }));

    expect(drawn).toContain('aria-disabled="true"');
    expect(drawn).toContain('aria-describedby="ij"');
    expect(drawn).toContain('id="gh-cd"');
    // Not the native attribute, which would take it
    // out of the arrow order as well as out of use.
    expect(drawn).not.toContain('disabled=""');
  });

  it('says nothing back when a refusing tab is picked', () => {
    const picked: string[] = [];
    const items: TabItem[] = [
      VIEWS[0] as TabItem,
      { id: 'cd', label: 'Cd', disabled: true },
    ];

    for (const tab of tabsOf(
      strip({ items, onPick: (id) => picked.push(id) }),
    )) {
      tab.props.onClick();
    }

    expect(picked).toEqual(['ab']);
  });

  it('counts what is behind a tab', () => {
    const items: TabItem[] = [
      { id: 'ab', label: 'Ab', count: 7 },
      VIEWS[1] as TabItem,
    ];

    expect(renderToStaticMarkup(strip({ items }))).toMatch(
      /<span class="tab-count"[^>]*>7<\/span>/,
    );
  });

  it('counts in the machine face by its hook', () => {
    const items: TabItem[] = [{ id: 'ab', label: 'Ab', count: 3 }];

    expect(renderToStaticMarkup(strip({ items }))).toContain(
      '<span class="tab-count" data-mono="">3</span>',
    );
  });

  it('carries through the hooks a view finds it by', () => {
    const items: TabItem[] = [
      { id: 'ab', label: 'Ab', hook: { 'view-toggle': 'ab' } },
      VIEWS[1] as TabItem,
    ];
    const drawn = renderToStaticMarkup(strip({ items }));

    expect(drawn).toContain('data-view-toggle="ab"');
    expect(
      renderToStaticMarkup(
        TabPanel({
          panel: 'gh',
          active: 'ab',
          hook: { pane: '' },
          children: undefined,
        }),
      ),
    ).toContain('data-pane=""');
  });
});
