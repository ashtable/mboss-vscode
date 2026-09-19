import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SectionLabel } from './SectionLabel.js';

/**
 * The markup the label over a group writes.
 *
 * Called rather than written as a tag, because this
 * tier runs no JSX. The two-letter words are this
 * spec's own: nothing under this directory is in
 * any language.
 */
describe('the label over a group', () => {
  it('is a paragraph unless a heading level is asked for', () => {
    expect(renderToStaticMarkup(SectionLabel({ children: 'ab' }))).toBe(
      '<p class="section-label">ab</p>',
    );
    expect(
      renderToStaticMarkup(SectionLabel({ children: 'ab', level: 3 })),
    ).toContain('<h3 class="section-label">');
  });

  /** A group of controls is named by its label, and
   *  names it by id. */
  it('takes the id a group is named by', () => {
    expect(
      renderToStaticMarkup(SectionLabel({ children: 'ab', id: 'cd' })),
    ).toContain('id="cd"');
  });
});
