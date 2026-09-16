import { useEffect, useRef, useState } from 'react';

import type {
  Diagnostic,
  HandlerMisfit,
  LibFunction,
  NodeKind,
  WorkflowIR,
  WorkflowNode,
} from '../core/rules.js';
import { postToHost } from '../webview/client.js';
import type {
  BlockAbout,
  BlockSubject,
  InspectorMode,
  InspectorStrings,
  RunInputView,
  ShownRun,
} from '../webview/protocol.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { TabPanel, Tabs } from '../webview/signal/Tabs.js';
import type { RunState } from '../canvas/graph.js';

import {
  ConfigureFace,
  TITLE,
  TitleField,
  initiallyFolded,
  type Held,
} from './ConfigureFace.js';
import {
  EvidenceFace,
  evidenceStatus,
  type EvidenceBlock,
} from './EvidenceFace.js';
import { InspectorHeader } from './Header.js';
import { evidenceOf } from './evidence.js';
import {
  configToForm,
  formToConfig,
  wholeNode,
  type InspectorField,
} from './forms.js';

/**
 * A block in the Inspector: its name over two faces,
 * the one place its config is set and what a run
 * recorded about it.
 *
 * The node being edited is held here rather than
 * only in the document, and that is deliberate. A
 * field can be half-set — an address chosen but
 * not typed, a mode picked whose topic is still
 * blank — and the document has no way to hold a
 * half-set block. So the pane keeps what a person
 * is in the middle of doing, sends it to the host
 * at each commit, and the host writes the ones
 * that are whole. It is kept here, above both
 * faces, because the block's name is set at the top
 * of the pane and the rest in the Configure face,
 * and a rename must not drop a field somebody has
 * half set below it.
 */

/** The block the pane is showing, in the document
 *  it belongs to. */
export type Selection = { ir: WorkflowIR; node: WorkflowNode };

/**
 * Everything the pane draws a block from.
 *
 * Spread rather than passed as the `BlockSubject`
 * the host sent, so each piece is named where it is
 * read and the three that say which form this is —
 * the surface, the document, the block — cannot be
 * read as one blob.
 */
export type InspectorProps = {
  strings: InspectorStrings;

  /** Which surface the block was picked on. A form
   *  about the same block from the other surface is
   *  a different form, never the same one again. */
  source: BlockSubject['source'];

  /** The document the block is in. A block of the
   *  same id in another document is a different
   *  form too. */
  path: string;

  /** The workflow the block is in, which a question
   *  about the block names it by. */
  workflow: string;

  /** The block's id, which is all a run's rows know
   *  it by — the document may have lost the rest. */
  nodeId: string;

  /** Nothing where the document does not have the
   *  block: one a run recorded and the document has
   *  lost since, which has nothing to configure. */
  selected: Selection | undefined;

  /** Which of the two faces is on screen. The
   *  host's answer, not the pane's: a panel that
   *  is hidden and shown again remembers nothing. */
  mode: InspectorMode;

  /**
   * What an edit from here is made against, or
   * nothing where the block may not be edited — a
   * proposal drawn in its place. Said about the
   * block the pane was sent rather than read off a
   * canvas around it: the pane sits beside the
   * canvas, not inside it.
   */
  revision: number | undefined;

  /** Why the block may not be edited, when an
   *  agent's proposal is the reason. */
  proposal: string | undefined;

  /** The run the block's canvas is drawing
   *  itself against, which is what the second face
   *  reads. Nothing being followed is what that face
   *  has nothing to say about. */
  run: ShownRun | undefined;

  /** The row somebody picked on the run tab, where
   *  they picked one. */
  functionId: number | undefined;

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

  /** What a kind is called inside a sentence, which
   *  is how the head of the pane names one. */
  kindWords: Record<NodeKind, string>;

  /** What core makes of the document, so that a
   *  finding a field on this form is a way out of
   *  can be drawn on that field. */
  diagnostics: Diagnostic[];

  /** What the Runs view holds, beside a trigger,
   *  which a trigger's card reflects and starts a
   *  run with. */
  runInput: RunInputView | undefined;

  /** Asks for the whole run in the block's place. */
  onShowRun: () => void;
};

/** The one panel both faces draw in, and the two
 *  sentences that say why a face refuses. One of
 *  each per page, so their ids are fixed. */
const FACE = 'inspector-face';
const NO_RUN = 'inspector-no-run';
const NOT_IN_WORKFLOW = 'inspector-not-in-workflow';

/**
 * The block's name, the two faces and the draft
 * being typed between them.
 *
 * The draft lives here rather than in either face
 * because the name is set above them and the rest
 * inside Configure, and one half-set block is one
 * draft either way.
 */
export function Inspector({
  strings,
  source,
  path,
  workflow,
  nodeId,
  selected,
  mode,
  revision,
  proposal,
  run,
  functionId,
  runState,
  lib,
  misfits,
  kindWords,
  diagnostics,
  runInput,
  onShowRun,
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

  // One form per surface, document, block and
  // revision. What somebody has set so far belongs
  // to the form it was set in: the next revision,
  // another block, or the same block in another
  // file, starts again from the document.
  const form =
    selected === undefined
      ? undefined
      : `${source}:${path}:${selected.node.id}:${revision}`;
  const block = `${source}:${path}:${selectedId}`;

  const [edited, setEdited] = useState<{ form: string; node: WorkflowNode }>();
  const draft =
    edited !== undefined && edited.form === form ? edited.node : selected?.node;

  // The field whose last commit was no value, kept
  // with the form it was typed in: another form is
  // another draft, with nothing refused yet.
  const [refused, setRefused] = useState<{ form: string; id: string }>();
  const refusedField =
    refused !== undefined && refused.form === form ? refused.id : undefined;

  const readOnly = revision === undefined;

  // What every message about this block names it by.
  // The pane draws whichever surface was last in
  // front, and that can change while a message is on
  // its way, so each says where it came from and the
  // host sends it there.
  const about: BlockAbout = { source, path, nodeId };

  const commit = (field: InspectorField): void => {
    if (form === undefined || draft === undefined) return;
    if (revision === undefined) return;

    const next = formToConfig(draft, [field]);

    // Text that is no value for its field goes
    // nowhere: the box keeps it and says so under
    // it. A draft that kept it would have every
    // later commit on this form refused with it.
    if (!wholeNode(next)) {
      setRefused({ form, id: field.id });

      return;
    }

    setRefused(undefined);
    setEdited({ form, node: next });
    postToHost({ type: 'edit', baseRevision: revision, node: next, about });
  };

  // The picker writes a document rather than a
  // draft: which function a block runs is a fact
  // the host checks against the manifest, and on a
  // branch it decides what the cases are.
  const assign = (exported: string | null): void => {
    if (selectedId === undefined || revision === undefined) return;

    postToHost({
      type: 'assign',
      baseRevision: revision,
      nodeId: selectedId,
      export: exported,
      about,
    });
  };

  const title =
    draft === undefined
      ? undefined
      : configToForm(draft).fields.find(
          (field): field is Extract<InspectorField, { control: 'text' }> =>
            field.id === TITLE && field.control === 'text',
        );

  const node = selected?.node;
  const evidence = evidenceBlockOf(nodeId, node);

  // What the run recorded about the block, read once
  // for the head and the face, so both draw one row.
  const found =
    run === undefined
      ? undefined
      : evidenceOf(run, nodeId, evidence.body, functionId);
  const picked =
    found?.drawn !== undefined && found.drawn.functionId === functionId;

  return (
    <>
      <InspectorHeader
        title={
          title === undefined || form === undefined ? (
            // A block the document has lost has no name
            // left to set, and no kind to say. The face
            // under it still draws what the run
            // recorded, so the head says the id those
            // rows know it by.
            <h1 className="inspector-title" data-mono="">
              {nodeId}
            </h1>
          ) : (
            <TitleField
              key={form}
              strings={strings}
              field={title}
              block={block}
              held={held}
              readOnly={readOnly}
              onCommit={commit}
            />
          )
        }
        kind={node === undefined ? undefined : kindWords[node.kind]}
        // Where the block got to is the same answer on
        // either face, so the head carries it.
        status={
          found === undefined
            ? undefined
            : evidenceStatus({
                strings,
                block: evidence,
                row: found.drawn,
                runState,
              })
        }
      />

      <Faces
        strings={strings}
        about={about}
        mode={mode}
        run={run}
        inWorkflow={selected !== undefined}
      />

      {/* One face at a time. The other reads what a
          run recorded and takes nothing off the
          document, so the two share no rows and
          drawing both would put a field somebody may
          change beside a fact they may not. */}
      <TabPanel panel={FACE} active={mode}>
        {mode === 'configure' ? (
          selected === undefined || draft === undefined ? null : (
            <ConfigureFace
              key={form}
              strings={strings}
              block={block}
              held={held}
              ir={selected.ir}
              workflow={workflow}
              node={selected.node}
              draft={draft}
              readOnly={readOnly}
              refused={refusedField}
              proposal={proposal}
              lib={lib}
              misfits={misfits}
              diagnostics={diagnostics}
              runInput={runInput}
              folded={folded}
              setFolded={setFolded}
              onCommit={commit}
              onAssign={assign}
              onOpenFunction={() =>
                postToHost({
                  type: 'openFunction',
                  nodeId: selected.node.id,
                  about,
                })
              }
              onAskAgent={() =>
                postToHost({
                  type: 'askAboutBlock',
                  workflow,
                  nodeId: selected.node.id,
                  about,
                })
              }
              onRunTrigger={(name) =>
                postToHost({ type: 'runTrigger', workflow: name })
              }
              onOpenRunInput={() => postToHost({ type: 'openRunInput' })}
            />
          )
        ) : run === undefined || found === undefined ? null : (
          <EvidenceFace
            strings={strings}
            about={about}
            run={run}
            block={evidence}
            found={found}
            picked={picked}
            lib={lib}
            onShowRun={onShowRun}
          />
        )}
      </TabPanel>
    </>
  );
}

/**
 * The two faces, and which one is showing.
 *
 * The choice goes to the host rather than into
 * state here: this panel is torn down every time it
 * is hidden, and a face nobody remembered would
 * come back as whichever one the run implies. A face
 * with nothing to read refuses and says why, under
 * the strip: the second with no run being followed,
 * the first for a block the document no longer has.
 * Refused rather than switched off, so the arrow
 * keys still land on it and the reason is read out
 * there.
 */
function Faces({
  strings,
  about,
  mode,
  run,
  inWorkflow,
}: {
  strings: InspectorStrings;
  about: BlockAbout;
  mode: InspectorMode;
  run: ShownRun | undefined;
  inWorkflow: boolean;
}) {
  const refused = {
    configure: !inWorkflow,
    evidence: run === undefined,
  };

  return (
    <div className="inspector-strip" data-inspector-strip="">
      <Tabs
        label={strings.heading}
        panel={FACE}
        controlsAll
        active={mode}
        onPick={(face) =>
          postToHost({ type: 'inspectorMode', mode: face, about })
        }
        items={[
          {
            id: 'configure',
            label: strings.tabs.configure,
            disabled: refused.configure,
            describedBy: refused.configure ? NOT_IN_WORKFLOW : undefined,
            hook: { 'inspector-tab': 'configure' },
          },
          {
            id: 'evidence',
            label: strings.tabs.evidence,
            disabled: refused.evidence,
            describedBy: refused.evidence ? NO_RUN : undefined,
            hook: { 'inspector-tab': 'evidence' },
          },
        ]}
      />

      {refused.configure ? (
        <FieldHint id={NOT_IN_WORKFLOW} hook={{ 'not-in-workflow': '' }}>
          {strings.notInWorkflow}
        </FieldHint>
      ) : null}

      {refused.evidence ? (
        <FieldHint id={NO_RUN} hook={{ 'no-run': '' }}>
          {strings.noRun}
        </FieldHint>
      ) : null}
    </div>
  );
}

/**
 * The block as the Run evidence face reads it: its
 * identity and its policy rather than the node,
 * because Configure is where configuration is read
 * and set, and a face that could reach `config`
 * would drift into being a second form.
 *
 * A block the document has lost keeps only its id,
 * which is all its rows know it by.
 */
function evidenceBlockOf(
  nodeId: string,
  node: WorkflowNode | undefined,
): EvidenceBlock {
  if (node === undefined) {
    return {
      id: nodeId,
      kind: undefined,
      handler: undefined,
      retry: undefined,
      body: undefined,
      queue: undefined,
      onClock: false,
    };
  }

  return {
    id: node.id,
    kind: node.kind,
    handler: node.handler?.export,
    retry: node.retry,
    body: node.kind === 'loop' ? node.config.body : undefined,
    queue: node.kind === 'queue' ? node.config.queue : undefined,
    onClock: node.kind === 'durableWait' && node.config.source.kind === 'timer',
  };
}
