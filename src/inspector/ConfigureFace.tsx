import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';

import type {
  HandlerMisfit,
  LibFunction,
  WorkflowNode,
} from '../core/rules.js';
import { filled } from '../webview/fill.js';
import type {
  DecisionOutcome,
  InspectorStrings,
  RunInputView,
} from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { Callout } from '../webview/signal/Callout.js';
import { EmptyState } from '../webview/signal/EmptyState.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { Input, Select, TextArea } from '../webview/signal/Field.js';
import { LibFunctionItem } from '../webview/signal/LibFunctionItem.js';
import { PropertyRow, type Named } from '../webview/signal/PropertyRow.js';
import { SectionLabel } from '../webview/signal/SectionLabel.js';
import { fitsFor, signatureOf, type LibFit } from '../canvas/libFunction.js';

import type { FormGroup, FormLine, FormPlan, InspectorField } from './forms.js';
import { pickerAfter, type NumberField, type PickerEvent } from './lens.js';
import { Recorded } from './Value.js';

/**
 * The Configure face: the one place a block's
 * config is set.
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
 *
 * With no revision to edit against — a proposal
 * drawn over the document — every field is still
 * drawn, so what the block is set to can be read,
 * and none of them can be changed.
 *
 * A trigger is the one block with no function. It
 * is how DBOS starts the workflow, so its form says
 * how it starts, and in place of the function it
 * reflects the input a run from the Runs view would
 * start the workflow with, and offers that run.
 */

/**
 * Which control had focus, said so that it can be
 * found again in a form drawn afresh: the block the
 * form was about, the field's lens id, and which of
 * the controls under that id it was — a repeating
 * group draws the same ids once per item.
 */
export type Held = { block: string; field: string; nth: number };

/** Everything in a form a keyboard can be on. */
const CONTROLS = 'input, select, textarea, button';

/**
 * Hands focus back to the control somebody was in
 * when a commit drew this part of the form afresh.
 *
 * A commit comes back as the next revision, which
 * is a new form, and the control that had focus
 * goes with the old one. Its place is noted as the
 * old form is taken down — before its controls
 * leave the page, while focus can still be read —
 * and the part drawn in its place hands focus back.
 * Only for a person still in this pane: an edit
 * made on the canvas draws the form afresh too, and
 * taking focus back then would pull them out of the
 * frame they are typing in.
 *
 * The block's name and its fields are drawn apart,
 * one above the faces and one inside, so each notes
 * a place only when focus is in it, and the one
 * that was not leaves the other's note alone.
 */
export function useHandsBack<E extends HTMLElement>(
  held: RefObject<Held | undefined>,
  block: string,
): RefObject<E | null> {
  const drawn = useRef<E>(null);

  useLayoutEffect(() => {
    const form = drawn.current;
    if (form === null) return;

    const was = held.current;
    if (was?.block === block) controlsUnder(form, was.field)[was.nth]?.focus();

    return () => {
      const at = document.hasFocus() ? holding(form, block) : undefined;
      if (at !== undefined) held.current = at;
    };
  }, []);

  return drawn;
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

/**
 * The block's name, as the field it is renamed in.
 *
 * Over both faces rather than in either, because
 * the name is what the pane is about whichever
 * question it is answering. No label sits beside
 * it, so it carries its own name.
 */
export function TitleField({
  strings,
  field,
  block,
  held,
  readOnly,
  onCommit,
}: {
  strings: InspectorStrings;
  field: Extract<InspectorField, { control: 'text' }>;
  block: string;
  held: RefObject<Held | undefined>;
  readOnly: boolean;
  onCommit: (field: InspectorField) => void;
}) {
  const drawn = useHandsBack<HTMLSpanElement>(held, block);
  const id = useId();

  return (
    <span className="inspector-name" data-field={field.id} ref={drawn}>
      <Input
        id={id}
        value={field.value}
        label={strings.blockTitle}
        readOnly={readOnly}
        hook={{ 'inspector-heading': '' }}
        onCommit={(value) => onCommit({ ...field, value })}
      />
    </span>
  );
}

/**
 * What the block is set to, as a form.
 *
 * Drawn from the document's node and the draft
 * beside it rather than from either alone: the
 * document is what is saved, and the draft is what
 * somebody is part-way through typing, so the form
 * has to read both to show a field half set without
 * claiming the document says so.
 */
export function ConfigureFace({
  strings,
  block,
  held,
  workflow,
  node,
  draft,
  plan,
  readOnly,
  refused,
  proposal,
  lib,
  misfits,
  notes,
  outcomes,
  runInput,
  folded,
  setFolded,
  onCommit,
  onAssign,
  onOpenFunction,
  onAskAgent,
  onRunTrigger,
  onOpenRunInput,
}: {
  strings: InspectorStrings;

  /** The surface and the block, which a form handed
   *  focus back to has to share with the form that
   *  had it. */
  block: string;

  held: RefObject<Held | undefined>;

  /** The workflow's name, as the document says it. */
  workflow: string;

  /** The block as the document has it. */
  node: WorkflowNode;

  /** The block as the person has set it so far. */
  draft: WorkflowNode;

  /** What the block is set to, as the form answers
   *  it: the lines to draw, under their groups. */
  plan: FormPlan;

  readOnly: boolean;

  /** The field whose last commit was no value for
   *  it, if any: its box keeps the text and says so. */
  refused: string | undefined;

  /** Why nothing here can be changed, when a
   *  proposal is the reason. */
  proposal: string | undefined;

  lib: LibFunction[] | undefined;
  misfits: Record<HandlerMisfit['kind'], string>;

  /** What core says about the block, beside the
   *  field that is a way out of each finding: the
   *  sentence the Problems panel is showing, which
   *  changes when the document does — the moment
   *  this face is built again anyway. */
  notes: Record<string, string[]>;

  /** Where each way out of a decided branch leads. */
  outcomes: DecisionOutcome[];

  /** What the Runs view holds, beside a trigger. */
  runInput: RunInputView | undefined;

  folded: Set<string>;
  setFolded: Dispatch<SetStateAction<Set<string>>>;
  onCommit: (field: InspectorField) => void;
  onAssign: (exported: string | null) => void;
  onOpenFunction: () => void;
  onAskAgent: () => void;
  onRunTrigger: (workflow: string) => void;
  onOpenRunInput: () => void;
}) {
  const rows = useHandsBack<HTMLDivElement>(held, block);
  const groups = useId();

  // Two ids read differently by kind, and the rest
  // read the same on every one.
  const word = (id: string): string | undefined =>
    strings.fieldsByKind[plan.kind]?.[id] ?? strings.fields[id];

  // What a group needs saying that no one line in it
  // does is said once its lines are all drawn, after
  // the last of them; its label only names it. A
  // folded group draws no lines, and so says nothing
  // after them either.
  const saidAfter = (group: FormGroup): ReactNode => {
    if (folded.has(group.id)) return null;

    if (group.configured) {
      return group.retries ? (
        <FieldHint hook={{ 'retry-hint': '' }}>
          {strings.durationCoversTries}
        </FieldHint>
      ) : null;
    }

    const hint = strings.hints[group.id];

    return hint === undefined ? null : (
      <FieldHint hook={{ 'group-hint': group.id }}>{hint}</FieldHint>
    );
  };

  // A trigger on a schedule is started by DBOS's
  // scheduler and never by Run. Read off the
  // document rather than the saved file, so a switch
  // not saved yet says what the file will do once it
  // is.
  const scheduled = node.kind === 'trigger' && node.config.mode === 'schedule';

  // Where a run can be started from this card: only
  // a trigger's, and never one on a schedule, which
  // the card says in the run's place.
  const start =
    node.kind !== 'trigger' || scheduled ? undefined : runInput?.start;

  const labels = plan.labels;

  // Which groups are closed. The kind says which
  // ones start that way and this holds it from
  // there: a fold is how somebody is reading the
  // form, so the document is never asked and never
  // told — which is also why a form nobody may
  // change still folds.
  const fold = (id: string): void =>
    setFolded((closed) => {
      const next = new Set(closed);

      if (closed.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });

  // One group's header, as the group is: the one
  // that folds is the way into what it hides.
  const drawGroup = (group: FormGroup): ReactNode =>
    group.opensFolded ? (
      <Fold
        key={group.id}
        id={group.id}
        name={word(group.id)}
        open={!folded.has(group.id)}
        onFold={() => fold(group.id)}
      />
    ) : (
      <Group
        key={group.id}
        id={group.id}
        labelId={`${groups}${group.id}`}
        name={word(group.id)}
        mark={group.configured ? strings.configured : undefined}
      />
    );

  // One line, drawn as what it is, in the group it
  // is under.
  const drawLine = (
    line: FormLine,
    group: FormGroup | undefined,
  ): ReactNode => {
    // The workflow a trigger starts is the file's,
    // read rather than set: the saved workflow's
    // name where the Runs view has one, which is the
    // name a run starts.
    if (line.at === 'value') {
      return (
        <PropertyRow
          key={line.id}
          label={strings.workflow}
          value={runInput?.saved ?? workflow}
          mono
          hook={{ workflow: '' }}
        />
      );
    }

    // A limit's two halves share the line drawn
    // under the word the limit is called by.
    if (line.at === 'pair') {
      return (
        <Pair
          key={line.id}
          strings={strings}
          word={word}
          name={line.id}
          pair={{ per: line.per, sec: line.sec }}
          labels={labels}
          notes={[...(notes[line.per.id] ?? []), ...(notes[line.sec.id] ?? [])]}
          refused={
            refused === line.per.id || refused === line.sec.id
              ? strings.notAValue
              : undefined
          }
          readOnly={readOnly}
          onCommit={onCommit}
        />
      );
    }

    const { field } = line;

    if (field.control === 'picker') {
      // A picker that opens a group is named by that
      // group's label, which says the same word.
      const named =
        group !== undefined && !group.opensFolded && group.lines[0] === line
          ? `${groups}${group.id}`
          : undefined;

      return (
        <Picker
          key={field.id}
          strings={strings}
          misfits={misfits}
          field={field}
          label={word(field.id)}
          labelledBy={named}
          node={draft}
          lib={lib}
          readOnly={readOnly}
          onAssign={onAssign}
        />
      );
    }

    return (
      <Row
        key={field.id}
        strings={strings}
        word={word}
        field={field}
        labels={labels}
        notes={notes[field.id]}
        refused={refused === field.id ? strings.notAValue : undefined}
        readOnly={readOnly}
        onCommit={onCommit}
      />
    );
  };

  return (
    <>
      {proposal === undefined ? null : (
        <FieldHint tone="agent" hook={{ proposal: '' }}>
          {proposal}
        </FieldHint>
      )}

      <div className="configure" ref={rows}>
        {plan.loose.map((line) => drawLine(line, undefined))}

        {plan.groups.map((group) => (
          <Fragment key={group.id}>
            {drawGroup(group)}
            {folded.has(group.id)
              ? null
              : group.lines.map((line) => drawLine(line, group))}
            {saidAfter(group)}
          </Fragment>
        ))}

        {/* A trigger is the one block with no
            function: it is how DBOS starts the
            workflow. */}
        {plan.kind !== 'trigger' ? null : (
          <FieldHint hook={{ 'owns-no-function': '' }}>
            {strings.triggerOwnsNoFunction}
          </FieldHint>
        )}

        {outcomes.map((outcome) => (
          <PropertyRow
            key={outcome.value}
            label={<span data-mono="">{outcome.value} →</span>}
            labels={labels}
            value={outcome.target ?? strings.end}
            mono
            hook={{ outcome: outcome.value }}
          />
        ))}

        {plan.kind !== 'transaction' ? null : (
          <>
            {/* Read rather than edited: which database
                a transaction commits to is the
                project's, not the block's. */}
            <Group id="database" name={word('database')} />
            <PropertyRow
              label={strings.commitsTo}
              value={strings.database}
              mono
              hook={{ database: '' }}
            />

            {/* The one kind with no retry fields.
                Told rather than left off: eight
                kinds carry the group, and a group
                that is simply missing from the ninth
                reads as an oversight instead of as
                the answer. */}
            <Group
              id="retryPolicy"
              name={word('retryPolicy')}
              hint={strings.retry}
            />
          </>
        )}
      </div>

      {scheduled ? (
        <FieldHint hook={{ 'on-schedule': '' }}>
          {strings.runsOnSchedule}
        </FieldHint>
      ) : node.kind !== 'trigger' || runInput === undefined ? null : (
        <RunSample strings={strings} input={runInput} onOpen={onOpenRunInput} />
      )}

      <Actions
        strings={strings}
        node={node}
        readOnly={readOnly}
        start={start}
        onOpenFunction={onOpenFunction}
        onAskAgent={onAskAgent}
        onRunTrigger={onRunTrigger}
      />
    </>
  );
}

/**
 * What Run with this input would start the
 * workflow with: the Runs view's input box, read
 * there and never written, so the box stays the one
 * place a run's input is typed.
 *
 * Drawn as the host worked it out. An empty box is
 * a run with no input, and text that is not JSON is
 * drawn as it was typed beside the refusal Run
 * would give. Where the Runs view is set to another
 * workflow the card says that Run switches it, and
 * where the Runs view's last start of this workflow
 * was refused, why.
 */
function RunSample({
  strings,
  input,
  onOpen,
}: {
  strings: InspectorStrings;
  input: RunInputView;
  onOpen: () => void;
}) {
  const { sample, switches, refused } = input;

  return (
    <section className="run-sample" data-run-sample="">
      <SectionLabel>{strings.sampleInput}</SectionLabel>

      {sample === undefined ? (
        <FieldHint hook={{ 'no-input': '' }}>{strings.noInputRun}</FieldHint>
      ) : (
        <Recorded
          value={sample.value}
          words={{
            inline: strings.inline,
            artifact: strings.artifact,
            open: strings.openInput,
          }}
          onOpen={onOpen}
          openHook={{ 'open-run-input': '' }}
        />
      )}

      {sample === undefined || sample.json ? null : (
        <FieldHint tone="warn" hook={{ 'not-json': '' }}>
          {strings.notJsonYet}
        </FieldHint>
      )}

      {switches === undefined ? null : (
        <FieldHint tone="warn" hook={{ 'other-workflow': '' }}>
          {switches}
        </FieldHint>
      )}

      {refused === undefined ? null : (
        <FieldHint tone="fail" hook={{ 'run-problem': '' }}>
          {refused}
        </FieldHint>
      )}

      <FieldHint hook={{ 'used-by-run': '' }}>
        {strings.usedByRunOnly}
      </FieldHint>
    </section>
  );
}

/**
 * The ways out of the form, at its foot: to the code
 * the block runs, to a run, and to the agent.
 *
 * The code only where a function is behind the
 * block, since there is nothing else to open. A run
 * only where the card offers one, and in its place
 * the sentence saying why where the card cannot
 * start it. The run and the agent only where the
 * block may be changed: what holds a block back is
 * an agent's proposal waiting on the document, and a
 * question put over it, or a run of it, would be
 * about a block that is about to be something else.
 */
function Actions({
  strings,
  node,
  readOnly,
  start,
  onOpenFunction,
  onAskAgent,
  onRunTrigger,
}: {
  strings: InspectorStrings;
  node: WorkflowNode;
  readOnly: boolean;

  /** Whether Run would start what the canvas shows,
   *  or why not; nothing where the card offers no
   *  run at all. */
  start: RunInputView['start'] | undefined;

  onOpenFunction: () => void;
  onAskAgent: () => void;
  onRunTrigger: (workflow: string) => void;
}) {
  const opens = node.handler !== undefined;

  if (!opens && readOnly) return null;

  return (
    <div className="configure-actions" data-configure-actions="">
      {opens ? (
        <Button
          variant="secondary"
          ink="brand"
          hook={{ 'open-function': '' }}
          onClick={onOpenFunction}
        >
          {strings.openHandler}
        </Button>
      ) : null}

      {readOnly || start === undefined ? null : start.ok ? (
        <Button
          variant="secondary"
          ink="brand"
          hook={{ 'run-trigger': '' }}
          onClick={() => onRunTrigger(start.workflow)}
        >
          {strings.runWithInput}
        </Button>
      ) : (
        <FieldHint hook={{ 'run-refused': '' }}>{start.reason}</FieldHint>
      )}

      {readOnly ? null : (
        <Button variant="quiet" hook={{ 'ask-block': '' }} onClick={onAskAgent}>
          {strings.askAgent}
        </Button>
      )}
    </div>
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
  word,
  field,
  labels,
  notes,
  refused,
  readOnly,
  onCommit,
}: {
  strings: InspectorStrings;

  /** What a field is called on the block's kind. */
  word: (id: string) => string | undefined;

  field: InspectorField;
  labels: 'wide' | undefined;

  /** What core says about the block that this box
   *  is a way out of. Drawn here rather than only
   *  on the block, because this is where it would
   *  be put right. */
  notes?: string[];

  /** What was typed here that is no value, kept in
   *  the box and said under it. */
  refused?: string;

  readOnly: boolean;

  onCommit: (field: InspectorField) => void;
}) {
  switch (field.control) {
    case 'rows':
      return (
        <div className="form-group" data-field={field.id} data-control="rows">
          <SectionLabel>{word(field.id)}</SectionLabel>

          <div className="rows">
            {field.rows.map((row, index) => (
              <div key={index} className="row">
                {row.map((inner) => (
                  <Row
                    key={inner.id}
                    strings={strings}
                    word={word}
                    field={inner}
                    labels={labels}
                    readOnly={readOnly}
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

    // Drawn by the face itself: a picker takes the
    // project's code-behind and a header folds the
    // rows after it, and a row is handed only its
    // own field.
    case 'picker':
    case 'section':
      return null;

    default:
      return (
        <PropertyRow
          label={word(field.id)}
          labels={labels}
          field={field.id}
          unit={strings.units[field.id]}
          note={notes?.join(' ')}
          refused={refused}
          control={(named) => (
            <Control
              strings={strings}
              field={field}
              named={named}
              readOnly={readOnly}
              onCommit={onCommit}
            />
          )}
        />
      );
  }
}

/**
 * A limit set as a count and the period it is
 * counted over, in one row named for the limit.
 *
 * Each half stays a field of its own and commits on
 * its own, since the lens behind either half writes
 * the whole limit — the other half beside it, or
 * nothing once either is emptied — so the row only
 * has to draw two boxes. Each box is named for its
 * half, because the label beside them names both.
 */
function Pair({
  strings,
  word,
  name,
  pair,
  labels,
  notes,
  refused,
  readOnly,
  onCommit,
}: {
  strings: InspectorStrings;
  word: (id: string) => string | undefined;

  /** The id of the word the limit is called by. */
  name: string;

  pair: { per: NumberField; sec: NumberField };
  labels: 'wide' | undefined;

  /** What core says about the block that either box
   *  is a way out of. */
  notes: string[];

  /** What was typed in either half that is no value. */
  refused?: string;

  readOnly: boolean;
  onCommit: (field: InspectorField) => void;
}) {
  return (
    <PropertyRow
      label={word(name)}
      labels={labels}
      unit={strings.units[pair.sec.id]}
      note={notes.length === 0 ? undefined : notes.join(' ')}
      refused={refused}
      controls={[pair.per, pair.sec].map((half) => ({
        field: half.id,
        control: (named: Named) => (
          <Control
            strings={strings}
            field={half}
            named={named}
            label={word(half.id)}
            readOnly={readOnly}
            onCommit={onCommit}
          />
        ),
      }))}
    />
  );
}

/**
 * A group's label, over the rows it names.
 *
 * Only a name, because a group is read whole. Where
 * every row in it comes from the same place — the
 * configuration, rather than anything a run
 * recorded — the label says so once, in a quiet
 * word after it, and the rows say nothing. What the
 * group needs saying that no one row does is said
 * after its rows, by the form that draws them; a
 * group with no rows to follow says it here, under
 * its label.
 */
function Group({
  id,
  labelId,
  name,
  mark,
  hint,
}: {
  id: string;

  /** Where a control the group opens with is named
   *  by this label. */
  labelId?: string;

  name: string | undefined;

  /** The word saying the rows are configuration. */
  mark?: string;

  hint?: string;
}) {
  return (
    <div className="form-section" data-field={id} data-control="section">
      <SectionLabel id={labelId}>
        {name}
        {mark === undefined ? null : (
          <>
            {' '}
            <span className="property-provenance" data-provenance="configured">
              · {mark}
            </span>
          </>
        )}
      </SectionLabel>

      {hint === undefined ? null : (
        <FieldHint hookClass="field-note">{hint}</FieldHint>
      )}
    </div>
  );
}

/**
 * The one group that folds: a header over the knobs
 * nobody turns often, and the way it folds.
 *
 * The whole header is the button rather than a
 * caret beside a label, because what a person is
 * aiming at is the group and the label is the
 * biggest thing on the row. `aria-expanded` is the
 * only place the fold is said out loud, and the
 * marker is turned by it, so the two cannot
 * disagree.
 *
 * The one control anybody presses draws it, so the
 * header answers a pointer and carries an edge in
 * the themes that draw one wherever any other
 * quiet control does.
 */
function Fold({
  id,
  name,
  open,
  onFold,
}: {
  id: string;
  name: string | undefined;
  open: boolean;
  onFold: () => void;
}) {
  return (
    <div className="form-section" data-field={id} data-control="section">
      <Button
        variant="quiet"
        hookClass="section-head"
        expanded={open}
        onClick={onFold}
      >
        <span className="section-mark" aria-hidden="true">
          ▾
        </span>
        {name}
      </Button>
    </div>
  );
}

/**
 * Which function a block runs.
 *
 * At rest it is one row: the function the block
 * runs, or the slot one goes in. Pressing that row
 * opens the list of what could go there instead,
 * because a list always drawn spends most of the
 * pane on functions the block does not run.
 *
 * The list is the manifest put through core's one
 * rule: what fits is offered, and what does not is
 * counted and put away rather than dropped, because
 * a function missing from a list with no
 * explanation is a bug report nobody can write. It
 * ends with the one row the manifest does not
 * decide — a name for a function that does not
 * exist yet, which is how the scaffolder is told
 * what stub to write.
 *
 * Whether the list is open is this row's own, and
 * lasts as long as the form does: the pane is drawn
 * afresh on every tick of a run, and an open list
 * is how somebody is reading this block, while a
 * different block, or the next revision, is a form
 * of its own.
 */
function Picker({
  strings,
  misfits,
  field,
  label,
  labelledBy,
  node,
  lib,
  readOnly,
  onAssign,
}: {
  strings: InspectorStrings;
  misfits: Record<HandlerMisfit['kind'], string>;
  field: Extract<InspectorField, { control: 'picker' }>;

  /** What the field is called, drawn over the row
   *  unless a group's label already says it. */
  label: string | undefined;

  /** The group label that names the picker, where
   *  one does. */
  labelledBy: string | undefined;

  node: WorkflowNode;
  lib: LibFunction[] | undefined;
  readOnly: boolean;
  onAssign: (exported: string | null) => void;
}) {
  const [picking, setPicking] = useState({ open: false, naming: false });
  const [showing, setShowing] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLButtonElement>(null);
  const own = useId();

  const after = (event: PickerEvent): void =>
    setPicking((was) => pickerAfter(event, was));

  // A press anywhere else, or Escape, closes an open
  // list. Heard on the whole page because either can
  // happen while focus is nowhere in the picker.
  // Focus goes back to the row that opened the list
  // only when it was inside the list, which is about
  // to leave the page.
  useEffect(() => {
    if (!picking.open) return;

    const pressed = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) after('outside');
    };

    const keyed = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;

      const inside = root.current?.contains(document.activeElement) === true;

      after('escape');
      if (inside) current.current?.focus();
    };

    document.addEventListener('pointerdown', pressed);
    document.addEventListener('keydown', keyed);

    return () => {
      document.removeEventListener('pointerdown', pressed);
      document.removeEventListener('keydown', keyed);
    };
  }, [picking.open]);

  const judged = fitsFor(lib ?? [], node, misfits);
  const fitting = judged.filter((one) => one.fits);
  const rest = judged.filter((one) => !one.fits);

  // Looked up rather than taken from what fits: the
  // function a block runs may not fit it, or may be
  // missing from a manifest that was read before it
  // was written.
  const assigned =
    field.value === undefined
      ? undefined
      : judged.find((one) => one.fn.export === field.value);

  const pick = (exported: string | null): void => {
    after('pick');
    current.current?.focus();
    onAssign(exported);
  };

  return (
    <div
      className="picker-field"
      data-field={field.id}
      data-control="picker"
      role="group"
      aria-labelledby={labelledBy ?? own}
      ref={root}
    >
      {labelledBy === undefined ? (
        <span className="property-label" id={own}>
          {label}
        </span>
      ) : null}

      {/* Where the name is all anybody knows — the
          code has not been read, or does not have
          it — the row carries no signature and no
          tick. With nothing that may be changed it
          is not a control at all. */}
      <LibFunctionItem
        as={readOnly ? 'div' : 'button'}
        ref={current}
        name={field.value ?? strings.dropHere}
        signature={
          assigned === undefined ? undefined : signatureOf(assigned.fn)
        }
        note={assigned?.note}
        state={
          field.value === undefined
            ? 'empty'
            : assigned === undefined
              ? 'compatible'
              : 'assigned'
        }
        title={assigned?.fn.doc}
        expanded={readOnly ? undefined : picking.open}
        onClick={readOnly ? undefined : () => after('press-current')}
        hook={{ 'picker-current': '' }}
      />

      {picking.open ? (
        <div className="picker-list">
          {judged.length === 0 ? (
            <EmptyState kind="empty" title={strings.noLib} />
          ) : (
            <>
              {fitting.map((fit) => (
                <Offer
                  key={fit.fn.export}
                  fit={fit}
                  assigned={field.value}
                  onAssign={pick}
                />
              ))}

              {rest.length === 0 ? null : (
                <Button
                  variant="quiet"
                  hook={{ 'picker-hidden': '' }}
                  onClick={() => setShowing(!showing)}
                >
                  {showing
                    ? strings.hide
                    : filled(strings.hidden, String(rest.length))}
                </Button>
              )}

              {!showing
                ? null
                : rest.map((fit) => (
                    <Offer
                      key={fit.fn.export}
                      fit={fit}
                      assigned={field.value}
                      onAssign={pick}
                    />
                  ))}
            </>
          )}

          <NewFunction
            strings={strings}
            naming={picking.naming}
            onStart={() => after('start-naming')}
            onEnd={() => after('end-naming')}
            onName={pick}
          />
        </div>
      ) : readOnly ? null : (
        // What the list would say about itself, said
        // while it is closed: a count of what the
        // rule put away is a reason to open it.
        <FieldHint hook={{ 'picker-lib': '' }}>
          {lib === undefined
            ? strings.libNotScanned
            : filled(strings.libAtRest, String(rest.length))}
        </FieldHint>
      )}

      {/* What a kind's relationship with its code
          is, where a person would otherwise have to
          guess it: a branch owns none of it, in a
          box of its own because it changes what the
          picker offers, and a transaction's writes
          commit with the record that it ran, said
          under the function it is about. */}
      {node.kind === 'branch' ? (
        <Callout
          tone="info"
          title={strings.callouts.branch.title}
          hook={{ callout: node.kind }}
        >
          {strings.callouts.branch.body}
        </Callout>
      ) : null}

      {node.kind === 'transaction' ? (
        <FieldHint hook={{ 'commit-hint': '' }}>{strings.oneCommit}</FieldHint>
      ) : null}
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
 * Starting a name is an action, so it is a Button.
 * Enter confirms and nothing else does. A name
 * typed here is what the scaffolder writes a stub
 * for, so committing it because focus moved would
 * put a half-typed export in the document and a
 * file on disk beside it. Escape, or leaving the
 * field, puts the row back and leaves the list
 * open.
 */
function NewFunction({
  strings,
  naming,
  onStart,
  onEnd,
  onName,
}: {
  strings: InspectorStrings;
  naming: boolean;
  onStart: () => void;
  onEnd: () => void;
  onName: (exported: string) => void;
}) {
  return (
    <div className="picker-new" data-picker-new="">
      {naming ? (
        // Escape in the field is the field's: it puts
        // the row back. Kept from the page, where it
        // would also close the list.
        <span
          className="picker-naming"
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.stopPropagation();
          }}
        >
          <Input
            value=""
            mono
            autoFocus
            label={strings.newFunction}
            commitOnBlur={false}
            onCommit={(typed) =>
              typed.trim() === '' ? onEnd() : onName(typed.trim())
            }
            onAbandon={onEnd}
          />
        </span>
      ) : (
        <Button variant="quiet" onClick={onStart}>
          {strings.newFunction}
        </Button>
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
  label,
  readOnly,
  onCommit,
}: {
  strings: InspectorStrings;
  field: InspectorField;
  named: Named;

  /** The control's own name, where no label in its
   *  row points at it alone. */
  label?: string;

  readOnly: boolean;
  onCommit: (field: InspectorField) => void;
}) {
  switch (field.control) {
    case 'choice':
      return (
        <Select
          {...named}
          label={label}
          mono
          value={field.value}
          disabled={readOnly}
          options={field.options.map((option) => ({
            value: option,
            label: strings.options[`${field.id}.${option}`] ?? option,
          }))}
          onChange={(value) => onCommit({ ...field, value })}
        />
      );

    // A checkbox ignores `readonly`, so one that may
    // not be changed is switched off as well.
    case 'flag':
      return (
        <input
          type="checkbox"
          id={named.id}
          aria-describedby={named.describedBy}
          checked={field.value}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(event) =>
            onCommit({ ...field, value: event.target.checked })
          }
        />
      );

    case 'number':
      return (
        <Input
          {...named}
          label={label}
          mono
          value={field.value === null ? '' : String(field.value)}
          placeholder={strings.placeholders[field.id]}
          readOnly={readOnly}
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
          label={label}
          mono
          value={field.value}
          placeholder={strings.placeholders[field.id]}
          readOnly={readOnly}
          onCommit={(value) => onCommit({ ...field, value })}
        />
      );

    case 'prose':
      return (
        <TextArea
          {...named}
          label={label}
          mono
          value={field.value}
          readOnly={readOnly}
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
