import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Callout } from './Callout.js';

/**
 * The markup the shared callout writes.
 *
 * What it is painted as is asked on a page, where a
 * stylesheet exists; this is the other half — the
 * title kept apart from what follows it, and the
 * tone and hooks a view hands it.
 *
 * Called rather than written as a tag, because this
 * tier runs no JSX. The two-letter words are this
 * spec's own, standing in for a view's: nothing
 * under this directory is in any language.
 */
describe('the block that says something a person must know', () => {
  /**
   * The title is what happened and the body is what
   * it means, so each is an element a spec can read
   * without the other, and the title comes first.
   */
  it('sets the title before the body, in elements of their own', () => {
    const drawn = renderToStaticMarkup(
      Callout({ tone: 'fail', title: 'ab', children: 'cd' }),
    );

    const title = drawn.indexOf('<p class="callout-title">ab</p>');
    const body = drawn.indexOf('<div class="callout-body">cd</div>');

    expect(title).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(title);
  });

  it('draws no body it was not given', () => {
    expect(
      renderToStaticMarkup(Callout({ tone: 'info', title: 'ab' })),
    ).not.toContain('callout-body');
  });

  it('takes its tone and the hooks a view finds it by', () => {
    for (const tone of ['fail', 'info', 'warn'] as const) {
      const drawn = renderToStaticMarkup(
        Callout({ tone, title: 'ab', hook: { failure: '' } }),
      );

      expect(drawn).toContain('class="callout"');
      expect(drawn).toContain(`data-tone="${tone}"`);
      expect(drawn).toContain('data-failure=""');
    }
  });
});
