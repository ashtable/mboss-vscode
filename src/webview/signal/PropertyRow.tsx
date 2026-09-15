import { Fragment, useId, type ReactNode } from 'react';

import { FieldHint } from './FieldHint.js';
import { hooked } from './hook.js';

/**
 * One property of a thing: what it is called, then
 * what it is.
 *
 * The label comes first and sits on the value's
 * line, in a column of its own, so a person reads
 * down the values and across only to learn what one
 * of them is. A value with its caption under it is
 * the opposite, and a column of those is a column of
 * numbers with the words scattered between them.
 *
 * A row holds one of three things. A value, which is
 * read and not changed. One control, which the label
 * names. Or a few controls that are one property
 * between them — a count and the period it is
 * counted over — where the row is the group the
 * label names, and each control carries a name of
 * its own. Every control, in either shape, sits
 * under exactly one lens id, which is how the host
 * and every journey find it.
 *
 * Rows are told apart by a hairline above each, and
 * by nothing around them: a stack of boxes is a
 * stack of things to read before the values.
 */

/** What a row hands the control it draws: the id
 *  its label points at, and the ids of what says
 *  more about the value. */
export type Named = { id: string; describedBy: string | undefined };

type Control = (named: Named) => ReactNode;

type Holding =
  | { value: ReactNode; field?: never; control?: never; controls?: never }
  | { field: string; control: Control; value?: never; controls?: never }
  | {
      controls: readonly { field: string; control: Control }[];
      value?: never;
      field?: never;
      control?: never;
    };

/** A row's label and what it holds, and the few
 *  things drawn beside a value. */
export type PropertyRowProps = Holding & {
  label: ReactNode;

  /** How much room the labels need. A ledger's
   *  rows and a queue's limits say their scope in
   *  the label, and a scope cut in half is no use. */
  labels?: 'default' | 'ledger' | 'wide';

  /** The value is machine evidence. */
  mono?: boolean;

  /** What the value is counted in, drawn after the
   *  control so what is typed stays a number. */
  unit?: string;

  /** Whether the value was worked out or read off
   *  the configuration, rather than recorded. */
  provenance?: { kind: 'derived' | 'configured'; word: string };

  /** What is wrong with the value, said under it. */
  note?: string;

  hook?: Record<string, string>;
};

/** One property, label first, in its own row. */
export function PropertyRow(props: PropertyRowProps) {
  const { label, labels, mono, unit, provenance, note, hook } = props;
  const named = useId();

  const ids = {
    label: `${named}label`,
    control: `${named}control`,
    unit: `${named}unit`,
    note: `${named}note`,
  };

  // The unit and the note are what a screen reader
  // says after the control's name: the unit is not
  // in the box, and the note is not on the row's
  // line, so neither is reached by reading the
  // control alone. The unit is drawn after the last
  // control and is what that one is counted in, so
  // in a pair it describes that half and no other.
  const describing = (counted: boolean): string | undefined =>
    [
      counted && unit !== undefined ? ids.unit : '',
      note === undefined ? '' : ids.note,
    ]
      .filter((id) => id !== '')
      .join(' ') || undefined;

  const grouped = props.controls !== undefined;

  const held =
    props.controls !== undefined
      ? props.controls.map(({ field, control }, at, all) => (
          <Fragment key={field}>
            {/* The halves read as one figure, a mark
                between each two; each is named for
                what it holds, so the mark is not
                read out. */}
            {at === 0 ? null : (
              <span className="property-joint" aria-hidden="true">
                /
              </span>
            )}
            <span className="property-control" data-field={field}>
              {control({
                id: `${named}${field}`,
                describedBy: describing(at === all.length - 1),
              })}
            </span>
          </Fragment>
        ))
      : props.control !== undefined
        ? props.control({ id: ids.control, describedBy: describing(true) })
        : props.value;

  return (
    <div
      className="property"
      data-property=""
      data-labels={labels}
      data-field={props.field}
      role={grouped ? 'group' : undefined}
      aria-labelledby={grouped ? ids.label : undefined}
      {...hooked(hook)}
    >
      {props.control !== undefined ? (
        <label className="property-label" htmlFor={ids.control}>
          {label}
        </label>
      ) : (
        <span className="property-label" id={grouped ? ids.label : undefined}>
          {label}
        </span>
      )}

      <div className="value" data-mono={mono === true ? '' : undefined}>
        {held}

        {unit === undefined ? null : (
          <span className="property-unit" id={ids.unit} aria-hidden="true">
            {unit}
          </span>
        )}

        {provenance === undefined ? null : (
          <span
            className="property-provenance"
            data-provenance={provenance.kind}
          >
            · {provenance.word}
          </span>
        )}
      </div>

      {note === undefined ? null : (
        <FieldHint id={ids.note} hookClass="field-note">
          {note}
        </FieldHint>
      )}
    </div>
  );
}
