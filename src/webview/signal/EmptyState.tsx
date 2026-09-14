import { Button } from './Button.js';
import { hooked } from './hook.js';

/**
 * What a panel says where a list would be.
 *
 * Two kinds, and the difference is whose doing it
 * is: `empty` is a panel with nothing in it yet,
 * `error` is a panel that asked and was refused. The
 * mark belongs to the second alone — a cross over a
 * list nobody has filled in yet reads as a failure
 * where there is none.
 *
 * The title and the detail are elements of their
 * own, so a spec can read either without the other:
 * the title is the state, the detail is what to do
 * about it, and a panel that lost one of them still
 * reads as a panel with something in it.
 *
 * One way out at most, and it is a real Button
 * rather than something dressed as one, so it keeps
 * the focus ring every other control on the page
 * has.
 */
export function EmptyState({
  kind,
  title,
  detail,
  action,
  hook,
}: {
  kind: 'empty' | 'error';

  title: string;

  detail?: string;

  action?: {
    label: string;
    onClick: () => void;
    busy?: boolean;
    hook?: Record<string, string>;
  };

  hook?: Record<string, string>;
}) {
  return (
    <div className="empty-state" data-kind={kind} {...hooked(hook)}>
      {kind === 'error' ? (
        // The words under it say what happened, so
        // the mark is drawn and not announced.
        <p className="empty-mark" aria-hidden="true">
          ✕
        </p>
      ) : null}

      <p className="empty-title">{title}</p>

      {detail === undefined ? null : <p className="empty-detail">{detail}</p>}

      {action === undefined ? null : (
        <Button
          variant="quiet"
          ink="brand"
          busy={action.busy}
          onClick={action.onClick}
          hook={action.hook}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
