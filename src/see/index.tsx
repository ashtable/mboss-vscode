import {
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';

import { RunNode } from '../canvas/RunNode.js';
import { Wire, WireMarkers } from '../canvas/Wire.js';
import { toReactFlow } from '../canvas/graph.js';
import { postToHost } from '../webview/client.js';
import { mountView } from '../webview/mount.js';
import type {
  SeeBar,
  SeeChip,
  SeeGraph,
  SeeInit,
  SeeRun,
  SeeStrings,
  SeeTimeline,
  TraceGroupView,
  TraceOpView,
} from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { FieldHint } from '../webview/signal/FieldHint.js';

import './see.css';

/** Defined once. React Flow remounts every node
 *  when this object changes identity. */
const nodeTypes: NodeTypes = {
  trigger: RunNode,
  step: RunNode,
  transaction: RunNode,
  apiCall: RunNode,
  queue: RunNode,
  branch: RunNode,
  loop: RunNode,
  durableWait: RunNode,
  approval: RunNode,
  emailSend: RunNode,
  codeStep: RunNode,
};

const edgeTypes: EdgeTypes = { wire: Wire };

/** One mark per follow state, in place of an icon
 *  set the extension would have to ship. */
const FOLLOW_MARK: Record<SeeRun['following'], string> = {
  following: '●',
  waiting: '◐',
  quiet: '○',
};

/**
 * One run, as Postgres holds it.
 *
 * The argument this page makes is that durability
 * is not a promise, it is rows — so the page is
 * built out of the rows and says which table each
 * part came from. The chart is the one place
 * anything is inferred rather than read, and the
 * hatched band is drawn as a hole in the record
 * rather than as an event, because a hole is what
 * the ledger actually has.
 */

function See(state: SeeInit) {
  if (state.run === undefined) {
    return (
      <div className="see">
        <p className="state">{state.strings.nothingSelected}</p>
      </div>
    );
  }

  return (
    <Run run={state.run} strings={state.strings} showing={state.showing} />
  );
}

/**
 * The run, and nothing beside it.
 *
 * What a run recorded about a block, or about the
 * whole run, is said in the Inspector in the side
 * bar, where the same card answers whichever
 * surface the run was picked on. A second copy
 * here would be a second place to read one fact,
 * and the graph would lose the room it took.
 */
function Run({
  run,
  strings,
  showing,
}: {
  run: SeeRun;
  strings: SeeStrings;
  showing: 'graph' | 'trace';
}) {
  return (
    <div className="see" data-run={run.workflowId}>
      <main className="see-main">
        <header className="see-head">
          <p className="mono crumb">{run.breadcrumb}</p>
          <p className="title" data-severity={run.word}>
            {run.headline}
          </p>

          <p className="run-status" data-following={run.following}>
            <span className="glyph" aria-hidden="true">
              {FOLLOW_MARK[run.following]}
            </span>
            {strings.following[run.following]}
          </p>

          <button
            type="button"
            className="btn secondary"
            data-see-refresh
            onClick={() => postToHost({ type: 'seeRefresh' })}
          >
            {strings.refresh}
          </button>
        </header>

        {/* Both views of one run. Which one is on
            screen is the extension's: a view is
            disposed the moment it is hidden, and a
            tab a person chose has to survive that. */}
        <div className="tabs" role="tablist">
          {(['graph', 'trace'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className="tab"
              role="tab"
              data-see-tab={tab}
              aria-selected={showing === tab}
              onClick={() => postToHost({ type: 'seeShow', tab })}
            >
              {strings.tabs[tab]}
            </button>
          ))}
        </div>

        {/* Both panes keep their layout box, and
            the one not being read is hidden with
            `visibility` rather than `display`. The
            graph library measures its own pane: with
            no box it comes back zero by zero and
            re-frames itself, so what a person panned
            to would be lost every time the tab
            changed. */}
        <div className="tab-panes">
          <section
            className="tab-pane"
            data-pane="graph"
            data-showing={String(showing === 'graph')}
          >
            <RunGraph graph={run.graph} run={run} strings={strings} />
          </section>

          <section
            className="tab-pane"
            data-pane="trace"
            data-showing={String(showing === 'trace')}
          >
            <Trace run={run} strings={strings} />

            <section className="chips-block">
              <p className="eyebrow">{strings.steps}</p>
              <ol className="chips">
                {run.chips.map((chip) => (
                  <li key={chip.functionId}>
                    <Chip
                      chip={chip}
                      strings={strings}
                      selected={chip.functionId === run.selectedStep}
                    />
                  </li>
                ))}
              </ol>
            </section>

            <section className="chart-block">
              <p className="eyebrow">{strings.timeline}</p>
              <p className="legend">
                {run.span} · <span className="hatch-key" /> {strings.hatched}
              </p>
              <Chart timeline={run.timeline} selected={run.selectedStep} />
            </section>

            <section className="raw-block">
              <p className="eyebrow mono">{strings.raw}</p>
              <table className="raw">
                <thead>
                  <tr>
                    <th>{strings.columns.stepId}</th>
                    <th>{strings.columns.fn}</th>
                    <th>{strings.columns.output}</th>
                    <th>{strings.columns.committedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {run.raw.map((row) => (
                    <tr
                      key={row.stepId}
                      data-raw-row={row.stepId}
                      aria-current={row.stepId === run.selectedStep}
                    >
                      <td>{row.stepId}</td>
                      <td>{row.fn}</td>
                      <td className="output">{row.output}</td>
                      <td>{row.committedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>
        </div>
      </main>
    </div>
  );
}

/**
 * One step, marked with what happened to it.
 *
 * `restored` is the whole point of the strip: it
 * says the output came back from Postgres rather
 * than from running the code a second time, which
 * is the difference between a durable workflow and
 * a retry.
 */
function Chip({
  chip,
  strings,
  selected,
}: {
  chip: SeeChip;
  strings: SeeStrings;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      className="chip"
      data-chip={chip.functionId}
      data-restored={String(chip.restored)}
      data-failed={String(chip.failed)}
      data-replayable={String(chip.replayable)}
      aria-current={selected}
      title={chip.because}
      onClick={() =>
        postToHost({ type: 'stepSelect', functionId: chip.functionId })
      }
    >
      <span className="mono">{chip.name}</span>
      <span className="chip-mark" aria-hidden="true">
        {chip.failed ? '✕' : '✓'}
      </span>
      {chip.restored ? (
        <span className="chip-restored">{strings.restored}</span>
      ) : null}
    </button>
  );
}

/**
 * The chart.
 *
 * Everything here is a percentage of the track,
 * because the host computed fractions and the panel
 * is whatever width somebody dragged it to.
 *
 * The band is one element spanning every row, not
 * one per row: it is a single interval in which
 * nothing at all ran, and cutting it into stripes
 * would read as something that happened to each
 * step separately. It sits behind the bars, in a
 * layer inset past the label column so that its
 * percentages mean the same thing the bars' do.
 */
function Chart({
  timeline,
  selected,
}: {
  timeline: SeeTimeline;
  selected: number | undefined;
}) {
  return (
    <div className="chart">
      <div className="chart-rows">
        {timeline.outage === undefined ? null : (
          <span className="band-layer">
            <span
              className="band"
              data-band
              style={{
                left: percent(timeline.outage.from),
                width: wide(timeline.outage.width),
              }}
            />
          </span>
        )}

        {timeline.bars.map((bar) => (
          <div className="chart-row" key={bar.functionId}>
            <span className="mono chart-label">{bar.name}</span>
            <span className="track">
              <Bar bar={bar} selected={bar.functionId === selected} />
            </span>
          </div>
        ))}
      </div>

      {timeline.outage === undefined ? null : (
        // Anchored to the band's own edges rather
        // than to the ends of the chart: each one
        // names what happened at the edge it sits
        // against, and a label halfway across the
        // page from its edge names nothing.
        <p className="band-labels">
          <span
            className="down"
            data-band-down
            style={{ right: percent(1 - timeline.outage.from) }}
          >
            {timeline.outage.down}
          </span>
          <span
            className="resumed"
            data-band-resumed
            style={{
              left: percent(timeline.outage.from + timeline.outage.width),
            }}
          >
            {timeline.outage.resumed}
          </span>
        </p>
      )}

      <p className="ticks">
        {timeline.ticks.map((tick, index) => (
          <span className="mono" key={index} style={{ left: percent(tick.at) }}>
            {tick.label}
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * A step DBOS never timed gets no bar and keeps its
 * row: a step missing from the chart is a step
 * nobody knows ran.
 */
function Bar({ bar, selected }: { bar: SeeBar; selected: boolean }) {
  if (bar.at === undefined) return null;

  return (
    <span
      className="bar"
      data-bar={bar.functionId}
      data-restored={String(bar.restored)}
      data-failed={String(bar.failed)}
      aria-current={selected}
      style={{ left: percent(bar.at.from), width: wide(bar.at.width) }}
    />
  );
}

function percent(fraction: number): string {
  return `${fraction * 100}%`;
}

/** A step that took no measurable time still has to
 *  be findable, so a bar is never nothing wide. */
function wide(fraction: number): string {
  return `${Math.max(fraction * 100, 0.4)}%`;
}

/**
 * The workflow the run was a run of, with what the
 * run did to each block.
 *
 * The run graph edits nothing: nothing here is
 * dragged, wired or deleted, and a block's
 * configuration is edited in the Inspector, against
 * the document buffer. The way to the document
 * itself is Edit workflow, in the graph's corner.
 *
 * The caption says which revision is drawn, because
 * the document may have moved on since the run —
 * and where the project has no document of that
 * name it says that instead, rather than leaving a
 * blank pane that reads as broken. There is then no
 * document to edit, so there is no way to one.
 */
function RunGraph({
  graph,
  run,
  strings,
}: {
  graph: SeeGraph | undefined;
  run: SeeRun;
  strings: SeeStrings;
}) {
  const drawn = useMemo(
    () =>
      graph === undefined
        ? undefined
        : toReactFlow(graph.ir, graph.boxes, {
            kindWords: graph.kindWords,
            triggerPhrases: graph.triggerPhrases,
            unassigned: graph.unassigned,
            runningDerived: strings.derived,
            queueCounts: graph.queueCounts,
            derived: strings.derived,
            selected: run.selected.nodeId,
            run: run.live,
            decided: new Map(Object.entries(graph.decided)),
          }),
    [graph, run.live, run.selected.nodeId, strings.derived],
  );

  if (graph === undefined || drawn === undefined) {
    return (
      <p className="state" data-graph-caption>
        {run.noGraph}
      </p>
    );
  }

  return (
    <div className="run-flow canvas-grid">
      <WireMarkers />

      <ReactFlowProvider>
        <ReactFlow
          nodes={drawn.nodes}
          edges={drawn.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          // Selectable, because picking a block is
          // how somebody says which one they are
          // reading about — and the graph library
          // turns pointer events off on every node
          // when nothing is selectable, which would
          // leave the clicks nowhere to land.
          // Nothing here edits the document.
          elementsSelectable
          fitView
          // Never zoomed past its natural size: a
          // run of two blocks blown up to twice
          // scale is a graph with one block on
          // screen.
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
        >
          {/* In the graph's own corner rather than
              on a line above it: both are about this
              picture, and the picture keeps the room.
              Quiet, because the way back to Build is
              a door rather than what the page is
              asking for, and it opens the document
              without projecting anything onto it. */}
          <Panel position="bottom-left" className="graph-corner">
            <FieldHint hook={{ 'graph-caption': '' }}>
              {graph.caption}
            </FieldHint>
            <Button
              variant="quiet"
              hook={{ 'edit-workflow': '' }}
              onClick={() =>
                postToHost({ type: 'openWorkflow', workflowId: run.workflowId })
              }
            >
              {strings.editWorkflow}
            </Button>
          </Panel>
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

/**
 * The ledger, in the turns each block took.
 *
 * Collapsed by default: a run of a hundred rows
 * opened flat is a wall nobody reads. What is open
 * is what somebody is most likely to be going to —
 * the turn that failed, and the one holding the
 * block they picked.
 */
function Trace({ run, strings }: { run: SeeRun; strings: SeeStrings }) {
  return (
    <section className="trace-block">
      <label className="hint raw-toggle">
        <input
          type="checkbox"
          data-raw-toggle
          checked={run.showRaw}
          onChange={(event) =>
            postToHost({ type: 'seeRaw', raw: event.target.checked })
          }
        />
        {strings.showRaw}
      </label>

      <ol className="trace">
        {run.groups.map((group, index) => (
          <li key={`${group.nodeId ?? 'none'}-${index}`}>
            <Group group={group} run={run} strings={strings} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Group({
  group,
  run,
  strings,
}: {
  group: TraceGroupView;
  run: SeeRun;
  strings: SeeStrings;
}) {
  const shown = group.operations.filter(
    (operation) => run.showRaw || operation.owner !== 'sdk',
  );

  return (
    <details
      className="trace-group"
      data-trace-group={group.nodeId ?? ''}
      data-failed={String(group.failed)}
      open={group.open}
      aria-current={
        group.nodeId !== undefined && group.nodeId === run.selected.nodeId
      }
    >
      <summary
        className="trace-head"
        onClick={() => {
          if (group.nodeId !== undefined) {
            postToHost({ type: 'seeNode', nodeId: group.nodeId });
          }
        }}
      >
        <span className="trace-title">{group.title}</span>
        {group.qualifier === undefined ? null : (
          <span className="hint">{group.qualifier}</span>
        )}
        {group.wakes === undefined ? null : (
          <span className="hint" data-wakes>
            {group.wakes}
            <span className="provenance" data-provenance="derived">
              {strings.derived}
            </span>
          </span>
        )}
        {group.nodeId === undefined ? (
          <span className="hint" data-unattributed>
            {strings.unattributed}
          </span>
        ) : null}
        <span className="tab-count">{group.operations.length}</span>
      </summary>

      <ol className="trace-ops">
        {shown.map((operation) => (
          <li key={operation.functionId}>
            <Operation operation={operation} run={run} strings={strings} />

            {/* Beside the row rather than inside it.
                The row is already a button that picks
                the operation, and a button inside a
                button is one click meaning two
                things. */}
            {operation.childWorkflowId === undefined ? null : (
              <ChildRun id={operation.childWorkflowId} strings={strings} />
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * The way to the run one item of this block started.
 *
 * A queue block hands each item to a workflow of its
 * own, and this ledger holds only that it did: the
 * rows for the work itself belong to the other run
 * and are on the other run's page. The id is the
 * whole of what there is, so the id is the way
 * there.
 */
function ChildRun({ id, strings }: { id: string; strings: SeeStrings }) {
  return (
    <button
      type="button"
      className="mono trace-child"
      data-run-select={id}
      title={strings.childRun}
      onClick={() => postToHost({ type: 'runSelect', workflowId: id })}
    >
      {id}
    </button>
  );
}

function Operation({
  operation,
  run,
  strings,
}: {
  operation: TraceOpView;
  run: SeeRun;
  strings: SeeStrings;
}) {
  return (
    <button
      type="button"
      className="trace-op"
      data-trace-op={operation.functionId}
      data-owner={operation.owner}
      data-replayable={String(operation.replayable)}
      data-reuse={operation.reused ? 'recorded' : 'own'}
      data-state={operation.state}
      aria-current={operation.functionId === run.selected.functionId}
      title={operation.owner === 'sdk' ? strings.dbosOwned : operation.because}
      onClick={() =>
        postToHost({ type: 'stepSelect', functionId: operation.functionId })
      }
    >
      <span className="mono trace-name">{operation.name}</span>
      {operation.restored ? (
        <span className="provenance" data-provenance="derived">
          {strings.restored}
        </span>
      ) : null}
      {/* A different claim from `restored`, and both
          can be true of one row: that one is about a
          crash inside this run, this one is about the
          run this one was replayed from. */}
      {operation.reused ? (
        <span className="provenance" data-provenance="derived">
          {strings.recorded}
        </span>
      ) : null}
      {operation.at === undefined ? null : (
        <span className="mono hint">{operation.at}</span>
      )}
      {operation.error === undefined ? null : (
        <span className="trace-error">{operation.error}</span>
      )}
    </button>
  );
}

mountView('see', See);
