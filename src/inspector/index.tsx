import { useEffect, useRef } from 'react';

import { runStateOf } from '../canvas/graph.js';
import { postToHost } from '../webview/client.js';
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
 * A whole run and a block each name themselves in
 * that row. Otherwise the row names the pane and,
 * at its far end, the canvas file a person is
 * looking at, so an empty pane still says which
 * canvas it is waiting on. With nothing to inspect
 * there is nothing to press: the way out is picking
 * a block on the canvas, or opening a run.
 */
function InspectorPanel({ strings, subject }: InspectorInit) {
  // Whether somebody just asked for the whole run in
  // a block's place. The Button they pressed goes
  // with the block, so the card the host answers
  // with takes focus onto its title — once, and only
  // from the drawing that answers: anything else
  // drawn first lets the ask go.
  const askedForRun = useRef(false);

  useEffect(() => {
    askedForRun.current = false;
  });

  return (
    <div className="inspector-view" data-inspector>
      {subject.at === 'run' ? (
        <RunLevelCard
          strings={strings}
          run={subject.run}
          takesFocus={askedForRun}
        />
      ) : subject.at === 'block' ? (
        <Block
          strings={strings}
          block={subject.block}
          onShowRun={() => {
            askedForRun.current = true;
            postToHost({ type: 'inspectRun' });
          }}
        />
      ) : (
        <>
          <InspectorHeader
            title={<h1 className="inspector-title">{strings.heading}</h1>}
            file={subject.file}
          />

          <EmptyState
            kind="empty"
            title={strings.nothingSelected}
            detail={strings.nothingSelectedDetail}
          />
        </>
      )}
    </div>
  );
}

/**
 * A block, named over its two faces, drawn from
 * what the host sent about it rather than from a
 * canvas around it.
 *
 * What a run did to the block is asked of the
 * board's own rule, so the card here and the block
 * on the graph cannot disagree.
 */
function Block({
  strings,
  block,
  onShowRun,
}: {
  strings: InspectorStrings;
  block: BlockSubject;
  onShowRun: () => void;
}) {
  const node = block.ir.nodes.find((one) => one.id === block.nodeId);

  return (
    <Inspector
      strings={strings}
      source={block.source}
      workflow={block.workflow}
      nodeId={block.nodeId}
      selected={node === undefined ? undefined : { ir: block.ir, node }}
      mode={block.face}
      revision={block.revision}
      proposal={block.proposal}
      run={block.run}
      functionId={block.functionId}
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
      kindWords={block.kindWords}
      diagnostics={block.diagnostics}
      onShowRun={onShowRun}
    />
  );
}

mountView('inspector', InspectorPanel);
