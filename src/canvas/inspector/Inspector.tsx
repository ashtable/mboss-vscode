import { useRef, useState } from 'react';

import type {
  HandlerMisfit,
  LibFunction,
  WorkflowNode,
} from '../../core/rules.js';
import { postToHost } from '../../webview/client.js';
import { filled } from '../../webview/fill.js';
import type {
  Callout as CalloutWords,
  CanvasInspector,
  DecisionOutcome,
  InspectorStrings,
  SelectedNode,
} from '../../webview/protocol.js';
import { FunctionLines, fitsFor, type LibFit } from '../libFunction.js';

import { configToForm, formToConfig, type InspectorField } from './forms.js';

/**
 * The Inspector: the one place a block's config is
 * set, and the canvas' third column.
 *
 * The node being edited is held here rather than
 * only in the document, and that is deliberate. A
 * field can be half-set — an address chosen but
 * not typed, a mode picked whose topic is still
 * blank — and the document has no way to hold a
 * half-set block. So the column keeps what a person
 * is in the middle of doing, sends it to the host
 * at each commit, and the host writes the ones
 * that are whole.
 *
 * A field commits when the person is finished with
 * it: a menu or a checkbox the moment it changes,
 * a text field on blur or Enter, and Escape puts
 * back what the document says. Never per keystroke
 * — the revision that granularity produces is on
 * screen, in the graph's own caption.
 *
 * The function a block runs is the exception, and
 * is not a field at all: it is picked out of what
 * the project's code-behind offers, which the form
 * cannot see, so it goes to the host as its own
 * message and comes back as a document.
 */
export type InspectorProps = CanvasInspector & {
  /** What the project's code-behind offers, which
   *  is what the picker offers. */
  lib: LibFunction[] | undefined;

  /** Why a function cannot sit behind a block,
   *  shared with the palette. */
  misfits: Record<HandlerMisfit['kind'], string>;
};

/**
 * Brings the top of this column into view.
 *
 * The column is always drawn, so nothing opens —
 * what this does is take a person to it, after they
 * have done something on the canvas that the column
 * is about to ask the next question about.
 *
 * It lives beside the heading it looks for so that
 * the mark and the search for it cannot drift apart.
 */
export function showInspectorHeading(): void {
  document
    .querySelector('[data-inspector-heading]')
    ?.scrollIntoView({ block: 'nearest' });
}

export function Inspector({ strings, selected, lib, misfits }: InspectorProps) {
  if (selected === undefined) {
    return (
      <div className="inspector">
        <p className="eyebrow text-muted">{strings.heading}</p>
        <p className="state text-muted">{strings.nothingSelected}</p>
      </div>
    );
  }

  return (
    <Fields
      key={`${selected.node.id}:${selected.revision}`}
      strings={strings}
      selected={selected}
      lib={lib}
      misfits={misfits}
    />
  );
}

function Fields({
  strings,
  selected,
  lib,
  misfits,
}: {
  strings: InspectorStrings;
  selected: SelectedNode;
  lib: LibFunction[] | undefined;
  misfits: Record<HandlerMisfit['kind'], string>;
}) {
  const [draft, setDraft] = useState(selected.node);
  const form = configToForm(draft);

  const commit = (field: InspectorField): void => {
    const next = formToConfig(draft, [field]);

    setDraft(next);
    postToHost({
      type: 'edit',
      baseRevision: selected.revision,
      node: next,
    });
  };

  // The picker writes a document rather than a
  // draft: which function a block runs is a fact
  // the host checks against the manifest, and on a
  // branch it decides what the cases are.
  const assign = (exported: string | null): void =>
    postToHost({
      type: 'assign',
      baseRevision: selected.revision,
      nodeId: selected.node.id,
      export: exported,
    });

  return (
    <div className="inspector">
      <p className="eyebrow" data-inspector-heading>
        {strings.heading} · {strings.kinds[form.kind]}
      </p>

      <dl className="fields">
        {form.fields.map((field) =>
          field.control === 'picker' ? (
            <Picker
              key={field.id}
              strings={strings}
              misfits={misfits}
              field={field}
              node={draft}
              lib={lib}
              onAssign={assign}
            />
          ) : (
            <Row
              key={field.id}
              strings={strings}
              field={field}
              onCommit={commit}
            />
          ),
        )}

        {selected.outcomes.map((outcome) => (
          <Outcome key={outcome.value} strings={strings} outcome={outcome} />
        ))}

        {form.kind !== 'transaction' ? null : (
          <Told
            id="database"
            name={strings.fields.database}
            value={strings.database}
          />
        )}
      </dl>
    </div>
  );
}

function Row({
  strings,
  field,
  onCommit,
}: {
  strings: InspectorStrings;
  field: InspectorField;
  onCommit: (field: InspectorField) => void;
}) {
  return (
    <div className="field" data-field={field.id} data-control={field.control}>
      <dt className="field-name text-muted">{strings.fields[field.id]}</dt>
      <dd className="field-value">
        <Control strings={strings} field={field} onCommit={onCommit} />
      </dd>
    </div>
  );
}

/** A row nobody edits: the fact and what it is
 *  called. */
function Told({
  id,
  name,
  value,
}: {
  id: string;
  name: string | undefined;
  value: string;
}) {
  return (
    <div className="field" data-field={id} data-control="told">
      <dt className="field-name text-muted">{name}</dt>
      <dd className="field-value mono">{value}</dd>
    </div>
  );
}

/**
 * One way out of a decision.
 *
 * Read rather than edited: the function decided
 * these, and where each one goes is a wire on the
 * canvas. Wiring stays a canvas gesture.
 */
function Outcome({
  strings,
  outcome,
}: {
  strings: InspectorStrings;
  outcome: DecisionOutcome;
}) {
  return (
    <div className="field" data-outcome={outcome.value} data-control="told">
      <dt className="field-name mono text-muted">{outcome.value} →</dt>
      <dd className="field-value mono">{outcome.target ?? strings.end}</dd>
    </div>
  );
}

/**
 * Which function a block runs.
 *
 * The list is the manifest put through core's one
 * rule: what fits is offered, and what does not is
 * counted and put away rather than dropped, because
 * a function missing from a list with no
 * explanation is a bug report nobody can write.
 *
 * It ends with the one row the manifest does not
 * decide — a name for a function that does not
 * exist yet, which is how the scaffolder is told
 * what stub to write.
 */
function Picker({
  strings,
  misfits,
  field,
  node,
  lib,
  onAssign,
}: {
  strings: InspectorStrings;
  misfits: Record<HandlerMisfit['kind'], string>;
  field: Extract<InspectorField, { control: 'picker' }>;
  node: WorkflowNode;
  lib: LibFunction[] | undefined;
  onAssign: (exported: string | null) => void;
}) {
  const [showing, setShowing] = useState(false);

  const judged = fitsFor(lib ?? [], node, misfits);
  const fitting = judged.filter((one) => one.fits);
  const rest = judged.filter((one) => !one.fits);

  const callout =
    node.kind === 'branch'
      ? strings.callouts.branch
      : node.kind === 'transaction'
        ? strings.callouts.transaction
        : undefined;

  return (
    <div className="field" data-field={field.id} data-control="picker">
      <dt className="field-name text-muted">{strings.fields[field.id]}</dt>
      <dd className="field-value">
        <p className="picker-value mono" data-picker-value>
          {field.value === undefined ? (
            <span className="picker-nothing">{strings.dropHere}</span>
          ) : (
            `${field.value} ▾`
          )}
        </p>

        <div className="picker">
          <p className="drawer-name mono text-muted">{strings.lib}</p>

          {judged.length === 0 ? (
            <p className="picker-empty text-muted">{strings.noLib}</p>
          ) : (
            <>
              {fitting.map((fit) => (
                <Offer
                  key={fit.fn.export}
                  fit={fit}
                  assigned={field.value}
                  onAssign={onAssign}
                />
              ))}

              {rest.length === 0 ? null : (
                <button
                  type="button"
                  className="picker-hidden text-muted"
                  data-picker-hidden
                  onClick={() => setShowing(!showing)}
                >
                  {showing
                    ? strings.hide
                    : filled(strings.hidden, String(rest.length))}
                </button>
              )}

              {!showing
                ? null
                : rest.map((fit) => (
                    <Offer
                      key={fit.fn.export}
                      fit={fit}
                      assigned={field.value}
                      onAssign={onAssign}
                    />
                  ))}
            </>
          )}

          <Named strings={strings} onAssign={onAssign} />
        </div>

        {callout === undefined ? null : (
          <Callout kind={node.kind} words={callout} />
        )}
      </dd>
    </div>
  );
}

/** One function the picker offers. Choosing the one
 *  already behind the block is the way back off
 *  it. */
function Offer({
  fit,
  assigned,
  onAssign,
}: {
  fit: LibFit;
  assigned: string | undefined;
  onAssign: (exported: string | null) => void;
}) {
  const chosen = assigned === fit.fn.export;

  return (
    <button
      type="button"
      className="lib-fn"
      data-picker-fn={fit.fn.export}
      data-state={chosen ? 'assigned' : 'default'}
      title={fit.fn.doc}
      onClick={() => onAssign(chosen ? null : fit.fn.export)}
    >
      <FunctionLines fn={fit.fn} note={fit.note} />
    </button>
  );
}

/**
 * A function that is not written yet, named.
 *
 * Enter confirms and nothing else does. A name
 * typed here is what the scaffolder writes a stub
 * for, so committing it because focus moved would
 * put a half-typed export in the document and a
 * file on disk beside it.
 */
function Named({
  strings,
  onAssign,
}: {
  strings: InspectorStrings;
  onAssign: (exported: string | null) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [typed, setTyped] = useState('');

  return (
    <div className="lib-fn picker-new" data-picker-new>
      {naming ? (
        <input
          className="mono"
          type="text"
          autoFocus
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={() => setNaming(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setNaming(false);

              return;
            }

            if (event.key !== 'Enter') return;

            event.preventDefault();
            setNaming(false);

            if (typed.trim() !== '') onAssign(typed.trim());
          }}
        />
      ) : (
        <button
          type="button"
          className="picker-name"
          onClick={() => {
            setTyped('');
            setNaming(true);
          }}
        >
          {strings.newFunction}
        </button>
      )}
    </div>
  );
}

/** What a kind's relationship with its code is,
 *  where a person would otherwise have to guess
 *  it. */
function Callout({ kind, words }: { kind: string; words: CalloutWords }) {
  return (
    <p className="callout" data-callout={kind}>
      <strong>{words.title}</strong> {words.body}
    </p>
  );
}

function Control({
  strings,
  field,
  onCommit,
}: {
  strings: InspectorStrings;
  field: InspectorField;
  onCommit: (field: InspectorField) => void;
}) {
  switch (field.control) {
    case 'choice':
      return (
        <select
          value={field.value}
          onChange={(event) =>
            onCommit({ ...field, value: event.target.value })
          }
        >
          {field.options.map((option) => (
            <option key={option} value={option}>
              {strings.options[`${field.id}.${option}`] ?? option}
            </option>
          ))}
        </select>
      );

    case 'flag':
      return (
        <input
          type="checkbox"
          checked={field.value}
          onChange={(event) =>
            onCommit({ ...field, value: event.target.checked })
          }
        />
      );

    case 'number':
      return (
        <Typed
          value={field.value === null ? '' : String(field.value)}
          multiline={false}
          onCommit={(value) =>
            onCommit({
              ...field,
              value: value.trim() === '' ? null : Number(value),
            })
          }
        />
      );

    case 'rows':
      return (
        <div className="rows">
          {field.rows.map((row, index) => (
            <div key={index} className="row">
              {row.map((inner) => (
                <Row
                  key={inner.id}
                  strings={strings}
                  field={inner}
                  onCommit={(changed) =>
                    onCommit({
                      ...field,
                      rows: field.rows.map((one, at) =>
                        at === index
                          ? one.map((cell) =>
                              cell.id === changed.id ? changed : cell,
                            )
                          : one,
                      ),
                    })
                  }
                />
              ))}
            </div>
          ))}
        </div>
      );

    // Drawn by the column itself, because it takes
    // the project's code-behind and a control here
    // is handed only the field.
    case 'picker':
      return null;

    case 'text':
    case 'prose':
      return (
        <Typed
          value={field.value}
          multiline={field.control === 'prose'}
          onCommit={(value) => onCommit({ ...field, value })}
        />
      );
  }
}

/**
 * A field somebody types into.
 *
 * It keeps what has been typed and hands it over
 * when they are done with it — which is what makes
 * a half-typed value a thing a person can pass
 * through rather than a document they cannot save.
 */
function Typed({
  value,
  multiline,
  onCommit,
}: {
  value: string;
  multiline: boolean;
  onCommit: (value: string) => void;
}) {
  const [typed, setTyped] = useState(value);

  // Escape puts the document's value back and then
  // leaves the field, and leaving a field is what
  // commits it. The flag is what keeps the second
  // from undoing the first — the state it set has
  // not been applied yet by the time blur runs.
  const abandoned = useRef(false);

  const done = (): void => {
    if (abandoned.current) {
      abandoned.current = false;

      return;
    }

    if (typed !== value) onCommit(typed);
  };

  const keys = (event: {
    key: string;
    preventDefault: () => void;
    currentTarget: { blur: () => void };
  }): void => {
    if (event.key === 'Escape') {
      abandoned.current = true;
      setTyped(value);
      event.currentTarget.blur();

      return;
    }

    if (event.key === 'Enter' && !multiline) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const shared = {
    value: typed,
    onChange: (event: { target: { value: string } }) =>
      setTyped(event.target.value),
    onBlur: done,
    onKeyDown: keys,
    spellCheck: false,
  };

  return multiline ? (
    <textarea className="mono" rows={3} {...shared} />
  ) : (
    <input className="mono" type="text" {...shared} />
  );
}
