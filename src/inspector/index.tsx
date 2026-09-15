import { runStateOf } from '../canvas/graph.js';
import { mountView } from '../webview/mount.js';
import type {
  BlockSubject,
  InspectorInit,
  InspectorStrings,
} from '../webview/protocol.js';
import { EmptyState } from '../webview/signal/EmptyState.js';

import { InspectorHeader } from './Header.js';
import { Inspector } from './Inspector.js';
import { RunLevelCard } from './RunLevel.js';

import './inspector.css';

/**
 * The Inspector pane.
 *
 * One header row over whatever the pane is about.
 * A whole run names itself in that row. Otherwise
 * the row names the pane and, at its far end, the
 * canvas file a person is looking at, so an empty
 * pane still says which canvas it is waiting on.
 * With nothing to inspect there is nothing to
 * press: the way out is picking a block on the
 * canvas, or opening a run.
 */
function InspectorPanel({ strings, subject }: InspectorInit) {
  return (
    <div className="inspector-view" data-inspector>
      {subject.at === 'run' ? (
        <RunLevelCard strings={strings} run={subject.run} />
      ) : (
        <>
          <InspectorHeader
            title={<h1 className="inspector-title">{strings.heading}</h1>}
            file={subject.at === 'none' ? subject.file : undefined}
          />

          {subject.at === 'block' ? (
            <Block strings={strings} block={subject.block} />
          ) : (
            <EmptyState
              kind="empty"
              title={strings.nothingSelected}
              detail={strings.nothingSelectedDetail}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * A block, in the two faces that used to be the
 * canvas's third column, drawn from what the host
 * sent about it rather than from a canvas around it.
 *
 * What a run did to the block is asked of the
 * board's own rule, so the card here and the block
 * on the graph cannot disagree.
 */
function Block({
  strings,
  block,
}: {
  strings: InspectorStrings;
  block: BlockSubject;
}) {
  const node = block.ir.nodes.find((one) => one.id === block.nodeId);

  return (
    <Inspector
      strings={strings}
      source={block.source}
      selected={node === undefined ? undefined : { ir: block.ir, node }}
      mode={block.face}
      revision={block.revision}
      run={block.run}
      runState={
        node === undefined
          ? undefined
          : runStateOf(
              block.ir,
              block.run,
              node.id,
              new Map(Object.entries(block.decided)),
            )
      }
      lib={block.manifest?.functions}
      misfits={strings.misfits}
      diagnostics={block.diagnostics}
    />
  );
}

mountView('inspector', InspectorPanel);
