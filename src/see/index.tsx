import {
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { useMemo } from 'react';

import { RunNode } from '../canvas/RunNode.js';
import { Wire, WireMarkers } from '../canvas/Wire.js';
import { toReactFlow } from '../canvas/graph.js';
import { postToHost } from '../webview/client.js';
import { mountView } from '../webview/mount.js';
import type {
  RunSeverity,
  SeeBar,
  SeeChip,
  SeeGraph,
  SeeInit,
  SeeLineageRun,
  SeeRun,
  SeeStrings,
  SeeTimeline,
  TraceGroupView,
  TraceOpView,
} from '../webview/protocol.js';

import './see.css';

/** Defined once. React Flow remounts every node
 *  when this object changes identity. */
const nodeTypes: NodeTypes = {
  trigger: RunNode,
  step: RunNode,
  transaction: RunNode,
  apiCall: RunNode,
  branch: RunNode,
  loop: RunNode,
  durableWait: RunNode,
  approval: RunNode,
  emailSend: RunNode,
  codeStep: RunNode,
};

const edgeTypes: EdgeTypes = { wire: Wire };

/** One mark per severity, the same four the run
 *  list draws its rows with. */
const SEVERITY_MARK: Record<RunSeverity, string> = {
  ok: '✓',
  running: '●',
  waiting: '◐',
  failed: '✕',
  exhausted: '⊘',
};

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
          <p className="title" data-severity={run.severity}>
            {run.headline}
          </p>

          {run.recovered === undefined ? null : (
            <p className="run-tag">{strings.recoveredTag}</p>
          )}

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

        {run.recovered === undefined ? null : (
          <section className="card recovered" data-recovered-banner>
            <p className="eyebrow">{run.recovered.heading}</p>
            {run.recovered.figures === undefined ? null : (
              <p className="recovered-figures">
                <span className="hint" data-recovered-down>
                  {run.recovered.figures.down}
                  <span className="provenance" data-provenance="derived">
                    {strings.derived}
                  </span>
                </span>
                <span className="hint" data-recovered-reused>
                  {run.recovered.figures.reused}
                  <span className="provenance" data-provenance="derived">
                    {strings.derived}
                  </span>
                </span>
              </p>
            )}
            <p className="recovered-body">{run.recovered.body}</p>
          </section>
        )}

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

      <aside className="rail">
        {run.input === undefined ? null : (
          <section className="card" data-workflow-input>
            <p className="eyebrow mono">{strings.workflowInput}</p>
            <pre className="mono raw-input">{run.input.text}</pre>
            <p className="hint">
              {strings.asRecorded}
              {run.input.cut ? ' · …' : ''}
            </p>
          </section>
        )}

        <section className="card">
          <p className="eyebrow mono">{strings.status}</p>
          <dl className="ledger">
            {run.rail.map((row) => (
              <div key={row.label} data-rail={row.label}>
                <dt className="mono">{row.label}</dt>
                <dd className="mono">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="ledger-note">{strings.ledger}</p>
        </section>

        {run.lineage === undefined ? null : (
          <section className="card" data-lineage>
            <ol className="lineage">
              <LineageRow run={run.lineage} strings={strings} />
            </ol>
            <p className="ledger-note" data-lineage-note>
              {strings.bothRemain}
            </p>
          </section>
        )}

        {run.note === undefined ? null : (
          <p className="replay-note" data-replay-note>
            {run.note}
          </p>
        )}

        <button
          type="button"
          className="btn primary"
          data-replay
          disabled={run.selectedStep === undefined}
          onClick={() => {
            if (run.selectedStep !== undefined) {
              postToHost({
                type: 'replayFrom',
                workflowId: run.workflowId,
                functionId: run.selectedStep,
              });
            }
          }}
        >
          {strings.replay}
        </button>
      </aside>
    </div>
  );
}

/**
 * One run of the lineage tree, and what came out of
 * it.
 *
 * An indented list rather than a graph: a fork chain
 * is a line, and a line drawn as a graph is a graph
 * nobody can read in a rail. Every id is a way to
 * that run, because the whole claim being made is
 * that both of them are still there to be opened.
 *
 * Recursive because the shape is: the run this one
 * came out of holds this one, which holds the runs
 * that came out of it.
 */
function LineageRow({
  run,
  strings,
}: {
  run: SeeLineageRun;
  strings: SeeStrings;
}) {
  return (
    <li>
      {/* Above the run rather than beside it: it
          names the edge, and the edge is what the
          rule down the side of the list draws. */}
      {run.from === undefined ? null : (
        <p className="lineage-from" data-lineage-from={run.workflowId}>
          {run.from}
          <span className="provenance" data-provenance="derived">
            {strings.derived}
          </span>
        </p>
      )}

      <p
        className="lineage-run"
        data-lineage-run={run.workflowId}
        aria-current={run.here}
      >
        <button
          type="button"
          className="lineage-id"
          data-lineage-id={run.workflowId}
          onClick={() =>
            postToHost({ type: 'runSelect', workflowId: run.workflowId })
          }
        >
          {run.workflowId}
        </button>
        <span className="glyph" aria-hidden="true">
          {SEVERITY_MARK[run.severity]}
        </span>
        <span className="hint">{run.status}</span>
      </p>

      {run.forks.length === 0 ? null : (
        <ol className="lineage-child lineage-edge">
          {run.forks.map((fork) => (
            <LineageRow key={fork.workflowId} run={fork} strings={strings} />
          ))}
        </ol>
      )}
    </li>
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
 * Read-only: nothing here is dragged, wired or
 * deleted. A run page offering to change a document
 * would be offering to change the thing it is a
 * record of.
 *
 * The caption says which revision is drawn, because
 * the document may have moved on since the run —
 * and where the project has no document of that
 * name it says that instead, rather than leaving a
 * blank pane that reads as broken.
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
            labels: graph.labels,
            unassigned: graph.unassigned,
            runningDerived: strings.derived,
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
    <>
      <p className="legend" data-graph-caption>
        {graph.caption}
      </p>

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
          />
        </ReactFlowProvider>
      </div>
    </>
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
          </li>
        ))}
      </ol>
    </details>
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
