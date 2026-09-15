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

/**
 * The box a person types into, and the row of
 * controls under it.
 *
 * One card rather than a field with buttons around
 * it: the agent the prompt goes to and the way to
 * send it are about what is being written, so they
 * sit inside the edge that says "this is the thing
 * you are writing in", and focus rings that edge
 * rather than the textarea inside it.
 *
 * Its height is what was typed. The stylesheet
 * grows the field with its text between a floor
 * and a share of the panel, so nobody drags a grip
 * to make room for a long prompt, and nobody can
 * drag the field shut.
 *
 * It holds the draft, so the panel keeps it mounted
 * across every repaint.
 */
export function Composer({
  strings,
  agent,
  status,
  field,
}: {
  strings: SidebarStrings;
  agent: string | undefined;
  status: SidebarInit['status'];

  /** The textarea, which Refine puts the cursor
   *  back in. */
  field: RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState('');

  // A turn waiting on a permission answer is still
  // a turn, and the one most in need of a way out.
  const working = status === 'streaming' || status === 'awaiting-permission';
  const blank = text.trim() === '';

  const send = (event: FormEvent): void => {
    event.preventDefault();

    if (working || blank) return;

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

      <div className="composer-meta">
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
        {working ? (
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
