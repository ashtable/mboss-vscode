import { postToHost } from '../webview/client.js';
import type { RunByHand, RunsStrings } from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { TextArea } from '../webview/signal/Field.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { PropertyRow } from '../webview/signal/PropertyRow.js';

/**
 * The one place a run's input is typed.
 *
 * Every change is said as it is made — `runInput` —
 * because a trigger's card and the palette command
 * start runs with this input too, so Run names only
 * the workflow and whatever is in the box is what
 * goes. The box holds what somebody typed while
 * they are typing; the extension holds it the rest
 * of the time, which is why a view torn down and
 * put back comes back with the same text.
 *
 * Named apart from the `RunInput` the ledger reads
 * off a recorded run, so neither name means two
 * things.
 *
 * Under the box: what makes two starts the same
 * run, where the trigger says so, and then whatever
 * stopped the last one. A refusal is offered the
 * two ways out it has — rebuilding an app that was
 * built before this workflow, and handing the whole
 * refused start to the agent — and never one it
 * does not: a start refused before anything was
 * filed has no run to ask about.
 */
export function InputRow({
  testRun,
  strings,
}: {
  testRun: RunByHand;
  strings: RunsStrings;
}) {
  const picked = testRun.workflows.find(
    (flow) => flow.name === testRun.selected,
  );

  // A box that can start nothing is worse than no
  // box, so the sentence stands in for it wherever
  // nothing here could be started by hand: the
  // workflow somebody picked runs on a schedule, or
  // every workflow the project saved does and there
  // was nothing else to pick.
  const byHand = testRun.workflows.filter((flow) => flow.mode !== 'schedule');
  const scheduled =
    picked?.mode === 'schedule' ||
    (testRun.workflows.length > 0 && byHand.length === 0);

  if (scheduled) {
    return (
      <div className="runs-input">
        <FieldHint>{strings.scheduledNotRunnable}</FieldHint>
      </div>
    );
  }

  const { hint, problem } = testRun;

  // Read out here rather than inside the handler,
  // where narrowing does not reach.
  const refused = problem?.workflowId;

  return (
    <div className="runs-input">
      <PropertyRow
        label={strings.input}
        field="input"
        control={({ id, describedBy }) => (
          <TextArea
            id={id}
            describedBy={describedBy}
            mono
            grow={{ minLines: 1, maxLines: 8 }}
            hook={{ input: '' }}
            value={testRun.input}
            onChange={(text) =>
              postToHost({
                type: 'runInput',
                workflow: testRun.selected,
                text,
              })
            }
          />
        )}
      />

      {hint === undefined ? null : <FieldHint>{hint}</FieldHint>}

      {problem === undefined ? null : (
        <div className="runs-problem" data-problem>
          <FieldHint tone="fail">{problem.detail}</FieldHint>

          {problem.rebuildToRun ? (
            <Button
              variant="quiet"
              ink="brand"
              hook={{ rebuild: '' }}
              onClick={() => postToHost({ type: 'stackRebuild' })}
            >
              {strings.rebuildApp}
            </Button>
          ) : null}

          {refused === undefined ? null : (
            <Button
              variant="quiet"
              hook={{ 'ask-agent': '' }}
              onClick={() =>
                postToHost({ type: 'askAgent', workflowId: refused })
              }
            >
              {strings.askAgent}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
