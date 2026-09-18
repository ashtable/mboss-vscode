import { filled } from '../webview/fill.js';
import type { RunsStrings } from '../webview/protocol.js';
import { StatusGlyph } from '../webview/signal/StatusGlyph.js';

import type { ServiceHealth } from './stack.js';

/**
 * One of the project's own containers, as the panel
 * draws it while the app is down.
 *
 * A dot, the service's name and what compose said
 * about it — nothing anybody can press. Start app
 * brings the whole stack up, so a control per row
 * would be four ways to do one thing, and three of
 * them would leave the panel in the state it is
 * already in.
 *
 * The dot says running or not, and nothing louder:
 * a stopped service is a fact, and the one alarm on
 * this panel belongs to the card under these rows
 * that says what it means. Its word is on the dot
 * itself, because no word stands beside it.
 *
 * A service the file declares that no container was
 * ever made for has nothing to say about itself, so
 * the state word stands in.
 */
export function ServiceHealthItem({
  service,
  strings,
}: {
  service: ServiceHealth;
  strings: RunsStrings;
}) {
  const running = service.state === 'running';
  const word = strings.serviceState[service.state];

  return (
    <li
      className="service-item"
      data-service={service.service}
      data-state={service.state}
    >
      <StatusGlyph
        variant="dot"
        state={running ? 'healthy' : 'idle'}
        breathe={running}
        label={filled(strings.serviceLabel, service.service, word)}
      />

      <span className="mono service-name">{service.service}</span>

      <span className="mono service-detail">
        {service.detail === '' ? word : service.detail}
      </span>
    </li>
  );
}
