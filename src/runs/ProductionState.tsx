import { postToHost } from '../webview/client.js';
import type { RunsStrings } from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { SectionLabel } from '../webview/signal/SectionLabel.js';

/**
 * Where the runs that are not these live.
 *
 * Drawn in the one state with nothing local to look
 * at instead, and nowhere else: a panel full of
 * runs has already answered what somebody came to
 * it for, and an empty one is the only place a
 * sentence about somewhere else is not in the way.
 *
 * Stated rather than sold. A window that deploys
 * nowhere is told what Conductor is for and that
 * nothing here depends on it — no trial, no
 * comparison, no second Button. Which setting is
 * empty is the title of the heading, so a pointer
 * and a screen reader both find it there without a
 * line of chrome saying it.
 *
 * Where a console is configured the whole of the
 * integration is the link to it.
 */
export function ProductionState({
  configured,
  strings,
}: {
  configured: boolean;
  strings: RunsStrings;
}) {
  return (
    <section className="production" data-production={kindOf(configured)}>
      <SectionLabel>{strings.production}</SectionLabel>

      {configured ? (
        <>
          <p className="production-title">{strings.conductorConfigured}</p>

          <Button
            variant="secondary"
            ink="brand"
            onClick={() => postToHost({ type: 'openProduction' })}
          >
            {strings.openProduction}
          </Button>
        </>
      ) : (
        <>
          <p className="production-title" title={strings.conductorSetting}>
            {strings.conductorUnconfigured}
          </p>

          <p className="production-detail">{strings.conductorDetail}</p>

          <Button
            variant="quiet"
            onClick={() => postToHost({ type: 'learnConductor' })}
          >
            {strings.learnConductor}
          </Button>
        </>
      )}
    </section>
  );
}

/** Which of the two this is, for a journey that
 *  finds the section by it. */
function kindOf(configured: boolean): string {
  return configured ? 'configured' : 'unconfigured';
}
