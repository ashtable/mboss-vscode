import {
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import type { SidebarInit, SidebarStrings } from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { FieldHint } from '../webview/signal/FieldHint.js';

/**
 * The box a person types into, and the row of
 * controls under it.
 *
 * One card rather than a field with buttons around
 * it: the files it carries, the agent it goes to and
 * the way to send it are about what is being
 * written, so they sit inside the edge that says
 * "this is the thing you are writing in", and focus
 * rings that edge rather than the textarea inside
 * it.
 *
 * Its height is what was typed. The stylesheet
 * grows the field with its text between a floor
 * and a share of the panel, so nobody drags a grip
 * to make room for a long prompt, and nobody can
 * drag the field shut.
 *
 * It holds the draft's text, so the panel keeps it
 * mounted across every repaint. The files attached
 * to it are the extension's, which opens the picker
 * and outlives this view.
 */
export function Composer({
  strings,
  agent,
  status,
  attached,
  field,
}: {
  strings: SidebarStrings;
  agent: string | undefined;
  status: SidebarInit['status'];
  attached: SidebarInit['attached'];

  /** The textarea, which Refine puts the cursor
   *  back in. */
  field: RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState('');

  const busy = working(status);
  const blank = text.trim() === '';

  const send = (event: FormEvent): void => {
    event.preventDefault();

    if (busy || blank) return;

    postToHost({ type: 'prompt', text });
    setText('');
  };

  // Enter sends and Shift+Enter breaks the line,
  // which is what every other composer on the
  // platform does. While an input method is still
  // building a character, Enter belongs to it:
  // sending then would send half a word.
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;

    event.preventDefault();
    send(event);
  };

  return (
    <form className="composer" onSubmit={send}>
      <textarea
        ref={field}
        value={text}
        aria-label={strings.composerLabel}
        placeholder={strings.placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKey}
      />

      {/* What the next prompt carries, each file with
          its own way back out, so nothing goes that
          somebody meant to take away. In the muted
          tone rather than a hint's faint one: these
          names are read before sending, not skimmed. */}
      {attached.length === 0 ? null : (
        <FieldHint tone="muted" hook={{ attached: '' }}>
          {attached.map((file) => (
            <span key={file.uri} className="attached-file">
              {file.name}
              <Button
                variant="quiet"
                icon="remove"
                label={filled(strings.removeAttached, file.name)}
                hook={{ detach: file.uri }}
                onClick={() => postToHost({ type: 'detach', uri: file.uri })}
              />
            </span>
          ))}
        </FieldHint>
      )}

      <div className="composer-meta">
        <Button
          variant="quiet"
          icon="attach"
          label={strings.attachFiles}
          hook={{ attach: '' }}
          onClick={() => postToHost({ type: 'attach' })}
        />

        <Button
          variant="quiet"
          mono
          hook={{ 'composer-agent': '' }}
          onClick={() => postToHost({ type: 'chooseAgent' })}
        >
          {filled(strings.composerAgent, agent ?? strings.chooseAgent)}
          <span aria-hidden="true"> ▾</span>
        </Button>

        {/* Send and Stop are one element under one
            key, so somebody on a keyboard who pressed
            Send is left on Stop rather than on a
            button that has just been taken away. */}
        {busy ? (
          <Button
            key="send-or-stop"
            variant="stop"
            size="md"
            hook={{ stop: '' }}
            onClick={() => postToHost({ type: 'cancel' })}
          >
            {strings.stop}
          </Button>
        ) : (
          <Button
            key="send-or-stop"
            variant="primary"
            size="md"
            type="submit"
            icon="send"
            label={strings.send}
            empty={blank}
          />
        )}
      </div>
    </form>
  );
}

/**
 * The session has a turn in flight.
 *
 * A turn waiting on a permission answer is still a
 * turn, and the one most in need of a way out. Read
 * by every row that says work is happening, so that
 * one answer decides them all.
 */
export function working(status: SidebarInit['status']): boolean {
  return status === 'streaming' || status === 'awaiting-permission';
}
