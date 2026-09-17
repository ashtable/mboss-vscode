import { postToHost } from '../webview/client.js';
import type { SeeRun, SeeStrings } from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { StatusGlyph } from '../webview/signal/StatusGlyph.js';
import { Tabs } from '../webview/signal/Tabs.js';
import type { GlyphState } from '../webview/states.js';

/**
 * The run tab's one row: which run it is and how it
 * went, the two views of it, and a way to look
 * again.
 *
 * One row rather than a stack of them, because the
 * graph and the trace are what the tab is for, and
 * every line above them is a line of the run the
 * reader cannot see. The whole id is the editor
 * tab's title, where it can be read and copied
 * without costing the page a line; here the run is
 * named by its short id, which carries the whole
 * one for a pointer.
 *
 * Whether anything is still reading the run is the
 * refresh Button's name rather than a line of its
 * own: that is the question the Button answers.
 */

/** The id of the pane the strip switches. */
export const SEE_PANE = 'see-pane';

/** Between the short id and the rest of the line:
 *  the separator the host joins the line with, so
 *  the row reads as one run of parts. */
const BETWEEN = ' · ';

/** The states a run can still move on from. A
 *  watch that stopped reading one of these may be
 *  showing where the run was rather than where it
 *  is. */
const UNFINISHED: readonly GlyphState[] = [
  'queued',
  'running',
  'recovering',
  'waiting',
];

export function RunHeader({
  run,
  strings,
  showing,
}: {
  run: SeeRun;
  strings: SeeStrings;
  showing: 'graph' | 'trace';
}) {
  const followed = run.following === 'following';

  return (
    <header className="run-header">
      {/* The line beside it says the state in words,
          so the dot is drawn and not read out. It
          moves only while something reads the run,
          and is hollow where nothing does any more
          and the run was not over. */}
      <StatusGlyph
        variant="dot"
        state={run.state}
        pulse={followed ? undefined : false}
        hollow={!followed && UNFINISHED.includes(run.state) ? true : undefined}
      />

      <p className="mono run-line">
        {strings.run}{' '}
        <span data-short-run={run.workflowId} title={run.workflowId}>
          {run.short}
        </span>
        {BETWEEN}
        {run.line}
      </p>

      <Tabs
        label={strings.heading}
        panel={SEE_PANE}
        active={showing}
        onPick={(tab) => postToHost({ type: 'seeShow', tab })}
        items={[
          {
            id: 'graph',
            label: strings.tabs.graph,
            hook: { 'see-tab': 'graph' },
          },
          {
            id: 'trace',
            label: strings.tabs.trace,
            hook: { 'see-tab': 'trace' },
          },
        ]}
      />

      <Button
        variant="quiet"
        icon="refresh"
        label={strings.following[run.following]}
        hook={{ 'see-refresh': '' }}
        onClick={() => postToHost({ type: 'seeRefresh' })}
      />
    </header>
  );
}
