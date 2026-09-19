import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FieldHint } from './FieldHint.js';

/**
 * The markup the shared hint writes.
 *
 * What it is painted as is asked on a page, where a
 * stylesheet exists; this is the other half — the
 * mark that says its words are machine evidence, and
 * the id a control names to have them read out with
 * it. A hint nothing points at is a sentence a
 * screen reader never reaches.
 *
 * Called rather than written as a tag, because this
 * tier runs no JSX. The two-letter words are this
 * spec's own, standing in for a view's: nothing
 * under this directory is in any language.
 */
describe('the hint under a control', () => {
  it('marks what it says as machine evidence', () => {
    const drawn = renderToStaticMarkup(FieldHint({ children: 'ab' }));

    expect(drawn).toContain('class="field-hint"');
    expect(drawn).toContain('data-mono=""');
    expect(drawn).toContain('>ab<');
  });

  /** What a control names to have the hint read out
   *  with it. */
  it('takes the id a control describes itself by', () => {
    expect(
      renderToStaticMarkup(FieldHint({ children: 'ab', id: 'cd' })),
    ).toContain('id="cd"');
  });

  it('carries the tone a hint about a failure is set in', () => {
    expect(
      renderToStaticMarkup(FieldHint({ children: 'ab', tone: 'fail' })),
    ).toContain('data-tone="fail"');

    expect(renderToStaticMarkup(FieldHint({ children: 'ab' }))).not.toContain(
      'data-tone',
    );
  });

  /** Where the hint is the whole of a line, what it
   *  says the line was read from belongs on it
   *  rather than on a span wrapped round it. */
  it('carries a title where one is given', () => {
    expect(
      renderToStaticMarkup(FieldHint({ children: 'ab', title: 'cd' })),
    ).toContain('title="cd"');

    expect(renderToStaticMarkup(FieldHint({ children: 'ab' }))).not.toContain(
      'title=',
    );
  });

  it('carries through the class and the hooks a view finds it by', () => {
    const drawn = renderToStaticMarkup(
      FieldHint({
        children: 'ab',
        hookClass: 'lib-note',
        hook: { 'drag-hint': '' },
      }),
    );

    expect(drawn).toContain('class="field-hint lib-note"');
    expect(drawn).toContain('data-drag-hint=""');
  });
});
