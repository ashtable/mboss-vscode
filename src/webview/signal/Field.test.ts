import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Input, Select, TextArea } from './Field.js';

/**
 * The markup the three shared fields write.
 *
 * What they are painted as, and what they do with
 * a key, is asked on a page, where a stylesheet and
 * a keyboard exist; this is the other half — the
 * native control each one is, the name a field no
 * label points at is given, and the marks the sheet
 * draws a field by.
 *
 * Rendered through `createElement` rather than
 * called, because each field holds what has been
 * typed, and state is React's to keep only inside a
 * render. The two-letter words are this spec's own,
 * standing in for a view's: nothing under this
 * directory is in any language.
 */

function drawn<P extends object>(
  component: FunctionComponent<P>,
  props: P,
): string {
  return renderToStaticMarkup(createElement(component, props));
}

const nothing = () => undefined;

describe('the field a line is typed into', () => {
  it('is a native text box', () => {
    const markup = drawn(Input, { value: 'ab', onCommit: nothing });

    expect(markup).toMatch(/^<input type="text" class="field-input"/);
    expect(markup).toContain('value="ab"');
  });

  /** A field no row's label points at still needs a
   *  name, and takes it as its own. */
  it('names itself by its label with no label element', () => {
    const markup = drawn(Input, {
      value: '',
      label: 'ab',
      onCommit: nothing,
    });

    expect(markup).toContain('aria-label="ab"');
    expect(markup).not.toContain('<label');
    expect(markup).not.toContain('title=');
  });

  it('carries the id a label names and what describes it', () => {
    const markup = drawn(Input, {
      value: '',
      id: 'ab',
      describedBy: 'cd ef',
      placeholder: 'gh',
      mono: true,
      hook: { 'inspector-heading': '' },
      onCommit: nothing,
    });

    expect(markup).toContain('id="ab"');
    expect(markup).toContain('aria-describedby="cd ef"');
    expect(markup).toContain('placeholder="gh"');
    expect(markup).toContain('data-mono=""');
    expect(markup).toContain('data-inspector-heading=""');
  });

  /** Somewhere a value is shown but may not be set,
   *  the box still reads out and can be copied from,
   *  and the browser refuses the typing itself. */
  it('can be read and not typed into', () => {
    const markup = drawn(Input, {
      value: 'ab',
      readOnly: true,
      onCommit: nothing,
    });

    expect(markup).toContain('readOnly=""');
    expect(drawn(Input, { value: 'ab', onCommit: nothing })).not.toContain(
      'readOnly',
    );
  });
});

describe('the field one of a few is picked in', () => {
  it('is a native menu with a mark nobody reads out', () => {
    const markup = drawn(Select, {
      value: 'cd',
      options: [
        { value: 'ab', label: 'AB' },
        { value: 'cd', label: 'CD' },
      ],
      onChange: nothing,
    });

    expect(markup).toMatch(
      /^<span class="field-select"><select class="field-input"/,
    );
    expect(markup).toContain('<option value="ab">AB</option>');
    expect(markup).toMatch(/<option value="cd" selected="">CD<\/option>/);
    expect(markup).toMatch(/<\/select><svg[^>]* aria-hidden="true"/);
  });

  it('names itself by its label with no label element', () => {
    const markup = drawn(Select, {
      value: 'ab',
      label: 'ef',
      options: [{ value: 'ab', label: 'AB' }],
      onChange: nothing,
    });

    expect(markup).toContain('aria-label="ef"');
    expect(markup).not.toContain('<label');
  });

  /** A native menu has no read-only state, so one
   *  that may not be changed is switched off. */
  it('can be switched off', () => {
    const markup = drawn(Select, {
      value: 'ab',
      disabled: true,
      options: [{ value: 'ab', label: 'AB' }],
      onChange: nothing,
    });

    expect(markup).toMatch(/<select[^>]* disabled=""/);
  });
});

describe('the field several lines are typed into', () => {
  it('is a native text area that grows only when asked', () => {
    const still = drawn(TextArea, { value: 'ab', onCommit: nothing });

    expect(still).toMatch(/^<textarea class="field-input"/);
    expect(still).toContain('>ab</textarea>');
    expect(still).not.toContain('data-grow');

    const growing = drawn(TextArea, {
      value: 'ab',
      grow: { minLines: 3, maxLines: 12 },
      onCommit: nothing,
    });

    expect(growing).toContain('data-grow=""');
    expect(growing).toContain('--min-lines:3');
    expect(growing).toContain('--max-lines:12');
  });

  it('can be read and not typed into', () => {
    expect(
      drawn(TextArea, { value: 'ab', readOnly: true, onCommit: nothing }),
    ).toMatch(/^<textarea[^>]* readOnly=""/);
  });
});
