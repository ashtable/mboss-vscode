import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import type {
  Diagnostic,
  HandlerMisfit,
  LibFunction,
  WorkflowIR,
  WorkflowNode,
} from '../core/rules.js';
import type { LiveRun } from '../runs/watch.js';
import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import type {
  BlockSubject,
  InspectorMode,
  InspectorStrings,
} from '../webview/protocol.js';
import { Callout } from '../webview/signal/Callout.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { Input, Select, TextArea } from '../webview/signal/Field.js';
import { LibFunctionItem } from '../webview/signal/LibFunctionItem.js';
import { PropertyRow, type Named } from '../webview/signal/PropertyRow.js';
import { SectionLabel } from '../webview/signal/SectionLabel.js';
import type { RunState } from '../canvas/graph.js';
import { fitsFor, signatureOf, type LibFit } from '../canvas/libFunction.js';

import { Evidence } from './EvidenceCard.js';
import { configToForm, formToConfig, type InspectorField } from './forms.js';
import { visible } from './lens.js';
import { fieldNotes } from './notes.js';
import { outcomesOf } from './outcomes.js';

/**
 * The Inspector's two faces about one block: the
 * one place a block's config is set, and what a run
 * recorded about it.
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
 * screen, in the graph's own caption. The host
 * answers a commit with the next revision, which
 * draws the form afresh, and whoever was in a field
 * is handed back to it.
 *
 * The function a block runs is the exception, and
 * is not a field at all: it is picked out of what
 * the project's code-behind offers, which the form
 * cannot see, so it goes to the host as its own
 * message and comes back as a document.
 */
/** The block the column is showing, in the document
 *  it belongs to. */
export type Selection = { ir: WorkflowIR; node: WorkflowNode };

export type InspectorProps = {
  strings: InspectorStrings;

  /** Which surface the block was picked on. A form
   *  about the same block from the other surface is
   *  a different form, never the same one again. */
  source: BlockSubject['source'];

  /** Nothing where the document does not have the
   *  block: one a run recorded and the document has
   *  lost since, which has nothing to configure. */
  selected: Selection | undefined;

  /** Which of the two faces is on screen. The
   *  host's answer, not the column's: a panel that
   *  is hidden and shown again remembers nothing. */
  mode: InspectorMode;

  /**
   * What an edit from here is made against, or
   * nothing where the block may not be edited — a
   * file that will not parse, or a proposal drawn in
   * its place. Said about the block the pane was
   * sent rather than read off a canvas around it:
   * the pane sits beside the canvas, not inside it.
   */
  revision: number | undefined;

  /** The run the block's canvas is drawing
   *  itself against, which is what the second face
   *  reads. Nothing being followed is what that face
   *  has nothing to say about. */
  run: LiveRun | undefined;

  /** What that run says about the selected block, as
   *  the graph says it — asked there rather than
   *  worked out again here, so the card and the
   *  block cannot disagree. */
  runState: RunState | undefined;

  /** What the project's code-behind offers, which
   *  is what the picker offers. */
  lib: LibFunction[] | undefined;

  /** Why a function cannot sit behind a block,
   *  shared with the palette. */
  misfits: Record<HandlerMisfit['kind'], string>;

  /** What core makes of the document, so that a
   *  finding a field on this form is a way out of
   *  can be drawn on that field. */
  diagnostics: Diagnostic[];
};

export function Inspector({
  strings,
  source,
  selected,
  mode,
  revision,
  run,
  runState,
  lib,
  misfits,
  diagnostics,
}: InspectorProps) {
  const selectedId = selected?.node.id;
  const [folded, setFolded] = useState<Set<string>>(() =>
    selected === undefined ? new Set() : initiallyFolded(selected.node),
  );

  useEffect(() => {
    setFolded(
      selected === undefined ? new Set() : initiallyFolded(selected.node),
    );
  }, [selectedId]);

  // Which control had focus as a form was drawn
  // afresh, for the form drawn in its place to hand
  // back. Read only in the commit that replaced the
  // form: once that has painted, nothing a person is
  // doing points at it any more.
  const held = useRef<Held | undefined>(undefined);

  useEffect(() => {
    held.current = undefined;
  });

  // A block is shown only while it can be edited:
  // the host lets go of the selection while a
  // proposal is showing, and the column agrees.
  const configuring =
    selected === undefined || revision === undefined ? (
      <>
        <p className="eyebrow text-muted">{strings.heading}</p>
        <p className="state text-muted">{strings.nothingSelected}</p>
      </>
    ) : (
      <Fields
        key={`${source}:${selected.node.id}:${revision}`}
        block={`${source}:${selected.node.id}`}
        held={held}
        strings={strings}
        ir={selected.ir}
        node={selected.node}
        revision={revision}
        lib={lib}
        misfits={misfits}
        diagnostics={diagnostics}
        folded={folded}
        setFolded={setFolded}
      />
    );

  // The card is handed the block's identity and its
  // policy rather than the node, because the other
  // face is where configuration is read and set: a
  // card that could reach `config` would drift into
  // being a second form.
  const node = selected?.node;

  return (
    <div className="inspector" data-inspector-mode={mode}>
      <Faces
        strings={strings}
        mode={mode}
        run={run}
        inWorkflow={selected !== undefined}
      />

      {/* One face at a time. The other reads what a
          run recorded and takes nothing off the
          document, so the two share no rows and
          drawing both would put a field somebody may
          change beside a fact they may not. */}
      {mode === 'configure' ? (
        configuring
      ) : run === undefined ? null : (
        <Evidence
          strings={strings}
          run={run}
          block={
            node === undefined
              ? undefined
              : {
                  id: node.id,
                  kind: node.kind,
                  title: node.title,
                  handler: node.handler?.export,
                  retry: node.retry,
                  body: node.kind === 'loop' ? node.config.body : undefined,
                  queue: node.kind === 'queue' ? node.config.queue : undefined,
                }
          }
          runState={runState}
          onRunPage={false}
        />
      )}
    </div>
  );
}

/**
 * The two faces, and which one is showing.
 *
 * The choice goes to the host rather than into
 * state here: this panel is torn down every time it
 * is hidden, and a face nobody remembered would
 * come back as whichever one the run implies. A face
 * with nothing to read refuses and says why: the
 * second with no run being followed, the first for a
 * block the document no longer has.
 */
function Faces({
  strings,
  mode,
  run,
  inWorkflow,
}: {
  strings: InspectorStrings;
  mode: InspectorMode;
  run: LiveRun | undefined;
  inWorkflow: boolean;
}) {
  const refused = {
    configure: !inWorkflow,
    evidence: run === undefined,
  };

  return (
    <>
      <div className="tabs" role="tablist">
        {(['configure', 'evidence'] as const).map((face) => (
          <button
            key={face}
            type="button"
            className="tab"
            role="tab"
            data-inspector-tab={face}
            aria-selected={mode === face}
            disabled={refused[face]}
            onClick={() => postToHost({ type: 'inspectorMode', mode: face })}
          >
            {strings.tabs[face]}
          </button>
        ))}
      </div>

      {refused.configure ? (
        <p className="hint">{strings.notInWorkflow}</p>
      ) : null}
      {refused.evidence ? <p className="hint">{strings.noRun}</p> : null}
    </>
  );
}

/**
 * Which control had focus, said so that it can be
 * found again in a form drawn afresh: the block the
 * form was about, the field's lens id, and which of
 * the controls under that id it was — a repeating
 * group draws the same ids once per item.
 */
type Held = { block: string; field: string; nth: number };

/** Everything in a form a keyboard can be on. */
const CONTROLS = 'input, select, textarea, button';

function Fields({
  block,
  held,
  strings,
  ir,
  node,
  revision,
  lib,
  misfits,
  diagnostics,
  folded,
  setFolded,
}: {
  /** The surface and the block, which a form handed
   *  focus back to has to share with the form that
   *  had it. */
  block: string;

  held: RefObject<Held | undefined>;

  strings: InspectorStrings;
  ir: WorkflowIR;
  node: WorkflowNode;

  /** What an edit from here is made against. */
  revision: number;

  lib: LibFunction[] | undefined;
  misfits: Record<HandlerMisfit['kind'], string>;
  diagnostics: Diagnostic[];
  folded: Set<string>;
  setFolded: Dispatch<SetStateAction<Set<string>>>;
}) {
  const [draft, setDraft] = useState(node);
  const form = configToForm(draft);
  const rows = useRef<HTMLDivElement>(null);

  // A commit comes back as the next revision, which
  // is a new form, and the control that had focus
  // goes with the old one. Its place is noted as the
  // old form is taken down — before its controls
  // leave the page, while focus can still be read —
  // and the new form hands focus back to the same
  // place. Only for a person still in this pane:
  // an edit made on the canvas draws this form
  // afresh too, and taking focus back then would
  // pull them out of the frame they are typing in.
  useLayoutEffect(() => {
    const drawn = rows.current;
    if (drawn === null) return;

    const was = held.current;
    if (was?.block === block) controlsUnder(drawn, was.field)[was.nth]?.focus();

    return () => {
      held.current = document.hasFocus() ? holding(drawn, block) : undefined;
    };
  }, []);

  // Asked of the document rather than of the
  // draft, because the findings were asked of the
  // document: the sentence under a field is the one
  // the Problems panel is showing, and it changes
  // when the document does — which is the moment
  // this column is built again anyway.
  const notes = fieldNotes(ir, node, diagnostics);

  // One form asks for a wider label column. A
  // queue's limits are told apart by the scope in
  // their names, and a scope is no use cut in half.
  const labels = form.kind === 'queue' ? 'wide' : undefined;

  // Which groups are closed. The kind says which
  // ones start that way and this holds it from
  // there: a fold is how somebody is reading the
  // form, so the document is never asked and never
  // told.
  const fold = (id: string): void =>
    setFolded((closed) => {
      const next = new Set(closed);

      if (closed.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });

  const commit = (field: InspectorField): void => {
    const next = formToConfig(draft, [field]);

    setDraft(next);
    postToHost({
      type: 'edit',
      baseRevision: revision,
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
      baseRevision: revision,
      nodeId: node.id,
      export: exported,
    });

  return (
    <>
      <p className="eyebrow" data-inspector-heading>
        {strings.heading} · {strings.kinds[form.kind]}
      </p>

      <div className="configure" ref={rows}>
        {visible(form.fields, folded).map((field) => {
          if (field.control === 'section')
            return (
              <Section
                key={field.id}
                id={field.id}
                name={strings.fields[field.id]}
                hint={strings.hints[field.id]}
                open={!folded.has(field.id)}
                onFold={() => fold(field.id)}
              />
            );

          if (field.control === 'picker')
            return (
              <Picker
                key={field.id}
                strings={strings}
                misfits={misfits}
                field={field}
                node={draft}
                lib={lib}
                labels={labels}
                onAssign={assign}
              />
            );

          return (
            <Row
              key={field.id}
              strings={strings}
              field={field}
              labels={labels}
              notes={notes[field.id]}
              onCommit={commit}
            />
          );
        })}

        {outcomesOf(ir, node).map((outcome) => (
          <PropertyRow
            key={outcome.value}
            label={<span data-mono="">{outcome.value} →</span>}
            labels={labels}
            value={outcome.target ?? strings.end}
            mono
            hook={{ outcome: outcome.value }}
          />
        ))}

        {form.kind !== 'transaction' ? null : (
          <>
            {/* Read rather than edited: which database
                a transaction commits to is the
                project's, not the block's. */}
            <PropertyRow
              label={strings.fields.database}
              value={strings.database}
              mono
              hook={{ field: 'database' }}
            />

            {/* The one kind with no retry fields.
                Told rather than left off: eight
                kinds carry the three fields, and a
                row that is simply missing from the
                ninth reads as an oversight instead
                of as the answer. */}
            <PropertyRow
              label={strings.retryPolicy}
              value={strings.retry}
              mono
              hook={{ field: 'retry' }}
            />
          </>
        )}
      </div>
    </>
  );
}

/** Where focus is in a form, if it is in one. */
function holding(form: HTMLElement, block: string): Held | undefined {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !form.contains(focused)) return;

  const field = focused.closest<HTMLElement>('[data-field]')?.dataset.field;
  if (field === undefined) return;

  const nth = controlsUnder(form, field).indexOf(focused);

  return nth === -1 ? undefined : { block, field, nth };
}

/** Every control under a lens id, in the order the
 *  form draws them. */
function controlsUnder(form: HTMLElement, field: string): HTMLElement[] {
  return [...form.querySelectorAll<HTMLElement>(CONTROLS)].filter(
    (control) =>
      control.closest<HTMLElement>('[data-field]')?.dataset.field === field,
  );
}

function initiallyFolded(node: WorkflowNode): Set<string> {
  return new Set(
    configToForm(node)
      .fields.filter((field) => field.control === 'section' && field.collapsed)
      .map((field) => field.id),
  );
}

/**
 * One field, in the row its label names.
 *
 * A repeating group is the exception: its items are
 * rows of their own, so its label heads the group
 * rather than sitting beside a stack of rows it
 * would leave no room for.
 */
function Row({
  strings,
  field,
  labels,
  notes,
  onCommit,
}: {
  strings: InspectorStrings;
  field: InspectorField;
  labels: 'wide' | undefined;

  /** What core says about the block that this box
   *  is a way out of. Drawn here rather than only
   *  on the block, because this is where it would
   *  be put right. */
  notes?: string[];

  onCommit: (field: InspectorField) => void;
}) {
  switch (field.control) {
    case 'rows':
      return (
        <div className="form-group" data-field={field.id} data-control="rows">
          <SectionLabel>{strings.fields[field.id]}</SectionLabel>

          <div className="rows">
            {field.rows.map((row, index) => (
              <div key={index} className="row">
                {row.map((inner) => (
                  <Row
                    key={inner.id}
                    strings={strings}
                    field={inner}
                    labels={labels}
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
        </div>
      );

    // Drawn by the column itself: a picker takes the
    // project's code-behind and a header folds the
    // rows after it, and a row is handed only its
    // own field.
    case 'picker':
    case 'section':
      return null;

    default:
      return (
        <PropertyRow
          label={strings.fields[field.id]}
          labels={labels}
          field={field.id}
          note={notes?.join(' ')}
          control={(named) => (
            <Control
              strings={strings}
              field={field}
              named={named}
              onCommit={onCommit}
            />
          )}
        />
      );
  }
}

/**
 * A group's header, and the way it folds.
 *
 * The whole header is the button rather than a
 * caret beside a label, because what a person is
 * aiming at is the group and the label is the
 * biggest thing on the row. `aria-expanded` is the
 * only place the fold is said out loud, and the
 * marker is turned by it, so the two cannot
 * disagree.
 */
function Section({
  id,
  name,
  hint,
  open,
  onFold,
}: {
  id: string;
  name: string | undefined;

  /** What the group needs saying about it that no
   *  one field in it does. Hidden with the fields
   *  while the group is folded: a folded group
   *  shows the way back in and nothing else. */
  hint: string | undefined;

  open: boolean;
  onFold: () => void;
}) {
  return (
    <div className="form-section" data-field={id} data-control="section">
      <button
        type="button"
        className="section-head section-label"
        aria-expanded={open}
        onClick={onFold}
      >
        <span className="section-mark" aria-hidden="true">
          ▾
        </span>
        {name}
      </button>

      {hint === undefined || !open ? null : (
        <FieldHint hookClass="field-note">{hint}</FieldHint>
      )}
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
  labels,
  onAssign,
}: {
  strings: InspectorStrings;
  misfits: Record<HandlerMisfit['kind'], string>;
  field: Extract<InspectorField, { control: 'picker' }>;
  node: WorkflowNode;
  lib: LibFunction[] | undefined;
  labels: 'wide' | undefined;
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
    <div className="picker-field" data-field={field.id} data-control="picker">
      {/* The value is its own mark, and the way to
          the code sits outside it: what the caret
          says can be changed is the name, not the
          row it is drawn on. The list goes under the
          row rather than into its value, where the
          label column would leave the signatures
          nothing to be read in. */}
      <PropertyRow
        label={strings.fields[field.id]}
        labels={labels}
        mono
        value={
          field.value === undefined ? (
            <span className="picker-nothing" data-picker-value>
              {strings.dropHere}
            </span>
          ) : (
            <>
              <span data-picker-value>{`${field.value} ▾`}</span>
              <button
                type="button"
                className="picker-open"
                data-open-function
                onClick={() =>
                  postToHost({ type: 'openFunction', nodeId: node.id })
                }
              >
                {strings.openFunction}
              </button>
            </>
          )
        }
      />

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

      {/* What a kind's relationship with its code
          is, where a person would otherwise have to
          guess it. */}
      {callout === undefined ? null : (
        <Callout
          tone="info"
          title={callout.title}
          hook={{ callout: node.kind }}
        >
          {callout.body}
        </Callout>
      )}
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
    <LibFunctionItem
      as="button"
      name={fit.fn.export}
      signature={signatureOf(fit.fn)}
      note={fit.note}
      state={chosen ? 'assigned' : 'compatible'}
      title={fit.fn.doc}
      onClick={() => onAssign(chosen ? null : fit.fn.export)}
      hook={{ 'picker-fn': fit.fn.export }}
    />
  );
}

/**
 * A function that is not written yet, named.
 *
 * Enter confirms and nothing else does. A name
 * typed here is what the scaffolder writes a stub
 * for, so committing it because focus moved would
 * put a half-typed export in the document and a
 * file on disk beside it. Escape, or leaving the
 * field, puts the row back.
 */
function Named({
  strings,
  onAssign,
}: {
  strings: InspectorStrings;
  onAssign: (exported: string | null) => void;
}) {
  const [naming, setNaming] = useState(false);

  return (
    <div className="lib-fn picker-new" data-picker-new>
      {naming ? (
        <Input
          value=""
          mono
          autoFocus
          label={strings.newFunction}
          commitOnBlur={false}
          onCommit={(typed) => {
            setNaming(false);

            if (typed.trim() !== '') onAssign(typed.trim());
          }}
          onAbandon={() => setNaming(false)}
        />
      ) : (
        <button
          type="button"
          className="picker-name"
          onClick={() => setNaming(true)}
        >
          {strings.newFunction}
        </button>
      )}
    </div>
  );
}

/** The control a field is set with, in the row that
 *  names it. */
function Control({
  strings,
  field,
  named,
  onCommit,
}: {
  strings: InspectorStrings;
  field: InspectorField;
  named: Named;
  onCommit: (field: InspectorField) => void;
}) {
  switch (field.control) {
    case 'choice':
      return (
        <Select
          {...named}
          mono
          value={field.value}
          options={field.options.map((option) => ({
            value: option,
            label: strings.options[`${field.id}.${option}`] ?? option,
          }))}
          onChange={(value) => onCommit({ ...field, value })}
        />
      );

    case 'flag':
      return (
        <input
          type="checkbox"
          id={named.id}
          aria-describedby={named.describedBy}
          checked={field.value}
          onChange={(event) =>
            onCommit({ ...field, value: event.target.checked })
          }
        />
      );

    case 'number':
      return (
        <Input
          {...named}
          mono
          value={field.value === null ? '' : String(field.value)}
          onCommit={(value) =>
            onCommit({
              ...field,
              value: value.trim() === '' ? null : Number(value),
            })
          }
        />
      );

    case 'text':
      return (
        <Input
          {...named}
          mono
          value={field.value}
          onCommit={(value) => onCommit({ ...field, value })}
        />
      );

    case 'prose':
      return (
        <TextArea
          {...named}
          mono
          value={field.value}
          grow={{ minLines: 3, maxLines: 12 }}
          onCommit={(value) => onCommit({ ...field, value })}
        />
      );

    // Drawn a level up, in rows and headers of their
    // own rather than as a control in one row.
    case 'rows':
    case 'picker':
    case 'section':
      return null;
  }
}
