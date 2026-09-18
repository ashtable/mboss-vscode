import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { placed } from './placed.js';

/**
 * A translated sentence with controls in it.
 *
 * Two views draw a run's lineage as a sentence whose
 * ids are Buttons, and the language decides where
 * each id goes: the template is split at its places
 * and each place gets the thing drawn for it. The
 * two-letter words are this spec's own, standing in
 * for a view's.
 */
describe('a phrase with things drawn in its places', () => {
  const drawn = (parts: ReactNode[]): string =>
    renderToStaticMarkup(createElement(Fragment, null, ...parts));

  it('puts each part where the template places it', () => {
    expect(
      drawn(placed('└ {0} → {1}', createElement('b', null, 'x'), 'y')),
    ).toBe('└ <b>x</b> → y');
  });

  /** A language that says the second thing first. */
  it('draws the parts in the template’s order', () => {
    expect(
      drawn(placed('{1} ab {0}', 'x', createElement('i', null, 'y'))),
    ).toBe('<i>y</i> ab x');
  });

  it('draws a template with no place as itself', () => {
    expect(drawn(placed('ab cd', 'x'))).toBe('ab cd');
  });
});
