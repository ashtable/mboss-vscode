import { describe, expect, it } from 'vitest';

import { apply, section, visible, type InspectorField } from './lens.js';

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
