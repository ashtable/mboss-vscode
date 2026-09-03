import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { announceReady, onHostMessage, postToHost } from '../webview/client.js';
import type {
  SeeBar,
  SeeChip,
  SeeInit,
  SeeRun,
  SeeStrings,
  SeeTimeline,
} from '../webview/protocol.js';

import './see.css';

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

  return <Run run={state.run} strings={state.strings} />;
}

function Run({ run, strings }: { run: SeeRun; strings: SeeStrings }) {
  return (
    <div className="see" data-run={run.workflowId}>
      <main className="see-main">
        <header className="see-head">
          <p className="mono crumb">{run.breadcrumb}</p>
          <p className="title" data-severity={run.severity}>
            {run.headline}
          </p>
        </header>

        {run.recovered === undefined ? null : (
          <section className="card recovered" data-recovered-banner>
            <p className="eyebrow">{run.recovered.heading}</p>
            <p className="recovered-body">{run.recovered.body}</p>
          </section>
        )}

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
      </main>

      <aside className="rail">
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

        {run.note === undefined ? null : (
          <p className="replay-note" data-replay-note>
            {run.note}
          </p>
        )}

        <button
          type="button"
          className="primary"
          data-replay
          disabled={run.selectedStep === undefined}
          onClick={() => {
            if (run.selectedStep !== undefined) {
              postToHost({ type: 'replay', functionId: run.selectedStep });
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
      aria-current={selected}
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

const root = createRoot(window.document.getElementById('root') as HTMLElement);

onHostMessage('see', (message) => {
  root.render(
    <StrictMode>
      <See {...message} />
    </StrictMode>,
  );
});

announceReady();
