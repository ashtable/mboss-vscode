import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { glyphOf } from '../states.js';

import { StatusGlyph, StatusLine } from './StatusGlyph.js';

/**
 * The markup every state in this extension is drawn
 * as.
 *
 * What it is painted is asked on a page, where a
 * stylesheet exists; this is the other half — which
 * shape a state takes, what it says to somebody who
 * cannot see it, and whether it admits that it was
 * worked out rather than read off a row. That last
 * one is the whole reason this component exists:
 * a derived state a person takes for a recorded one
 * is the failure mode a flight recorder has to be
 * proof against.
 *
 * Called rather than written as a tag, because this
 * tier runs no JSX. The two-letter words are this
 * spec's own, standing in for a view's: nothing
 * under this directory is in any language.
 */
describe('the glyph every state is drawn as', () => {
  it('wears the mark the one state table gives it', () => {
    const drawn = renderToStaticMarkup(
      StatusGlyph({ state: 'done', variant: 'mark' }),
    );

    expect(glyphOf('done').mark).toBe('✓');
    expect(drawn).toContain('>✓<');
    expect(drawn).toContain('data-glyph="mark"');
    expect(drawn).toContain('data-state="done"');
  });

  /**
   * And the tone from the same row of it, carried to
   * the sheet on the element. What that token paints
   * in each of the four appearances is asked on a
   * page; this is the half that says the component
   * asked for the right one — and that it reads the
   * ink high contrast substitutes rather than
   * insisting on a colour that cannot be read there.
   */
  it('carries the tone that table gives it to the sheet', () => {
    const drawn = renderToStaticMarkup(
      StatusGlyph({ state: 'failed', variant: 'mark' }),
    );

    expect(glyphOf('failed').tone).toBe('--fail');
    expect(drawn).toContain('color:var(--state-ink, var(--fail))');
  });

  /**
   * A dot is a shape and not a character, so there
   * is nothing inside it to read: what it says is
   * said by whether it is filled.
   */
  it('draws a dot as a shape with nothing written in it', () => {
    const filled = renderToStaticMarkup(
      StatusGlyph({ state: 'running', variant: 'dot' }),
    );

    expect(filled).toContain('data-glyph="dot"');
    expect(filled).not.toContain('data-hollow');
    expect(filled).toMatch(/><\/span>$/);
  });

  /**
   * Hollow wherever nothing has happened yet. A
   * filled glyph is how this system says something
   * has, and a queued item that borrowed one would
   * be claiming a start nobody recorded.
   */
  it('leaves a state nothing has happened at hollow', () => {
    for (const state of ['idle', 'queued', 'waiting'] as const) {
      expect(
        renderToStaticMarkup(StatusGlyph({ state, variant: 'dot' })),
      ).toContain('data-hollow');
    }

    expect(
      renderToStaticMarkup(
        StatusGlyph({ state: 'done', variant: 'dot', hollow: true }),
      ),
    ).toContain('data-hollow');
  });

  /** The two that are still going move on their own,
   *  and nothing else does. */
  it('moves only while something is still happening', () => {
    expect(
      renderToStaticMarkup(StatusGlyph({ state: 'running', variant: 'dot' })),
    ).toContain('data-pulse');
    expect(
      renderToStaticMarkup(
        StatusGlyph({ state: 'recovering', variant: 'mark' }),
      ),
    ).toContain('data-pulse');

    expect(
      renderToStaticMarkup(StatusGlyph({ state: 'done', variant: 'mark' })),
    ).not.toContain('data-pulse');
  });

  /**
   * A glyph beside a word that already says the
   * state would have a screen reader say it twice,
   * so it is named only where it stands alone.
   */
  it('is spoken only where no word accompanies it', () => {
    const alone = renderToStaticMarkup(
      StatusGlyph({ state: 'healthy', variant: 'dot', label: 'ab' }),
    );

    expect(alone).toContain('role="img"');
    expect(alone).toContain('aria-label="ab"');

    const beside = renderToStaticMarkup(
      StatusGlyph({ state: 'healthy', variant: 'dot' }),
    );

    expect(beside).toContain('aria-hidden="true"');
    expect(beside).not.toContain('role="img"');
  });
});

/**
 * Rendered rather than called, because the id
 * joining a line to the words spoken beside it is
 * React's to mint and it can only be asked for
 * inside a render.
 */
function line(props: ComponentProps<typeof StatusLine>): string {
  return renderToStaticMarkup(createElement(StatusLine, props));
}

describe('a state said in full', () => {
  it('draws the glyph, the word and what follows it', () => {
    const drawn = line({ state: 'done', word: 'ab', detail: 'cd' });

    expect(drawn).toContain('data-run-state="done"');
    expect(drawn).toContain('>ab<');
    expect(drawn).toContain('cd');
    expect(drawn).not.toContain('data-provenance');
  });

  /**
   * The word and what follows it are the state as
   * much as the mark is, so the whole line is drawn
   * in the state's tone, through the ink high
   * contrast substitutes.
   */
  it('says the whole line in the state’s tone', () => {
    const drawn = line({ state: 'failed', word: 'ab', detail: 'cd' });

    const root = drawn.slice(0, drawn.indexOf('>'));

    expect(root).toContain('class="status-line"');
    expect(root).toContain('style="color:var(--state-ink, var(--fail))"');
  });

  /**
   * A state is what a ledger recorded rather than
   * something anybody wrote, so the whole line is
   * machine text and asks for its face by the hook.
   */
  it('writes its line in the machine face by its hook', () => {
    const drawn = line({ state: 'done', word: 'ab', detail: 'cd' });

    const root = drawn.slice(0, drawn.indexOf('>'));

    expect(root).toContain('class="status-line"');
    expect(root).toContain('data-mono=""');
  });

  /**
   * A line has no room for a second word beside the
   * detail it is already carrying, so the admission
   * that this state was worked out rides in the
   * title — which, since nothing else names the
   * line, is what a pointer and a screen reader both
   * find there.
   */
  it('admits a state it worked out rather than read', () => {
    const drawn = line({ state: 'running', word: 'ab', derived: 'ef' });

    expect(drawn).toContain('data-provenance="derived"');
    expect(drawn).toContain('title="ef"');
  });
});
