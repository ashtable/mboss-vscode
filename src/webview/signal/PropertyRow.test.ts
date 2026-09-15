import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  PropertyRow,
  type Named,
  type PropertyRowProps,
} from './PropertyRow.js';

/**
 * The markup the shared property row writes.
 *
 * What it is painted as is asked on a page, where a
 * stylesheet exists; this is the other half — which
 * element names the control, which one holds the
 * value, and the ids that tie a unit and a note to
 * the control they are about. A label a control
 * does not point at is a word a screen reader never
 * says with it.
 *
 * Rendered through `createElement` rather than
 * called, because the ids are React's to mint and
 * it mints them only inside a render. The two-letter
 * words are this spec's own, standing in for a
 * view's: nothing under this directory is in any
 * language.
 */

function drawn(props: PropertyRowProps): string {
  return renderToStaticMarkup(createElement(PropertyRow, props));
}

/** A bare control, so the row is read on its own
 *  rather than through a field that names itself. */
function box(named: Named) {
  return createElement('input', {
    id: named.id,
    'aria-describedby': named.describedBy,
  });
}

/** The value of one attribute on the first element
 *  that carries it. */
function attribute(markup: string, name: string): string | undefined {
  return markup.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

describe('the row a property is set out in', () => {
  it('puts the label before the value', () => {
    const markup = drawn({ label: 'ab', value: 'cd' });

    const label = markup.indexOf('class="property-label"');
    const value = markup.indexOf('class="value"');

    expect(label).toBeGreaterThan(-1);
    expect(value).toBeGreaterThan(label);
    expect(markup).toContain('data-property=""');
    expect(markup).toContain('>cd</div>');
  });

  it('draws a read-only value with no label element', () => {
    const markup = drawn({ label: 'ab', value: 'cd', mono: true });

    expect(markup).not.toContain('<label');
    expect(markup).toMatch(/<div class="value" data-mono="">cd<\/div>/);
  });

  /** One control: its lens id on the row, and the
   *  row's label pointing at it. */
  it('names one control by its lens id', () => {
    const markup = drawn({ label: 'ab', field: 'cd', control: box });

    expect(markup).toContain('data-field="cd"');
    expect(markup).toMatch(/<label class="property-label" for="[^"]+">ab/);

    const named = markup.match(/<label[^>]* for="([^"]+)"/)?.[1];
    const control = markup.match(/<input[^>]* id="([^"]+)"/)?.[1];

    expect(named).toBeDefined();
    expect(control).toBe(named);
  });

  /**
   * Two controls read as one property — a count and
   * the period it is counted over. The row is the
   * group and its label names the group; each control
   * sits in a wrapper of its own, so every lens id
   * still finds exactly one control.
   */
  it('groups a pair and names each half', () => {
    const markup = drawn({
      label: 'ab',
      controls: [
        { field: 'cd', control: box },
        { field: 'ef', control: box },
      ],
    });

    expect(markup).toContain('role="group"');
    expect(markup).not.toContain('<label');

    const labelledBy = attribute(markup, 'aria-labelledby');
    expect(labelledBy).toBeDefined();
    expect(markup).toContain(
      `<span class="property-label" id="${labelledBy}">ab</span>`,
    );

    expect(markup.match(/data-field="(cd|ef)"><input/g)).toHaveLength(2);
    expect(markup.match(/data-field=/g)).toHaveLength(2);
  });

  /**
   * A pair is read as the figure it is written as —
   * a count, a mark, a period — so a mark stands
   * between the halves. Each half is already named
   * for what it holds, so the mark is only drawn.
   */
  it('sets a mark between the halves of a pair, read out by nobody', () => {
    const markup = drawn({
      label: 'ab',
      controls: [
        { field: 'cd', control: box },
        { field: 'ef', control: box },
      ],
    });

    expect(markup).toMatch(
      new RegExp(
        'data-field="cd"><input[^>]*/></span>' +
          '<span class="property-joint" aria-hidden="true">/</span>' +
          '<span class="property-control" data-field="ef">',
      ),
    );
    expect(markup.match(/property-joint/g)).toHaveLength(1);
  });

  /**
   * A unit after a pair is what its second half is
   * counted in, and never the first's: a count of
   * items is not a number of seconds. So only the
   * half it follows is described by it, while a
   * note about the row is about both.
   */
  it('describes only the half a unit follows by that unit', () => {
    const halves = [
      { field: 'cd', control: box },
      { field: 'ef', control: box },
    ];
    const describedBy = (markup: string) =>
      [...markup.matchAll(/<input([^>]*)\/>/g)].map(([, attributes]) =>
        attribute(attributes!, 'aria-describedby'),
      );

    const bare = drawn({ label: 'ab', controls: halves, unit: 'gh' });
    const unit = attribute(bare.split('property-unit')[1]!, 'id');

    expect(unit).toBeDefined();
    expect(describedBy(bare)).toEqual([undefined, unit]);

    const noted = drawn({
      label: 'ab',
      controls: halves,
      unit: 'gh',
      note: 'ij',
    });
    const ids = {
      unit: attribute(noted.split('property-unit')[1]!, 'id'),
      note: attribute(noted.split('field-note')[1]!, 'id'),
    };

    expect(describedBy(noted)).toEqual([ids.note, `${ids.unit} ${ids.note}`]);
  });

  /**
   * A unit is part of what the value means and not
   * part of what is typed, so it is drawn beside the
   * control rather than inside it, hidden from a
   * screen reader as text of its own, and read out
   * as the control's description instead — as is a
   * note about that field.
   */
  it('draws a unit and a note outside the control and ties both to it', () => {
    const markup = drawn({
      label: 'ab',
      field: 'cd',
      control: box,
      unit: 'ef',
      note: 'gh',
    });

    const unit = markup.match(
      /<span class="property-unit" id="([^"]+)" aria-hidden="true">ef<\/span>/,
    )?.[1];
    const note = markup.match(
      new RegExp(
        '<span class="field-hint field-note" id="([^"]+)" ' +
          'data-mono="">gh</span>',
      ),
    )?.[1];

    expect(unit).toBeDefined();
    expect(note).toBeDefined();
    expect(attribute(markup, 'aria-describedby')).toBe(`${unit} ${note}`);

    // The note is the row's last child, after the
    // value rather than inside it.
    expect(markup.endsWith('gh</span></div>')).toBe(true);
    expect(markup.indexOf('field-note')).toBeGreaterThan(
      markup.indexOf('property-unit'),
    );
  });

  it('describes a control by nothing when there is nothing to say', () => {
    expect(drawn({ label: 'ab', field: 'cd', control: box })).not.toContain(
      'aria-describedby',
    );
  });

  it('marks a provenance word in its own span', () => {
    const markup = drawn({
      label: 'ab',
      value: 'cd',
      provenance: { kind: 'configured', word: 'ef' },
    });

    expect(markup).toContain(
      '<span class="property-provenance" data-provenance="configured">' +
        '· ef</span>',
    );
  });

  it('takes the room its labels need and the hooks a view finds it by', () => {
    const markup = drawn({
      label: 'ab',
      value: 'cd',
      labels: 'wide',
      hook: { outcome: 'ef' },
    });

    expect(markup).toContain('data-labels="wide"');
    expect(markup).toContain('data-outcome="ef"');
  });
});
