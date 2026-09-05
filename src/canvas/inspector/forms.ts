import type {
  BranchCase,
  FormField,
  NodeKind,
  Predicate,
  WorkflowNode,
} from '../../core/rules.js';

import {
  UNSET,
  apply,
  choice,
  count,
  dropped,
  flag,
  picker,
  prose,
  readAll,
  replace,
  rows,
  text,
  type InspectorField,
  type Lens,
} from './lens.js';
import { REPEATS, readSchedule, writeSchedule } from './schedule.js';

/**
 * The Node Inspector's fields, per kind.
 *
 * The Inspector edits a node's config. Membership
 * in the graph — which blocks are inside a loop,
 * where an edge ends — is a canvas gesture, and is
 * deliberately not here: a list of node ids is not
 * something to type.
 *
 * Applying a form gives back the node with those
 * values written into it, rather than a config
 * rebuilt from the fields. So whatever a form does
 * not name survives untouched, and a new field is
 * one lens rather than a re-audit of a config
 * schema's every leaf.
 *
 * No string a person reads is here. A field
 * carries an id; the host turns ids into words and
 * sends them to the webview, which is the only way
 * a webview gets a string it can show.
 */

export type { InspectorField } from './lens.js';

/** A node's fields, and the kind they are for. */
export type InspectorForm = {
  kind: NodeKind;
  fields: InspectorField[];
};

type Of<K extends NodeKind> = Extract<WorkflowNode, { kind: K }>;

/** How a node's config reads as fields. */
export function configToForm(node: WorkflowNode): InspectorForm {
  return { kind: node.kind, fields: bind(node).read() };
}

/** The node, with those field values written back
 *  into it. */
export function formToConfig(
  node: WorkflowNode,
  fields: InspectorField[],
): WorkflowNode {
  return bind(node).write(fields);
}

/**
 * The one place a kind picks its fields.
 *
 * Both directions come from here, so a kind cannot
 * be read one way and written another, and the
 * compiler's exhaustiveness check over `kind` is
 * what says a new kind arrived without a form.
 */
function bind(node: WorkflowNode): {
  read: () => InspectorField[];
  write: (fields: InspectorField[]) => WorkflowNode;
} {
  switch (node.kind) {
    case 'trigger':
      return bound(node, triggerFields(node));
    case 'step':
    case 'transaction':
    case 'codeStep':
      return bound(node, [...base<typeof node>(), handler<typeof node>()]);
    case 'apiCall':
      return bound(node, [
        ...base<Of<'apiCall'>>(),
        handler<Of<'apiCall'>>(),
        text(
          'service',
          (one) => one.config.service,
          (one, value) =>
            replace(one, { config: { ...one.config, service: value } }),
        ),
      ]);
    case 'branch':
      return bound(node, branchFields(node));
    case 'loop':
      return bound(node, loopFields());
    case 'durableWait':
      return bound(node, waitFields(node));
    case 'approval':
      return bound(node, approvalFields(node));
    case 'emailSend':
      return bound(node, emailFields(node));
  }
}

function bound<N extends WorkflowNode>(node: N, lenses: Lens<N>[]) {
  return {
    read: () => readAll(node, lenses),
    write: (fields: InspectorField[]) => apply(node, lenses, fields),
  };
}

/* — the fields every node has — */

function base<N extends WorkflowNode>(): Lens<N>[] {
  return [
    text(
      'title',
      (node) => node.title,
      (node, value) => replace(node, { title: value } as Partial<N>),
    ),
    text(
      'in',
      (node) => node.in,
      (node, value) => optional(node, 'in', value),
    ),
    text(
      'out',
      (node) => node.out,
      (node, value) => optional(node, 'out', value),
    ),
  ];
}

/**
 * Which named export in the code-behind a node
 * runs. Only the kinds that run code have one.
 *
 * A branch's is called its logic, because the
 * function is the decision rather than a step the
 * branch takes — and because a person setting one
 * is choosing what the branch asks, not what it
 * does.
 */
function handler<N extends WorkflowNode>(id = 'handler'): Lens<N> {
  return picker(
    id,
    (node) => node.handler?.export,
    (node, value) =>
      value === undefined
        ? dropped(node, 'handler')
        : replace(node, { handler: { export: value } } as Partial<N>),
  );
}

/** Sets an optional string, or takes it out when
 *  it has been emptied. */
function optional<N extends object>(node: N, key: keyof N, value: string): N {
  return value === ''
    ? dropped(node, key)
    : replace(node, { [key]: value } as Partial<N>);
}

/* — trigger — */

const TRIGGER_MODES = ['manual', 'event', 'schedule'] as const;

function triggerFields(node: Of<'trigger'>): Lens<Of<'trigger'>>[] {
  const fields: Lens<Of<'trigger'>>[] = [
    ...base<Of<'trigger'>>(),
    choice(
      'mode',
      TRIGGER_MODES,
      (one) => one.config.mode,
      (one, value) =>
        value === one.config.mode
          ? one
          : replace(one, { config: startingConfig(value) }),
    ),
  ];

  if (node.config.mode === 'event') {
    fields.push(
      triggerText('topic', (config) =>
        config.mode === 'event' ? config.topic : undefined,
      ),
      triggerText('idempotencyKeyPath', (config) =>
        config.mode === 'event' ? config.idempotencyKeyPath : undefined,
      ),
      triggerText('requesterEmailPath', (config) =>
        config.mode === 'event' ? config.requesterEmailPath : undefined,
      ),
    );
  }

  if (node.config.mode === 'schedule') {
    const knobs = readSchedule(node.config.cron);

    fields.push(
      choice('repeat', REPEATS, () => knobs.repeat, retimed('repeat')),
      ...(knobs.repeat === 'custom'
        ? [text('cron', () => knobs.cron, retimed('cron'))]
        : [
            ...(knobs.repeat === 'weekly' || knobs.repeat === 'monthly'
              ? [text('on', () => knobs.on, retimed('on'))]
              : []),
            text('at', () => knobs.at, retimed('at')),
          ]),
      triggerText('timezone', (config) =>
        config.mode === 'schedule' ? config.timezone : undefined,
      ),
      triggerText('start', (config) =>
        config.mode === 'schedule' ? config.start : undefined,
      ),
      triggerText('ends', (config) =>
        config.mode === 'schedule' ? config.ends : undefined,
      ),
    );
  }

  return fields;
}

/**
 * What a trigger starts as when its mode changes.
 * A mode carries its own required fields, so
 * switching to one has to produce a config that
 * mode could have — and choosing the mode it
 * already has has to leave it alone, or reading a
 * form and writing it straight back would wipe the
 * schedule.
 */
function startingConfig(mode: string): Of<'trigger'>['config'] {
  if (mode === 'event') return { mode: 'event', topic: '' };
  if (mode === 'schedule') return { mode: 'schedule', cron: '0 9 * * *' };

  return { mode: 'manual' };
}

/** A string on whichever trigger config carries
 *  it. */
function triggerText(
  key: string,
  get: (config: Of<'trigger'>['config']) => string | undefined,
): Lens<Of<'trigger'>> {
  return text(
    key,
    (node) => get(node.config),
    (node, value) =>
      replace(node, {
        config: optional(node.config, key as never, value),
      }),
  );
}

/** Any one knob turned, and the expression the
 *  four of them then add up to. */
function retimed(
  knob: 'repeat' | 'on' | 'at' | 'cron',
): (node: Of<'trigger'>, value: string) => Of<'trigger'> {
  return (node, value) => {
    if (node.config.mode !== 'schedule') return node;

    const knobs = readSchedule(node.config.cron);

    return replace(node, {
      config: {
        ...node.config,
        cron: writeSchedule({ ...knobs, [knob]: value }),
      },
    });
  };
}

/* — branch — */

const PREDICATE_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
  'nonempty',
] as const;

const EXHAUSTED = ['abort', 'continue'] as const;

/**
 * A branch reads one of two ways, and never both.
 *
 * With a function behind it the function decides,
 * and the cases are what it decided between — read
 * beside the wires they stand for rather than
 * typed. Without one, the predicates below are the
 * decision, and they are the only thing to edit.
 */
function branchFields(node: Of<'branch'>): Lens<Of<'branch'>>[] {
  const decision = [...base<Of<'branch'>>(), handler<Of<'branch'>>('logic')];

  if (node.handler !== undefined) return decision;

  return [
    ...decision,
    rows<Of<'branch'>, BranchCase>(
      'cases',
      (node) => node.config.cases,
      caseFields(),
      (node, cases) => replace(node, { config: { ...node.config, cases } }),
    ),
    text(
      'elsePort',
      (node) => node.config.elsePort,
      (node, value) =>
        replace(node, { config: { ...node.config, elsePort: value } }),
    ),
  ];
}

/**
 * One case: the port its edge leaves by, the test
 * that sends a run down it, and — where that edge
 * loops back — the bound the loop runs under.
 */
function caseFields(): Lens<BranchCase>[] {
  return [
    text(
      'port',
      (one) => one.port,
      (one, value) => replace(one, { port: value }),
    ),
    text(
      'predicatePath',
      (one) => one.when.path,
      (one, value) => replace(one, { when: { ...one.when, path: value } }),
    ),
    choice(
      'predicateOp',
      PREDICATE_OPS,
      (one) => one.when.op,
      (one, value) =>
        replace(one, {
          when: { ...one.when, op: value as Predicate['op'] },
        }),
    ),
    text(
      'predicateValue',
      (one) => asText(one.when.value),
      (one, value) =>
        replace(one, {
          when:
            value === ''
              ? dropped(one.when, 'value')
              : { ...one.when, value: asJson(value) },
        }),
    ),
    count(
      'maxIterations',
      (one) => one.maxIterations,
      (one, value) =>
        value === null ? one : replace(one, { maxIterations: value }),
    ),
    choice(
      'onExhausted',
      EXHAUSTED,
      (one) => one.onExhausted,
      (one, value) =>
        replace(one, { onExhausted: value as BranchCase['onExhausted'] }),
    ),
  ];
}

/**
 * A predicate compares against whatever JSON the
 * payload holds, so the field shows JSON. Text
 * that is not JSON is taken as the string it is,
 * which is what somebody typing a word into the
 * box meant.
 */
function asText(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value);
}

function asJson(value: string): Predicate['value'] {
  try {
    return JSON.parse(value) as Predicate['value'];
  } catch {
    return value;
  }
}

/* — loop — */

function loopFields(): Lens<Of<'loop'>>[] {
  return [
    ...base<Of<'loop'>>(),
    count(
      'minRounds',
      (node) => node.config.minRounds,
      (node, value) =>
        value === null
          ? node
          : replace(node, { config: { ...node.config, minRounds: value } }),
    ),
    count(
      'maxRounds',
      (node) => node.config.maxRounds,
      (node, value) =>
        value === null
          ? node
          : replace(node, { config: { ...node.config, maxRounds: value } }),
    ),
    rows<Of<'loop'>, [string, string]>(
      'models',
      (node) => Object.entries(node.config.models ?? {}),
      [
        text(
          'modelRole',
          ([role]) => role,
          ([, model], value) => [value, model],
        ),
        text(
          'modelId',
          ([, model]) => model,
          ([role], value) => [role, value],
        ),
      ],
      (node, roles) =>
        replace(node, {
          config:
            roles.length === 0
              ? dropped(node.config, 'models')
              : { ...node.config, models: Object.fromEntries(roles) },
        }),
    ),
  ];
}

/* — durable wait — */

const WAIT_KINDS = ['form', 'event', 'timer'] as const;
const ON_TIMEOUT = ['resend', 'abort'] as const;
const AFTER_MAX = [UNSET, 'abort', 'continue'] as const;

type Wait = Of<'durableWait'>;
type WaitConfig = Wait['config'];

function waitFields(node: Wait): Lens<Wait>[] {
  const source: Lens<Wait>[] = [
    choice(
      'waitKind',
      WAIT_KINDS,
      (one) => one.config.source.kind,
      (one, value) =>
        value === one.config.source.kind
          ? one
          : replace(one, {
              config: { ...one.config, source: startingSource(value) },
            }),
    ),
  ];

  if (node.config.source.kind === 'form') {
    source.push(
      sourceText('waitEmail', (one) =>
        one.kind === 'form' ? one.email : undefined,
      ),
    );
  }

  if (node.config.source.kind === 'event') {
    source.push(
      sourceText('topic', (one) => (one.kind === 'event' ? one.topic : '')),
      sourceText('correlationPath', (one) =>
        one.kind === 'event' ? one.correlationPath : '',
      ),
      sourceText('correlateWith', (one) =>
        one.kind === 'event' ? one.correlateWith : '',
      ),
    );
  }

  if (node.config.source.kind === 'timer') {
    source.push(
      count(
        'seconds',
        (one) =>
          one.config.source.kind === 'timer'
            ? one.config.source.seconds
            : undefined,
        (one, value) =>
          value === null || one.config.source.kind !== 'timer'
            ? one
            : replace(one, {
                config: {
                  ...one.config,
                  source: { ...one.config.source, seconds: value },
                },
              }),
      ),
    );
  }

  return [
    ...base<Wait>(),
    ...source,
    count(
      'timeoutDays',
      (one) => one.config.timeoutDays,
      (one, value) =>
        replace(one, {
          config: optionalCount(one.config, 'timeoutDays', value),
        }),
    ),
    choice(
      'onTimeout',
      ON_TIMEOUT,
      (one) => one.config.onTimeout,
      (one, value) =>
        replace(one, {
          config: {
            ...one.config,
            onTimeout: value as WaitConfig['onTimeout'],
          },
        }),
    ),
    count(
      'maxResends',
      (one) => one.config.maxResends,
      (one, value) =>
        replace(one, {
          config: optionalCount(one.config, 'maxResends', value),
        }),
    ),
    choice(
      'afterMax',
      AFTER_MAX,
      (one) => one.config.afterMax ?? UNSET,
      (one, value) =>
        replace(one, {
          config:
            value === UNSET
              ? dropped(one.config, 'afterMax')
              : { ...one.config, afterMax: value as 'abort' | 'continue' },
        }),
    ),
  ];
}

/** What a wait starts waiting for when its source
 *  changes. */
function startingSource(kind: string): WaitConfig['source'] {
  if (kind === 'event') {
    return { kind: 'event', topic: '', correlationPath: '', correlateWith: '' };
  }
  if (kind === 'timer') return { kind: 'timer', seconds: 60 };

  return { kind: 'form', email: '' };
}

function sourceText(
  key: string,
  get: (source: WaitConfig['source']) => string | undefined,
): Lens<Wait> {
  return text(
    key,
    (node) => get(node.config.source),
    (node, value) =>
      replace(node, {
        config: {
          ...node.config,
          source: replace(node.config.source, {
            [key === 'waitEmail' ? 'email' : key]: value,
          } as never),
        },
      }),
  );
}

/** Sets an optional number, or takes it out when
 *  it has been cleared. */
function optionalCount<S extends object>(
  subject: S,
  key: keyof S,
  value: number | null,
): S {
  return value === null
    ? dropped(subject, key)
    : replace(subject, { [key]: value } as Partial<S>);
}

/* — who an email goes to — */

const REQUESTING_USER = 'requestingUser';
const ADDRESS = 'address';
const RECIPIENTS = [REQUESTING_USER, ADDRESS] as const;

type Addressed = Of<'approval'> | Of<'emailSend'>;

/**
 * `requestingUser` resolves at run time from the
 * trigger's declared requester path; anything else
 * is an address typed here. Two fields rather than
 * one because they are two different decisions,
 * and the second only exists once the first is
 * made.
 */
function recipientFields<N extends Addressed>(node: N): Lens<N>[] {
  const fields: Lens<N>[] = [
    choice(
      'to',
      RECIPIENTS,
      (one) => (one.config.to === REQUESTING_USER ? REQUESTING_USER : ADDRESS),
      (one, value) =>
        replace(one, {
          config: {
            ...one.config,
            to: value === REQUESTING_USER ? REQUESTING_USER : '',
          },
        } as Partial<N>),
    ),
  ];

  if (node.config.to !== REQUESTING_USER) {
    fields.push(
      text(
        'toAddress',
        (one) => (one.config.to === REQUESTING_USER ? '' : one.config.to),
        // Silent once the recipient is the person
        // who asked: the two fields are applied in
        // order, and an address left over from
        // before must not put itself back.
        (one, value) =>
          one.config.to === REQUESTING_USER
            ? one
            : replace(one, {
                config: { ...one.config, to: value },
              } as Partial<N>),
      ),
    );
  }

  return fields;
}

/* — approval — */

function approvalFields(node: Of<'approval'>): Lens<Of<'approval'>>[] {
  return [
    ...base<Of<'approval'>>(),
    ...recipientFields(node),
    text(
      'subject',
      (node) => node.config.subject,
      (node, value) =>
        replace(node, { config: optional(node.config, 'subject', value) }),
    ),
    prose(
      'message',
      (node) => node.config.message,
      (node, value) =>
        replace(node, { config: optional(node.config, 'message', value) }),
    ),
    count(
      'timeoutDays',
      (node) => node.config.timeoutDays,
      (node, value) =>
        replace(node, {
          config: optionalCount(node.config, 'timeoutDays', value),
        }),
    ),
  ];
}

/* — email — */

const ATTACHMENTS = ['none', 'form', 'artifactLink'] as const;
const FIELD_TYPES = ['text', 'textarea', 'fileUpload', 'yesNo'] as const;

type Email = Of<'emailSend'>;

function emailFields(node: Email): Lens<Email>[] {
  const attachment: Lens<Email>[] = [
    choice(
      'attachType',
      ATTACHMENTS,
      (one) => one.config.attach.type,
      (one, value) =>
        value === one.config.attach.type
          ? one
          : replace(one, {
              config: { ...one.config, attach: startingAttachment(value) },
            }),
    ),
  ];

  if (node.config.attach.type === 'artifactLink') {
    attachment.push(
      text(
        'artifactPath',
        (one) =>
          one.config.attach.type === 'artifactLink'
            ? one.config.attach.artifactPath
            : '',
        (one, value) =>
          one.config.attach.type !== 'artifactLink'
            ? one
            : replace(one, {
                config: {
                  ...one.config,
                  attach: { ...one.config.attach, artifactPath: value },
                },
              }),
      ),
    );
  }

  if (node.config.attach.type === 'form') {
    attachment.push(
      rows<Email, FormField>(
        'formFields',
        (one) =>
          one.config.attach.type === 'form'
            ? one.config.attach.form.fields
            : [],
        formFieldLenses(),
        (one, fields) =>
          one.config.attach.type !== 'form'
            ? one
            : replace(one, {
                config: {
                  ...one.config,
                  attach: { ...one.config.attach, form: { fields } },
                },
              }),
      ),
    );
  }

  return [
    ...base<Email>(),
    ...recipientFields(node),
    text(
      'subject',
      (one) => one.config.subject,
      (one, value) =>
        replace(one, { config: { ...one.config, subject: value } }),
    ),
    prose(
      'bodyMarkdown',
      (one) => one.config.bodyMarkdown,
      (one, value) =>
        replace(one, { config: { ...one.config, bodyMarkdown: value } }),
    ),
    ...attachment,
  ];
}

/** What an email carries when its attachment
 *  changes. */
function startingAttachment(type: string): Email['config']['attach'] {
  if (type === 'form') return { type: 'form', form: { fields: [] } };
  if (type === 'artifactLink') {
    return { type: 'artifactLink', artifactPath: '' };
  }

  return { type: 'none' };
}

/**
 * One field of a form. `showIf` — which answer
 * already given makes this field appear — is
 * carried through rather than edited: it is a
 * predicate, and the JSON view is where predicates
 * are written until the Inspector grows a builder
 * for them.
 */
function formFieldLenses(): Lens<FormField>[] {
  return [
    text(
      'fieldId',
      (one) => one.id,
      (one, value) => replace(one, { id: value }),
    ),
    text(
      'fieldLabel',
      (one) => one.label,
      (one, value) => replace(one, { label: value }),
    ),
    choice(
      'fieldType',
      FIELD_TYPES,
      (one) => one.type,
      (one, value) => replace(one, { type: value as FormField['type'] }),
    ),
    flag(
      'fieldRequired',
      (one) => one.required,
      (one, value) =>
        value ? replace(one, { required: true }) : dropped(one, 'required'),
    ),
    flag(
      'fieldMultiple',
      (one) => one.multiple,
      (one, value) =>
        value ? replace(one, { multiple: true }) : dropped(one, 'multiple'),
    ),
  ];
}
