import { mountView } from '../webview/mount.js';
import type { InspectorInit } from '../webview/protocol.js';
import { EmptyState } from '../webview/signal/EmptyState.js';

import './inspector.css';

/**
 * The Inspector pane.
 *
 * One header row over whatever the pane is about.
 * The row names the pane and, at its far end, the
 * canvas file a person is looking at, so an empty
 * pane still says which canvas it is waiting on.
 * With nothing to inspect there is nothing to
 * press: the way out is picking a block on the
 * canvas, or opening a run.
 */
function InspectorPanel({ strings, subject }: InspectorInit) {
  return (
    <div className="inspector-view" data-inspector>
      <header className="inspector-header" data-inspector-header>
        <h1 className="inspector-title">{strings.heading}</h1>
        {subject.at === 'none' && subject.file !== undefined ? (
          <span
            className="inspector-file"
            data-inspector-file
            data-mono=""
            title={subject.file}
          >
            {subject.file}
          </span>
        ) : null}
      </header>

      <EmptyState
        kind="empty"
        title={strings.nothingSelected}
        detail={strings.nothingSelectedDetail}
      />
    </div>
  );
}

mountView('inspector', InspectorPanel);
