import {
  NODE_PALETTE,
  type LibFunction,
  type NodePaletteGroup,
} from '../core/rules.js';
import type { CanvasStrings } from '../webview/protocol.js';
import type { NodeKind } from '../core/rules.js';

/**
 * What a workflow can be built from: the ten kinds
 * the catalog defines, and whatever the project's
 * own code-behind offers.
 *
 * The order and the grouping are the catalog's, not
 * this file's — the same list the MCP server hands
 * an agent — so a person and an agent are choosing
 * from one menu. Only the words are the
 * extension's, because a library's labels are not
 * localized.
 */

export type PaletteProps = {
  strings: CanvasStrings;
  labels: Record<NodeKind, string>;
  lib: LibFunction[] | undefined;
};

/** The order the drawers are drawn in, which is the
 *  order a workflow is built in. */
const GROUPS: readonly NodePaletteGroup[] = [
  'start',
  'work',
  'control',
  'people',
];

export function Palette({ strings, labels, lib }: PaletteProps) {
  return (
    <aside className="palette">
      <p className="eyebrow text-muted">{strings.blocks}</p>

      {GROUPS.map((group) => (
        <section key={group} className="drawer">
          <p className="drawer-name mono text-muted">{strings.groups[group]}</p>

          {NODE_PALETTE.filter((entry) => entry.group === group).map(
            (entry) => (
              <p
                key={entry.kind}
                className="chip"
                data-palette-kind={entry.kind}
              >
                {labels[entry.kind]}
              </p>
            ),
          )}
        </section>
      ))}

      <section className="drawer">
        <p className="drawer-name mono text-muted">{strings.lib}</p>

        {lib === undefined || lib.length === 0 ? (
          <p className="drawer-empty text-muted">{strings.noLib}</p>
        ) : (
          lib.map((fn) => (
            <p
              key={fn.export}
              className="chip lib-fn"
              data-lib-fn={fn.export}
              title={fn.doc}
            >
              <span className="mono">{fn.export}</span>
              <span className="signature mono text-muted">
                {signatureOf(fn)}
              </span>
            </p>
          ))
        )}
      </section>
    </aside>
  );
}

/**
 * What the function takes and what it gives back,
 * which is the only thing about it that decides
 * where on the canvas it can go.
 */
function signatureOf(fn: LibFunction): string {
  const takes = fn.params.map((param) => param.type).join(', ');

  return `${takes || '()'} → ${fn.returnType}`;
}
