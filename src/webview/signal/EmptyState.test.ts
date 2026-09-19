import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState.js';

/**
 * The markup the shared empty state writes.
 *
 * What it is painted as is asked on a page, where a
 * stylesheet exists; this is the other half — the
 * two sentences kept in elements of their own, and
 * the one action a panel with nothing in it is
 * allowed to offer.
 *
 * Called rather than written as a tag, because this
 * tier runs no JSX. The two-letter words are this
 * spec's own, standing in for a view's: nothing
 * under this directory is in any language.
 */
describe('what a panel says instead of a list', () => {
  /**
   * A check that matched both at once would pass on
   * a panel that had lost one of them, so each is
   * read without the other.
   */
  it('keeps the title and the detail in elements of their own', () => {
    const drawn = renderToStaticMarkup(
      EmptyState({ kind: 'empty', title: 'ab', detail: 'cd' }),
    );

    expect(drawn).toContain('<p class="empty-title">ab</p>');
    expect(drawn).toContain('<p class="empty-detail">cd</p>');
  });

  it('says only what it was given', () => {
    const drawn = renderToStaticMarkup(
      EmptyState({ kind: 'empty', title: 'ab' }),
    );

    expect(drawn).toContain('<p class="empty-title">ab</p>');
    expect(drawn).not.toContain('empty-detail');
  });

  /**
   * The mark belongs to the panel that asked and was
   * refused. A cross over a list nobody has filled
   * in yet reads as a failure where there is none.
   */
  it('marks the panel that was refused, and only that one', () => {
    expect(
      renderToStaticMarkup(EmptyState({ kind: 'error', title: 'ab' })),
    ).toContain('class="empty-mark"');

    expect(
      renderToStaticMarkup(EmptyState({ kind: 'empty', title: 'ab' })),
    ).not.toContain('empty-mark');
  });

  /**
   * The way out is a real Button rather than
   * something dressed as one, so it keeps the focus
   * ring every other control on the page has.
   */
  it('offers its one way out as a Button in the product’s ink', () => {
    const drawn = renderToStaticMarkup(
      EmptyState({
        kind: 'error',
        title: 'ab',
        action: { label: 'cd', onClick: () => {}, hook: { refresh: '' } },
      }),
    );

    expect(drawn).toContain('class="btn"');
    expect(drawn).toContain('data-variant="quiet"');
    expect(drawn).toContain('data-ink="brand"');
    expect(drawn).toContain('data-refresh=""');
    expect(drawn).toContain('<span>cd</span>');
  });
});
