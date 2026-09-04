import { useRef, useState } from 'react';

import type { WorkflowNode } from '../../core/rules.js';
import { postToHost } from '../../webview/client.js';
import type {
  CanvasInspector,
  InspectorStrings,
} from '../../webview/protocol.js';

import { configToForm, formToConfig, type InspectorField } from './forms.js';

/**
 * The Inspector: the one place a block's config is
 * set, and the canvas' third column.
 *
 * The node being edited is held here rather than
 * only in the document, and that is deliberate. A
 * field can be half-set — an address chosen but
 * not typed, a mode picked whose topic is still
 * blank — and the document has no way to hold a
 * half-set block. So the column keeps what a person
 * is in the middle of doing, sends it to the host
 * at each commit, and the host writes the ones
 * that are whole.
 *
 * A field commits when the person is finished with
 * it: a menu or a checkbox the moment it changes,
 * a text field on blur or Enter, and Escape puts
 * back what the document says. Never per keystroke
 * — the revision that granularity produces is on
 * screen, in the graph's own caption.
 */
export function Inspector({ strings, selected }: CanvasInspector) {
  if (selected === undefined) {
    return (
      <div className="inspector">
        <p className="eyebrow text-muted">{strings.heading}</p>
        <p className="state text-muted">{strings.nothingSelected}</p>
      </div>
    );
  }

  return (
    <Fields
      key={`${selected.node.id}:${selected.revision}`}
      strings={strings}
      node={selected.node}
      revision={selected.revision}
    />
  );
}

function Fields({
  strings,
  node,
  revision,
}: {
  strings: InspectorStrings;
  node: WorkflowNode;
  revision: number;
}) {
  const [draft, setDraft] = useState(node);
  const form = configToForm(draft);

  const commit = (field: InspectorField): void => {
    const next = formToConfig(draft, [field]);

    setDraft(next);
    postToHost({ type: 'edit', baseRevision: revision, node: next });
  };

  return (
    <div className="inspector">
      <p className="eyebrow" data-inspector-heading>
        {strings.heading} · {strings.kinds[form.kind]}
      </p>

      <dl className="fields">
        {form.fields.map((field) => (
          <Row
            key={field.id}
            strings={strings}
            field={field}
            onCommit={commit}
          />
        ))}
      </dl>
    </div>
  );
}

function Row({
  strings,
  field,
  onCommit,
}: {
  strings: InspectorStrings;
  field: InspectorField;
  onCommit: (field: InspectorField) => void;
}) {
  return (
    <div className="field" data-field={field.id} data-control={field.control}>
      <dt className="field-name text-muted">{strings.fields[field.id]}</dt>
      <dd className="field-value">
        <Control strings={strings} field={field} onCommit={onCommit} />
      </dd>
    </div>
  );
}

function Control({
  strings,
  field,
  onCommit,
}: {
  strings: InspectorStrings;
  field: InspectorField;
  onCommit: (field: InspectorField) => void;
}) {
  switch (field.control) {
    case 'choice':
      return (
        <select
          value={field.value}
          onChange={(event) =>
            onCommit({ ...field, value: event.target.value })
          }
        >
          {field.options.map((option) => (
            <option key={option} value={option}>
              {strings.options[`${field.id}.${option}`] ?? option}
            </option>
          ))}
        </select>
      );

    case 'flag':
      return (
        <input
          type="checkbox"
          checked={field.value}
          onChange={(event) =>
            onCommit({ ...field, value: event.target.checked })
          }
        />
      );

    case 'number':
      return (
        <Typed
          value={field.value === null ? '' : String(field.value)}
          multiline={false}
          onCommit={(value) =>
            onCommit({
              ...field,
              value: value.trim() === '' ? null : Number(value),
            })
          }
        />
      );

    case 'rows':
      return (
        <div className="rows">
          {field.rows.map((row, index) => (
            <div key={index} className="row">
              {row.map((inner) => (
                <Row
                  key={inner.id}
                  strings={strings}
                  field={inner}
                  onCommit={(changed) =>
                    onCommit({
                      ...field,
                      rows: field.rows.map((one, at) =>
                        at === index
                          ? one.map((cell) =>
                              cell.id === changed.id ? changed : cell,
                            )
                          : one,
                      ),
                    })
                  }
                />
              ))}
            </div>
          ))}
        </div>
      );

    case 'text':
    case 'prose':
      return (
        <Typed
          value={field.value}
          multiline={field.control === 'prose'}
          onCommit={(value) => onCommit({ ...field, value })}
        />
      );
  }
}

/**
 * A field somebody types into.
 *
 * It keeps what has been typed and hands it over
 * when they are done with it — which is what makes
 * a half-typed value a thing a person can pass
 * through rather than a document they cannot save.
 */
function Typed({
  value,
  multiline,
  onCommit,
}: {
  value: string;
  multiline: boolean;
  onCommit: (value: string) => void;
}) {
  const [typed, setTyped] = useState(value);

  // Escape puts the document's value back and then
  // leaves the field, and leaving a field is what
  // commits it. The flag is what keeps the second
  // from undoing the first — the state it set has
  // not been applied yet by the time blur runs.
  const abandoned = useRef(false);

  const done = (): void => {
    if (abandoned.current) {
      abandoned.current = false;

      return;
    }

    if (typed !== value) onCommit(typed);
  };

  const keys = (event: {
    key: string;
    preventDefault: () => void;
    currentTarget: { blur: () => void };
  }): void => {
    if (event.key === 'Escape') {
      abandoned.current = true;
      setTyped(value);
      event.currentTarget.blur();

      return;
    }

    if (event.key === 'Enter' && !multiline) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const shared = {
    value: typed,
    onChange: (event: { target: { value: string } }) =>
      setTyped(event.target.value),
    onBlur: done,
    onKeyDown: keys,
    spellCheck: false,
  };

  return multiline ? (
    <textarea className="mono" rows={3} {...shared} />
  ) : (
    <input className="mono" type="text" {...shared} />
  );
}
