import { describe, expect, it } from 'vitest';

import {
  apply,
  pickerAfter,
  section,
  visible,
  type InspectorField,
} from './lens.js';

/**
 * A header that groups the fields after it.
 *
 * Every other field stands for something the
 * document holds. This one stands for how somebody
 * is reading the form — which groups are open —
 * and the document has no business remembering
 * that. So it is a lens like the rest, read the
 * same way and written back into nothing.
 */
describe('a section header', () => {
  const subject = { name: 'orders' };

  it('reads the fold it opens with', () => {
    expect(section<typeof subject>('advanced', true).read(subject)).toEqual({
      id: 'advanced',
      control: 'section',
      collapsed: true,
    });
  });

  it('writes nothing back, not even its own field', () => {
    const lens = section<typeof subject>('advanced', true);

    expect(lens.write(subject, lens.read(subject))).toBe(subject);
  });

  it('leaves the subject alone when a whole form is applied', () => {
    const lens = section<typeof subject>('advanced', false);

    expect(apply(subject, [lens], [lens.read(subject)])).toEqual(subject);
  });
});

/**
 * What a fold hides.
 *
 * A header owns everything after it until the next
 * one, so a fold takes out a run of the list rather
 * than a set of ids somebody has to keep in step
 * with the form.
 */
describe('the fields a folded form draws', () => {
  const form: InspectorField[] = [
    { id: 'title', control: 'text', value: 'Orders' },
    { id: 'queue', control: 'section', collapsed: false },
    { id: 'queueName', control: 'text', value: 'orders' },
    { id: 'advanced', control: 'section', collapsed: true },
    { id: 'onConflict', control: 'text', value: '' },
  ];

  it('draws every field when nothing is folded', () => {
    expect(visible(form, new Set()).map((field) => field.id)).toEqual([
      'title',
      'queue',
      'queueName',
      'advanced',
      'onConflict',
    ]);
  });

  it('hides the fields under a folded header, and no others', () => {
    expect(
      visible(form, new Set(['advanced'])).map((field) => field.id),
    ).toEqual(['title', 'queue', 'queueName', 'advanced']);
  });

  /** Folding a group never takes away the way back
   *  into it. */
  it('keeps drawing a folded header itself', () => {
    expect(visible(form, new Set(['queue', 'advanced']))).toContainEqual({
      id: 'queue',
      control: 'section',
      collapsed: false,
    });
  });

  /** A fold reaches forward only. The next header
   *  ends the one before it, and a field written
   *  before any header belongs to no group at
   *  all. */
  it('draws the fields written before the first header', () => {
    expect(
      visible(form, new Set(['queue', 'advanced'])).map((field) => field.id),
    ).toEqual(['title', 'queue', 'advanced']);
  });
});

/**
 * Whether the function picker is open.
 *
 * At rest a block's function is one row, and the
 * list of what else could go there opens only when
 * somebody asks for it. The naming field is the one
 * place inside the list that keeps it open against
 * Escape and a press elsewhere: what those end there
 * is the name being typed, and the list it was typed
 * from is still what that person is choosing in.
 */
describe('whether the function picker is open', () => {
  const closed = { open: false, naming: false };
  const open = { open: true, naming: false };
  const naming = { open: true, naming: true };

  it('opens when the function a block runs is pressed', () => {
    expect(pickerAfter('press-current', closed)).toEqual(open);
  });

  it('closes when that row is pressed again', () => {
    expect(pickerAfter('press-current', open)).toEqual(closed);
    expect(pickerAfter('press-current', naming)).toEqual(closed);
  });

  it('closes on Escape, on a pick and on a press elsewhere', () => {
    expect(pickerAfter('escape', open)).toEqual(closed);
    expect(pickerAfter('pick', open)).toEqual(closed);
    expect(pickerAfter('outside', open)).toEqual(closed);
  });

  it('ends a name, not the list, on Escape or a press elsewhere', () => {
    expect(pickerAfter('escape', naming)).toEqual(open);
    expect(pickerAfter('outside', naming)).toEqual(open);
  });

  it('closes once a name is given', () => {
    expect(pickerAfter('pick', naming)).toEqual(closed);
  });

  it('starts and ends a name only inside an open list', () => {
    expect(pickerAfter('start-naming', open)).toEqual(naming);
    expect(pickerAfter('end-naming', naming)).toEqual(open);
    expect(pickerAfter('start-naming', closed)).toEqual(closed);
  });

  it('leaves a closed picker closed whatever else happens', () => {
    for (const event of ['escape', 'pick', 'outside', 'end-naming'] as const) {
      expect(pickerAfter(event, closed)).toEqual(closed);
    }
  });
});
