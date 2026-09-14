import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button.js';

/**
 * The markup the shared Button writes.
 *
 * What it is painted as is asked on a page, where a
 * stylesheet exists; this is the other half — the
 * hooks every spec and journey finds it by, the
 * name a glyph-only control is given, and the one
 * span a label lands in. Both halves have to hold
 * for a `[data-use]` in a spec to keep meaning what
 * it meant before the view handed its markup over.
 *
 * Called rather than written as a tag, because this
 * tier runs no JSX. The two-letter words are this
 * spec's own, standing in for a view's: nothing
 * under this directory is in any language.
 */
describe('the Button every surface presses', () => {
  it('writes its label as its one span', () => {
    const drawn = renderToStaticMarkup(
      Button({ variant: 'quiet', ink: 'brand', children: 'ab' }),
    );

    expect(drawn).toContain('class="btn"');
    expect(drawn).toContain('data-variant="quiet"');
    expect(drawn).toContain('data-ink="brand"');
    expect(drawn).toContain('data-size="sm"');
    expect(drawn).toContain('<span>ab</span>');
    expect(drawn.match(/<span/g)).toHaveLength(1);
  });

  it('carries through the hooks a view finds it by', () => {
    const drawn = renderToStaticMarkup(
      Button({
        variant: 'quiet',
        children: 'ab',
        hook: { 'quick-add-kind': 'step' },
        hookClass: 'template-use',
      }),
    );

    expect(drawn).toContain('data-quick-add-kind="step"');
    expect(drawn).toContain('class="btn template-use"');
  });

  /**
   * A glyph says nothing to a screen reader and
   * nothing to somebody who has not seen it before,
   * so the name travels both ways: as the accessible
   * name, and as the tooltip a pointer finds.
   */
  it('names a Button drawn as a glyph, twice', () => {
    const drawn = renderToStaticMarkup(
      Button({ variant: 'quiet', icon: 'refresh', label: 'ab' }),
    );

    expect(drawn).toContain('aria-label="ab"');
    expect(drawn).toContain('title="ab"');
    expect(drawn).toContain('aria-hidden="true"');
    expect(drawn).toContain('<path');
    expect(drawn).not.toContain('<span');
  });

  it('marks a Button whose label is machine evidence', () => {
    expect(
      renderToStaticMarkup(
        Button({ variant: 'quiet', mono: true, children: 'ab' }),
      ),
    ).toContain('data-mono=""');

    expect(
      renderToStaticMarkup(Button({ variant: 'quiet', children: 'ab' })),
    ).not.toContain('data-mono');
  });

  it('says a Button is working without taking its words away', () => {
    const drawn = renderToStaticMarkup(
      Button({ variant: 'primary', busy: true, children: 'ab' }),
    );

    expect(drawn).toContain('aria-busy="true"');
    expect(drawn).toContain('<span>ab</span>');
  });
});
