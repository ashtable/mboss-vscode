import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  NODE_PALETTE,
  NodeSchema,
  WorkflowIRSchema,
  type NodeKind,
  type WorkflowNode,
} from '../../core/rules.js';

import { messages } from '../../messages.js';

import { configToForm, formToConfig, type InspectorField } from './forms.js';

/**
 * The Inspector, as a set of fields over a node.
 *
 * The form is a view, not a second copy of the
 * node: applying it back gives the node with those
 * values written in, so anything the form does not
 * name survives untouched. That is what makes
 * "every kind round-trips" a statement about the
 * fields rather than about whether ten config
 * schemas were each covered leaf by leaf — and it
 * is why the round-trip below is a real assertion:
 * a field that reads one place and writes another
 * fails it.
 */

const ir = WorkflowIRSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../../../mboss-core/fixtures/ir/groom_booking.workflow.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ),
);

/**
 * One node per shape a kind can take, so that a
 * discriminated config is exercised in each of its
 * variants and not only in the one the canonical
 * fixture happens to use.
 */
const SAMPLES: readonly WorkflowNode[] = [
  ...ir.nodes,
  NodeSchema.parse({
    id: 'manual_start',
    kind: 'trigger',
    title: 'Start by hand',
    config: { mode: 'manual' },
  }),
  NodeSchema.parse({
    id: 'weekly_sweep',
    kind: 'trigger',
    title: 'Every Sunday',
    config: {
      mode: 'schedule',
      cron: '30 6 * * 0',
      timezone: 'America/Chicago',
      start: '2026-08-16T06:00:00.000Z',
    },
  }),
  NodeSchema.parse({
    id: 'odd_schedule',
    kind: 'trigger',
    title: 'Something else',
    config: { mode: 'schedule', cron: '*/7 2-5 1,15 * *' },
  }),
  NodeSchema.parse({
    id: 'call_out',
    kind: 'apiCall',
    title: 'Call the provider',
    config: { service: 'stripe' },
    handler: { export: 'chargeCard' },
  }),
  NodeSchema.parse({
    id: 'escape',
    kind: 'codeStep',
    title: 'Escape hatch',
    config: {},
  }),
  NodeSchema.parse({
    id: 'route_claim',
    kind: 'branch',
    title: 'Which desk?',
    handler: { export: 'routeClaim' },
    config: {
      cases: [
        { port: 'pay', when: { path: '', op: 'eq', value: 'pay' } },
        { port: 'refuse', when: { path: '', op: 'eq', value: 'refuse' } },
      ],
      elsePort: 'hold',
    },
  }),
  NodeSchema.parse({
    id: 'author_loop',
    kind: 'loop',
    title: 'Draft and revise',
    config: {
      minRounds: 2,
      maxRounds: 3,
      body: ['draft', 'revise'],
      models: { author: 'llama-3.3-70b', reviser: 'gpt-4o' },
    },
  }),
  NodeSchema.parse({
    id: 'wait_for_form',
    kind: 'durableWait',
    title: 'Wait for the form',
    config: {
      source: { kind: 'form', email: 'send_form' },
      onTimeout: 'abort',
    },
  }),
  NodeSchema.parse({
    id: 'wait_a_while',
    kind: 'durableWait',
    title: 'Sleep on it',
    config: {
      source: { kind: 'timer', seconds: 3600 },
      onTimeout: 'resend',
      maxResends: 2,
      afterMax: 'continue',
      timeoutDays: 7,
    },
  }),
  NodeSchema.parse({
    id: 'sign_off',
    kind: 'approval',
    title: 'Sign off',
    config: {
      to: 'boss@example.com',
      subject: 'Approve this',
      message: 'Please take a look.',
      timeoutDays: 3,
    },
  }),
  NodeSchema.parse({
    id: 'email_form',
    kind: 'emailSend',
    title: 'Ask for details',
    config: {
      to: 'requestingUser',
      subject: 'A few questions',
      bodyMarkdown: 'Fill this in.',
      attach: {
        type: 'form',
        form: {
          fields: [
            { id: 'notes', label: 'Anything else?', type: 'textarea' },
            { id: 'docs', label: 'Upload', type: 'fileUpload', multiple: true },
          ],
        },
      },
    },
  }),
  NodeSchema.parse({
    id: 'email_link',
    kind: 'emailSend',
    title: 'Send the report',
    config: {
      to: 'requestingUser',
      subject: 'Your report',
      bodyMarkdown: 'Here it is.',
      attach: { type: 'artifactLink', artifactPath: 'reports/latest.pdf' },
    },
  }),
];

function fieldsOf(node: WorkflowNode): InspectorField[] {
  return configToForm(node).fields;
}

function find(node: WorkflowNode, id: string): InspectorField | undefined {
  return fieldsOf(node).find((field) => field.id === id);
}

/**
 * The same fields with one value changed. Written
 * as a helper because narrowing a field before
 * spreading it is the only way to keep the union
 * honest, and doing that inline at every call site
 * buries the assertion.
 */
function set(
  fields: InspectorField[],
  id: string,
  value: string | number | boolean | null,
): InspectorField[] {
  return fields.map((field) => {
    if (field.id !== id) return field;

    switch (field.control) {
      case 'text':
      case 'prose':
      case 'choice':
        return { ...field, value: String(value) };
      case 'number':
        return { ...field, value: typeof value === 'number' ? value : null };
      case 'flag':
        return { ...field, value: Boolean(value) };
      case 'picker':
        return { ...field, value: value === null ? undefined : String(value) };
      case 'rows':
        return field;
    }
  });
}

/** The same, one row deep. */
function setInRow(
  fields: InspectorField[],
  id: string,
  index: number,
  inner: string,
  value: string | number | boolean | null,
): InspectorField[] {
  return fields.map((field) => {
    if (field.id !== id || field.control !== 'rows') return field;

    return {
      ...field,
      rows: field.rows.map((row, at) =>
        at === index ? set(row, inner, value) : row,
      ),
    };
  });
}

function sample(id: string): WorkflowNode {
  const node = SAMPLES.find((one) => one.id === id);
  expect(node).toBeDefined();

  return node!;
}

describe('every kind', () => {
  it('has a form', () => {
    const covered = new Set(SAMPLES.map((node) => node.kind));

    expect([...covered].sort()).toEqual(
      NODE_PALETTE.map((entry) => entry.kind).sort(),
    );

    for (const kind of NODE_PALETTE.map((entry) => entry.kind)) {
      const node = SAMPLES.find((one) => one.kind === kind);
      expect(fieldsOf(node!).length).toBeGreaterThan(0);
    }
  });

  // One assertion over all of them rather than a
  // loop, so a break shows every kind it broke and
  // not only the first.
  it('round-trips through its form unchanged', () => {
    expect(SAMPLES.map((node) => formToConfig(node, fieldsOf(node)))).toEqual([
      ...SAMPLES,
    ]);
  });

  it('round-trips into something the schema still accepts', () => {
    for (const node of SAMPLES) {
      expect(() =>
        NodeSchema.parse(formToConfig(node, fieldsOf(node))),
      ).not.toThrow();
    }
  });

  it('names the kind it is a form for', () => {
    for (const node of SAMPLES) {
      expect(configToForm(node).kind).toBe(node.kind);
    }
  });
});

describe('a scheduled trigger', () => {
  it('offers the schedule as run, repeat, on and at rather than as a cron string', () => {
    const node = sample('weekly_sweep');

    expect(find(node, 'mode')).toMatchObject({
      control: 'choice',
      value: 'schedule',
    });
    expect(find(node, 'repeat')).toMatchObject({
      control: 'choice',
      value: 'weekly',
    });
    expect(find(node, 'on')).toMatchObject({ value: '0' });
    expect(find(node, 'at')).toMatchObject({ value: '06:30' });
    expect(find(node, 'cron')).toBeUndefined();
  });

  it('stores the cron the friendly knobs add up to', () => {
    const node = sample('weekly_sweep');

    const moved = formToConfig(node, set(fieldsOf(node), 'at', '07:00'));

    expect(moved.config).toMatchObject({ cron: '0 7 * * 0' });
  });

  it('falls back to the cron itself when no friendly shape fits', () => {
    const node = sample('odd_schedule');

    expect(find(node, 'repeat')).toMatchObject({ value: 'custom' });
    expect(find(node, 'cron')).toMatchObject({
      control: 'text',
      value: '*/7 2-5 1,15 * *',
    });
    expect(find(node, 'on')).toBeUndefined();
  });

  it('starts a mode it is switched to off with a config that mode could have', () => {
    const node = sample('manual_start');

    const scheduled = formToConfig(
      node,
      set(fieldsOf(node), 'mode', 'schedule'),
    );

    expect(scheduled.config).toMatchObject({ mode: 'schedule' });
    expect(() => NodeSchema.parse(scheduled)).not.toThrow();
  });

  it('shows only the fields the chosen mode has', () => {
    const ids = fieldsOf(sample('manual_start')).map((field) => field.id);

    expect(ids).toContain('mode');
    expect(ids).not.toContain('cron');
    expect(ids).not.toContain('topic');
  });
});

describe('a durable wait', () => {
  it('offers the timeout and what happens when it runs out', () => {
    const node = sample('wait_a_while');

    expect(find(node, 'timeoutDays')).toMatchObject({
      control: 'number',
      value: 7,
    });
    expect(find(node, 'onTimeout')).toMatchObject({ value: 'resend' });
    expect(find(node, 'maxResends')).toMatchObject({ value: 2 });
    expect(find(node, 'afterMax')).toMatchObject({ value: 'continue' });
  });

  it('writes an edited timeout back into the node', () => {
    const node = sample('wait_a_while');

    const edited = formToConfig(node, set(fieldsOf(node), 'timeoutDays', 2));

    expect(edited.config).toMatchObject({ timeoutDays: 2 });
  });

  it('offers what it is waiting for, per source', () => {
    expect(find(sample('wait_for_form'), 'waitEmail')).toMatchObject({
      value: 'send_form',
    });
    expect(find(sample('wait_a_while'), 'seconds')).toMatchObject({
      value: 3600,
    });
    expect(find(sample('await_reply'), 'correlateWith')).toMatchObject({
      value: 'to',
    });
  });
});

describe('a recipient', () => {
  it('is either the person who asked or an address', () => {
    expect(find(sample('send_confirmation'), 'to')).toMatchObject({
      control: 'choice',
      value: 'requestingUser',
    });
    expect(find(sample('send_confirmation'), 'toAddress')).toBeUndefined();

    expect(find(sample('sign_off'), 'to')).toMatchObject({ value: 'address' });
    expect(find(sample('sign_off'), 'toAddress')).toMatchObject({
      value: 'boss@example.com',
    });
  });

  it('writes an edited address back into the node', () => {
    const node = sample('sign_off');

    const edited = formToConfig(
      node,
      set(fieldsOf(node), 'toAddress', 'someone@example.com'),
    );

    expect(edited.config).toMatchObject({ to: 'someone@example.com' });
  });

  it('turns into the requesting user without keeping the old address around', () => {
    const node = sample('sign_off');

    const edited = formToConfig(
      node,
      set(fieldsOf(node), 'to', 'requestingUser'),
    );

    expect(edited.config).toMatchObject({ to: 'requestingUser' });
  });
});

describe('a branch', () => {
  it('offers one row per case, and the way out for everything else', () => {
    const node = sample('reply_decision');
    const cases = find(node, 'cases');

    expect(cases?.control).toBe('rows');
    expect(cases?.control === 'rows' && cases.rows).toHaveLength(2);
    expect(find(node, 'elsePort')).toMatchObject({ value: 'stop' });
  });

  it('offers each case its port, its test, and the bound its back edge runs under', () => {
    const node = sample('reply_decision');
    const cases = find(node, 'cases');
    const first = cases?.control === 'rows' ? cases.rows[0] : undefined;

    expect(first?.map((field) => field.id)).toEqual([
      'port',
      'predicatePath',
      'predicateOp',
      'predicateValue',
      'maxIterations',
      'onExhausted',
    ]);
    expect(first?.find((field) => field.id === 'port')).toMatchObject({
      value: 'new_time',
    });
    expect(first?.find((field) => field.id === 'predicateValue')).toMatchObject(
      {
        value: '"reschedule"',
      },
    );
    expect(first?.find((field) => field.id === 'maxIterations')).toMatchObject({
      value: 10,
    });
  });

  it('writes an edited case back into the node', () => {
    const node = sample('reply_decision');

    const edited = formToConfig(
      node,
      setInRow(fieldsOf(node), 'cases', 0, 'maxIterations', 4),
    );

    expect(edited.config).toMatchObject({
      cases: [
        expect.objectContaining({ port: 'new_time', maxIterations: 4 }),
        expect.objectContaining({ port: 'book_it' }),
      ],
    });
  });
});

/**
 * The function a block runs is chosen from what the
 * project's code-behind offers, so the field is a
 * picker rather than a box to type a name into —
 * and a branch's is called its logic, because the
 * function is the decision rather than a step the
 * branch takes.
 */
describe('the function a block runs', () => {
  it('is picked rather than typed', () => {
    expect(find(sample('parse_request'), 'handler')).toEqual({
      id: 'handler',
      control: 'picker',
      value: 'parseRequest',
    });
  });

  it('says nothing where a block has none yet', () => {
    expect(find(sample('escape'), 'handler')).toEqual({
      id: 'handler',
      control: 'picker',
      value: undefined,
    });
  });

  it('goes onto the node when one is picked', () => {
    const node = sample('escape');

    const edited = formToConfig(node, [
      { id: 'handler', control: 'picker', value: 'retryOnce' },
    ]);

    expect(edited.handler).toEqual({ export: 'retryOnce' });
    expect(find(edited, 'handler')).toEqual({
      id: 'handler',
      control: 'picker',
      value: 'retryOnce',
    });
    expect(() => NodeSchema.parse(edited)).not.toThrow();
  });

  it('comes off the node when it is cleared', () => {
    const node = sample('parse_request');

    const edited = formToConfig(node, [
      { id: 'handler', control: 'picker', value: undefined },
    ]);

    expect(edited).not.toHaveProperty('handler');
    expect(() => NodeSchema.parse(edited)).not.toThrow();
  });

  it('is a branch’s logic rather than its handler', () => {
    const node = sample('route_claim');

    expect(find(node, 'logic')).toEqual({
      id: 'logic',
      control: 'picker',
      value: 'routeClaim',
    });
    expect(find(node, 'handler')).toBeUndefined();
  });

  it('leaves a branch the predicate editor only while it runs none', () => {
    const predicates = sample('reply_decision');
    const decided = sample('route_claim');

    expect(find(predicates, 'cases')).toBeDefined();
    expect(find(predicates, 'elsePort')).toBeDefined();
    expect(find(decided, 'cases')).toBeUndefined();
    expect(find(decided, 'elsePort')).toBeUndefined();
  });

  /**
   * Two branches showing the two states prove the
   * states exist. This proves one branch moves
   * between them, which is the thing a person does:
   * they try a function, decide the predicates said
   * it better, and take the function back off.
   */
  it('gives one branch its predicate editor back and takes it away again', () => {
    const decided = sample('route_claim');

    const cleared = formToConfig(decided, [
      { id: 'logic', control: 'picker', value: undefined },
    ]);

    expect(find(cleared, 'cases')).toBeDefined();
    expect(find(cleared, 'elsePort')).toBeDefined();

    const again = formToConfig(cleared, [
      { id: 'logic', control: 'picker', value: 'routeClaim' },
    ]);

    expect(find(again, 'cases')).toBeUndefined();
    expect(find(again, 'elsePort')).toBeUndefined();
  });
});

describe('a node’s own fields', () => {
  it('carry the title and the types it declares', () => {
    const node = sample('parse_request');

    expect(find(node, 'title')).toMatchObject({ value: 'Parse request' });
    expect(find(node, 'in')).toMatchObject({ value: 'WebhookEvent' });
    expect(find(node, 'out')).toMatchObject({ value: 'BookingReq' });
    expect(find(node, 'handler')).toMatchObject({ value: 'parseRequest' });
  });

  it('drop an emptied optional rather than storing a blank', () => {
    const node = sample('parse_request');

    const edited = formToConfig(node, set(fieldsOf(node), 'out', ''));

    expect(edited).not.toHaveProperty('out');
    expect(() => NodeSchema.parse(edited)).not.toThrow();
  });

  it('offer no handler on a kind that runs no code', () => {
    const handlerKinds: NodeKind[] = [
      'step',
      'transaction',
      'apiCall',
      'codeStep',
    ];

    for (const node of SAMPLES) {
      expect(find(node, 'handler') !== undefined).toBe(
        handlerKinds.includes(node.kind),
      );
    }
  });
});

/**
 * A field carries an id and no words at all, so a
 * field the string table does not know draws with
 * an empty label — and nothing else notices,
 * because an id is not a string anybody checks.
 * This is the check: every field of every kind,
 * and every option of every menu.
 */
describe('every field a person sees', () => {
  const strings = messages.inspectorStrings();

  const everyField = (fields: InspectorField[]): InspectorField[] =>
    fields.flatMap((field) =>
      field.control === 'rows'
        ? [field, ...field.rows.flatMap(everyField)]
        : [field],
    );

  const shown = SAMPLES.flatMap((node) => everyField(fieldsOf(node)));

  it('has a word to draw beside it', () => {
    const unlabelled = shown
      .map((field) => field.id)
      .filter((id) => strings.fields[id] === undefined);

    expect([...new Set(unlabelled)]).toEqual([]);
  });

  it('has a word for every choice it offers', () => {
    const unlabelled = shown
      .flatMap((field) =>
        field.control === 'choice'
          ? field.options.map((option) => `${field.id}.${option}`)
          : [],
      )
      .filter((key) => strings.options[key] === undefined);

    expect([...new Set(unlabelled)]).toEqual([]);
  });
});
