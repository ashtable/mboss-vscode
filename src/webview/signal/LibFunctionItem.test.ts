import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LibFunctionItem } from './LibFunctionItem.js';

/**
 * The markup the shared function row writes.
 *
 * What it is painted as is asked on a page, where a
 * stylesheet exists; this is the other half — what
 * the row says about a function, and which element
 * it is. One list is dragged onto blocks and the
 * other is pressed, and a row that is a `div` where
 * it should be a `button` is a control a keyboard
 * cannot reach.
 *
 * Called rather than written as a tag, because this
 * tier runs no JSX. The two-letter words are this
 * spec's own, standing in for a view's: nothing
 * under this directory is in any language.
 */
describe('the function row every list of code-behind is drawn as', () => {
  it('says what a function is called and what it takes', () => {
    const drawn = renderToStaticMarkup(
      LibFunctionItem({
        name: 'ab',
        signature: 'cd',
        state: 'compatible',
        as: 'div',
      }),
    );

    expect(drawn).toContain('class="lib-fn"');
    expect(drawn).toContain('data-state="compatible"');
    expect(drawn).toContain('>ab<');
    expect(drawn).toContain('>cd<');
    // Both are things a machine wrote, so both are
    // set in the face this system says that in.
    expect(drawn.match(/data-mono=""/g)).toHaveLength(2);
  });

  /**
   * Why this one cannot sit behind the block that is
   * selected, said under it as a hint rather than as
   * a line of its own — and keeping the class the
   * end-to-end journeys read it by.
   */
  it('says under the name why a function cannot go there', () => {
    const drawn = renderToStaticMarkup(
      LibFunctionItem({
        name: 'ab',
        signature: 'cd',
        state: 'compatible',
        note: 'ef',
        as: 'div',
      }),
    );

    expect(drawn).toContain('class="field-hint lib-note"');
    expect(drawn).toContain('>ef<');
  });

  /**
   * A slot with nothing in it yet is only its own
   * words: a signature or a reason under it would be
   * about a function that is not there.
   */
  it('says nothing about a slot with nothing in it', () => {
    const drawn = renderToStaticMarkup(
      LibFunctionItem({ name: 'ab', state: 'empty', as: 'div' }),
    );

    expect(drawn).toContain('data-state="empty"');
    expect(drawn).toContain('>ab<');
    expect(drawn).not.toContain('class="signature"');
    expect(drawn).not.toContain('lib-note');
  });

  /**
   * Pressed in one list and dragged in the other, so
   * the element follows the gesture: a row that is
   * pressed is a button, which a keyboard reaches
   * and a screen reader announces as one.
   */
  it('is the element the gesture on it needs', () => {
    const pressed = renderToStaticMarkup(
      LibFunctionItem({
        name: 'ab',
        state: 'assigned',
        as: 'button',
        onClick: () => {},
      }),
    );

    expect(pressed).toContain('<button');
    expect(pressed).toContain('type="button"');

    const dragged = renderToStaticMarkup(
      LibFunctionItem({
        name: 'ab',
        state: 'compatible',
        as: 'div',
        drag: { onStart: () => {}, onEnd: () => {} },
      }),
    );

    expect(dragged).toContain('<div');
    expect(dragged).toContain('draggable="true"');
  });

  it('carries through the hooks a view finds it by', () => {
    const drawn = renderToStaticMarkup(
      LibFunctionItem({
        name: 'ab',
        state: 'compatible',
        as: 'div',
        title: 'cd',
        hook: { 'lib-fn': 'ab' },
      }),
    );

    expect(drawn).toContain('data-lib-fn="ab"');
    expect(drawn).toContain('title="cd"');
  });
});
