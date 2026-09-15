import { describe, expect, it } from 'vitest';

import {
  NodeSchema,
  type LibFunction,
  type WorkflowNode,
} from '../core/rules.js';

import { configToForm, formToConfig } from './forms.js';
import {
  apply,
  pairOf,
  pickerAfter,
  section,
  showsDeclarations,
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

  it('reads whether it folds', () => {
    expect(
      section<typeof subject>('advanced', { folds: true }).read(subject),
    ).toEqual({ id: 'advanced', control: 'section', folds: true });
  });

  /** Most groups are only named. Folding one away
   *  is asked for, group by group. */
  it('folds nothing unless it is asked to', () => {
    expect(section<typeof subject>('queuePolicy').read(subject)).toEqual({
      id: 'queuePolicy',
      control: 'section',
      folds: false,
    });
  });

  it('writes nothing back, not even its own field', () => {
    const lens = section<typeof subject>('advanced', { folds: true });

    expect(lens.write(subject, lens.read(subject))).toBe(subject);
  });

  it('leaves the subject alone when a whole form is applied', () => {
    const lens = section<typeof subject>('advanced');

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
    { id: 'queue', control: 'section', folds: false },
    { id: 'queueName', control: 'text', value: 'orders' },
    { id: 'advanced', control: 'section', folds: true },
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
      folds: false,
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

/**
 * The types a block declares, which the form reads
 * and writes like any other field.
 */
describe('a node’s own fields', () => {
  const node = NodeSchema.parse({
    id: 'parse_request',
    kind: 'step',
    title: 'Parse request',
    in: 'WebhookEvent',
    out: 'BookingReq',
    handler: { export: 'parseRequest' },
    config: {},
  });

  const field = (id: string): InspectorField | undefined =>
    configToForm(node).fields.find((one) => one.id === id);

  it('carry the title and the types it declares', () => {
    expect(field('title')).toMatchObject({ value: 'Parse request' });
    expect(field('in')).toMatchObject({ value: 'WebhookEvent' });
    expect(field('out')).toMatchObject({ value: 'BookingReq' });
    expect(field('handler')).toMatchObject({ value: 'parseRequest' });
  });

  it('drop an emptied optional rather than storing a blank', () => {
    const edited = formToConfig(node, [
      { id: 'out', control: 'text', value: '' },
    ]);

    expect(edited).not.toHaveProperty('out');
    expect(() => NodeSchema.parse(edited)).not.toThrow();
  });
});

/**
 * Whether a block's takes and produces are drawn
 * as rows of their own.
 *
 * Where a function is behind the block and the
 * scan read it, its signature already says what
 * goes in and what comes out, on the row that names
 * it; two more rows saying the same thing again are
 * two more to read. They come back wherever that
 * row cannot speak for them: nothing is behind the
 * block, the scan has no such export, the block
 * fans out so it takes the collection while the
 * function takes one item, or what the block
 * declares and what the function is written with
 * disagree — the one place somebody has to see
 * both.
 */
describe('whether a block shows the types it declares', () => {
  const step = (over: object = {}): WorkflowNode =>
    NodeSchema.parse({
      id: 'find_slot',
      kind: 'step',
      title: 'Find open slot',
      in: 'BookingReq',
      out: 'SlotGrid',
      handler: { export: 'findSlot' },
      config: {},
      ...over,
    });

  const findSlot: LibFunction = {
    export: 'findSlot',
    file: 'lib/findSlot.ts',
    params: [{ name: 'req', type: 'BookingReq' }],
    returnType: 'SlotGrid',
  };

  it('leaves them to the signature where the function agrees', () => {
    expect(showsDeclarations(step(), findSlot)).toBe(false);
  });

  it('draws them on a block nothing is behind', () => {
    expect(showsDeclarations(step({ handler: undefined }), undefined)).toBe(
      true,
    );
  });

  it('draws them where the scan has no such export', () => {
    expect(showsDeclarations(step(), undefined)).toBe(true);
  });

  it('draws them on a block that fans out', () => {
    const fanned = step({ forEach: { itemsPath: 'slots' } });

    expect(showsDeclarations(fanned, findSlot)).toBe(true);
  });

  it('draws them where the block and the function disagree', () => {
    expect(showsDeclarations(step({ out: 'Booking' }), findSlot)).toBe(true);
    expect(
      showsDeclarations(step(), {
        ...findSlot,
        params: [{ name: 'req', type: 'WebhookEvent' }],
      }),
    ).toBe(true);
  });

  /** A queue fans out by being one, and what it
   *  declares is the item: the function's one
   *  parameter is held to that, so the signature
   *  speaks for it until the two disagree. */
  it('holds a queue to the item it declares', () => {
    const queue = (itemType: string): WorkflowNode =>
      NodeSchema.parse({
        id: 'index_pages',
        kind: 'queue',
        title: 'Index each page',
        handler: { export: 'indexItem' },
        config: {
          itemsPath: 'pages',
          itemType,
          queue: { name: 'document-index' },
          enqueue: {},
        },
      });
    const indexItem: LibFunction = {
      export: 'indexItem',
      file: 'lib/indexItem.ts',
      params: [{ name: 'item', type: 'Item' }],
      returnType: 'Indexed',
    };

    expect(showsDeclarations(queue('Item'), indexItem)).toBe(false);
    expect(showsDeclarations(queue('Page'), indexItem)).toBe(true);
  });
});

/**
 * A limit set as a count and the period it is
 * counted over.
 *
 * The two are one property, so they are drawn in
 * one row, and they stay two fields: each box is
 * committed on its own, the way every box is. What
 * keeps them one limit is that a half is written
 * with the other beside it — a count with the
 * period already set, or the period a limit starts
 * with — and that half a limit is no limit, so
 * emptying either box takes the whole of it off.
 */
describe('a limit written as a pair', () => {
  const queue = (limits: object = {}): WorkflowNode =>
    NodeSchema.parse({
      id: 'index_pages',
      kind: 'queue',
      title: 'Index each page',
      config: {
        itemsPath: 'pages',
        queue: { name: 'document-index', ...limits },
        enqueue: {},
      },
    });

  const PAIRS = [
    ['rateLimitPer', 'rateLimitSec', 'rateLimit'],
    ['partitionRateLimitPer', 'partitionRateLimitSec', 'partitionRateLimit'],
  ] as const;

  /** Both halves as the form reads them back. */
  const read = (node: WorkflowNode, per: string, sec: string) => {
    const pair = pairOf(configToForm(node).fields, per, sec);

    return pair === undefined ? undefined : [pair.per.value, pair.sec.value];
  };

  /** One box committed on its own. */
  const commit = (
    node: WorkflowNode,
    id: string,
    value: number | null,
  ): WorkflowNode => formToConfig(node, [{ id, control: 'number', value }]);

  it('finds both halves, the count first', () => {
    const fields = configToForm(
      queue({ rateLimit: { limitPerPeriod: 100, periodSec: 60 } }),
    ).fields;

    expect(pairOf(fields, 'rateLimitPer', 'rateLimitSec')).toEqual({
      per: { id: 'rateLimitPer', control: 'number', value: 100 },
      sec: { id: 'rateLimitSec', control: 'number', value: 60 },
    });
  });

  it('is no pair when either half is missing or out of place', () => {
    const fields = configToForm(queue()).fields;
    const without = (id: string) => fields.filter((one) => one.id !== id);
    const per = fields.findIndex((one) => one.id === 'rateLimitPer');

    expect(per).toBeGreaterThan(-1);
    expect(
      pairOf(without('rateLimitSec'), 'rateLimitPer', 'rateLimitSec'),
    ).toBeUndefined();
    expect(
      pairOf(without('rateLimitPer'), 'rateLimitPer', 'rateLimitSec'),
    ).toBeUndefined();
    expect(pairOf(fields, 'rateLimitSec', 'rateLimitPer')).toBeUndefined();
    expect(pairOf(fields, 'rateLimitPer', 'globalConcurrency')).toBeUndefined();
  });

  it('writes the whole limit from either half', () => {
    for (const [per, sec, key] of PAIRS) {
      expect(read(commit(queue(), per, 100), per, sec), key).toEqual([100, 60]);
      expect(read(commit(queue(), sec, 20), per, sec), key).toEqual([1, 20]);

      const set = queue({ [key]: { limitPerPeriod: 100, periodSec: 20 } });

      expect(read(commit(set, per, 5), per, sec), key).toEqual([5, 20]);
      expect(read(commit(set, sec, 30), per, sec), key).toEqual([100, 30]);
    }
  });

  it('takes the whole limit off when either half is emptied', () => {
    for (const [per, sec, key] of PAIRS) {
      const set = queue({ [key]: { limitPerPeriod: 100, periodSec: 20 } });

      for (const emptied of [per, sec]) {
        const cleared = commit(set, emptied, null);

        expect(read(cleared, per, sec), emptied).toEqual([null, null]);
        expect(cleared.config, emptied).not.toHaveProperty(`queue.${key}`);
      }
    }
  });
});
