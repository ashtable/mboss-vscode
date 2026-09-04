/**
 * A field, read and written in one place.
 *
 * The Inspector has to do two things with every
 * field: show what the node says, and put back
 * what the person typed. Written as two mirrored
 * switches those drift, and the failure — a field
 * that reads one place and writes another — is
 * invisible until someone edits the wrong thing.
 * So a field is one object that knows both
 * directions, and the form is what you get by
 * asking each of them.
 */

/** One editable field, as the webview draws it. */
export type InspectorField =
  | { id: string; control: 'text'; value: string }
  | { id: string; control: 'prose'; value: string }
  | { id: string; control: 'number'; value: number | null }
  | { id: string; control: 'choice'; value: string; options: readonly string[] }
  | { id: string; control: 'flag'; value: boolean }
  | { id: string; control: 'picker'; value: string | undefined }
  | { id: string; control: 'rows'; rows: InspectorField[][] };

/** One field of one subject, both ways. */
export type Lens<S> = {
  id: string;

  read(subject: S): InspectorField;

  /** Answers with the subject unchanged when the
   *  field is not one this lens can apply, which
   *  is how a stale form from a previous selection
   *  fails to do damage. */
  write(subject: S, field: InspectorField): S;
};

/**
 * The subject with some of its fields replaced.
 *
 * `Object.assign` rather than a spread because a
 * spread of a generic loses the type: the compiler
 * cannot see that patching a subset of a node's
 * own fields leaves it the same kind of node.
 */
export function replace<S extends object>(subject: S, patch: Partial<S>): S {
  return Object.assign({}, subject, patch);
}

/** The subject without one of its optional
 *  fields. */
export function dropped<S extends object>(subject: S, key: keyof S): S {
  const copy = { ...subject };
  delete copy[key];

  return copy;
}

/** A free-text field. An empty one is an absent
 *  one wherever the field is optional. */
export function text<S>(
  id: string,
  get: (subject: S) => string | undefined,
  set: (subject: S, value: string) => S,
): Lens<S> {
  return {
    id,
    read: (subject) => ({ id, control: 'text', value: get(subject) ?? '' }),
    write: (subject, field) =>
      field.control === 'text' ? set(subject, field.value) : subject,
  };
}

/** Several lines of it. */
export function prose<S>(
  id: string,
  get: (subject: S) => string | undefined,
  set: (subject: S, value: string) => S,
): Lens<S> {
  return {
    id,
    read: (subject) => ({ id, control: 'prose', value: get(subject) ?? '' }),
    write: (subject, field) =>
      field.control === 'prose' ? set(subject, field.value) : subject,
  };
}

/** A number, or nothing where the field is
 *  optional. */
export function count<S>(
  id: string,
  get: (subject: S) => number | undefined,
  set: (subject: S, value: number | null) => S,
): Lens<S> {
  return {
    id,
    read: (subject) => ({ id, control: 'number', value: get(subject) ?? null }),
    write: (subject, field) =>
      field.control === 'number' ? set(subject, field.value) : subject,
  };
}

/**
 * One of a fixed set.
 *
 * Optional ones carry `unset` among their options,
 * which no schema in the catalog uses as a value,
 * so "not chosen" is a choice a person can make
 * rather than a blank they have to guess at.
 */
export const UNSET = 'unset';

export function choice<S>(
  id: string,
  options: readonly string[],
  get: (subject: S) => string,
  set: (subject: S, value: string) => S,
): Lens<S> {
  return {
    id,
    read: (subject) => ({
      id,
      control: 'choice',
      value: get(subject),
      options,
    }),
    write: (subject, field) =>
      field.control === 'choice' ? set(subject, field.value) : subject,
  };
}

/**
 * On or off.
 *
 * An optional boolean that is off is stored as
 * absent rather than as `false`. The two mean the
 * same thing everywhere they are read, and keeping
 * only one of them out of the document means a
 * node does not grow a field every time somebody
 * opens its Inspector.
 */
export function flag<S>(
  id: string,
  get: (subject: S) => boolean | undefined,
  set: (subject: S, value: boolean) => S,
): Lens<S> {
  return {
    id,
    read: (subject) => ({ id, control: 'flag', value: get(subject) ?? false }),
    write: (subject, field) =>
      field.control === 'flag' ? set(subject, field.value) : subject,
  };
}

/**
 * One name out of a list the document does not
 * hold.
 *
 * The list is the project's code-behind, which the
 * form has no way to see, so this carries the name
 * and nothing else — who may be named is the
 * picker's business, and `undefined` is a field
 * nobody has chosen for yet.
 */
export function picker<S>(
  id: string,
  get: (subject: S) => string | undefined,
  set: (subject: S, value: string | undefined) => S,
): Lens<S> {
  return {
    id,
    read: (subject) => ({ id, control: 'picker', value: get(subject) }),
    write: (subject, field) =>
      field.control === 'picker' ? set(subject, field.value) : subject,
  };
}

/**
 * A list of sub-forms — a branch's cases, a form's
 * fields, a loop's model roles.
 *
 * The rows are built from the same lenses as
 * anything else, one row per item, so a row's
 * fields are read and written in one place too.
 */
export function rows<S, Item>(
  id: string,
  items: (subject: S) => Item[],
  lenses: Lens<Item>[],
  put: (subject: S, items: Item[]) => S,
): Lens<S> {
  return {
    id,
    read: (subject) => ({
      id,
      control: 'rows',
      rows: items(subject).map((item) => lenses.map((one) => one.read(item))),
    }),
    write: (subject, field) => {
      if (field.control !== 'rows') return subject;

      return put(
        subject,
        items(subject).map((item, index) =>
          apply(item, lenses, field.rows[index] ?? []),
        ),
      );
    },
  };
}

/** Every lens' answer, in the order they were
 *  declared. */
export function readAll<S>(subject: S, lenses: Lens<S>[]): InspectorField[] {
  return lenses.map((lens) => lens.read(subject));
}

/** The subject with every field written back into
 *  it. */
export function apply<S>(
  subject: S,
  lenses: Lens<S>[],
  fields: InspectorField[],
): S {
  return fields.reduce(
    (carried, field) =>
      lenses.find((lens) => lens.id === field.id)?.write(carried, field) ??
      carried,
    subject,
  );
}
