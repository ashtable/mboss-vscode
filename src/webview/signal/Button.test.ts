import { Fragment, createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button, type ButtonProps } from './Button.js';

/**
 * The markup the shared Button writes.
 *
 * What it is painted as is asked on a page, where a
 * stylesheet exists; this is the other half — the
 * hooks every spec and journey finds it by, the
 * name a glyph-only control is given, and the one
 * span a label lands in. Both halves have to hold
 * for a `[data-use]` in a spec to keep meaning what
 * it meant before the view handed its markup over.
 *
 * Called rather than written as a tag, because this
 * tier runs no JSX. The two-letter words are this
 * spec's own, standing in for a view's: nothing
 * under this directory is in any language.
 */

/**
 * What the component wrote, and what it returned.
 *
 * Called where React would call it, inside a render,
 * because the id joining a refusal to its reason is
 * React's to mint and it can only be asked for
 * there. What it returned is kept as well as what it
 * drew: a press is a handler rather than an
 * attribute, so there is nothing in the string to
 * read it off and this tier has no page to press on.
 */
function shown(props: ButtonProps): {
  markup: string;
  control: ReactElement<{ onClick?: () => void }>;
} {
  let made: ReactElement = createElement('span');

  const markup = renderToStaticMarkup(
    createElement(() => {
      made = Button(props);

      return made;
    }),
  );
  const pair = made.props as { children: readonly ReactElement[] };

  return {
    markup,
    control: (made.type === Fragment
      ? pair.children[0]
      : made) as ReactElement<{ onClick?: () => void }>,
  };
}

describe('the Button every surface presses', () => {
  it('writes its label as its one span', () => {
    const { markup } = shown({
      variant: 'quiet',
      ink: 'brand',
      children: 'ab',
    });

    expect(markup).toContain('class="btn"');
    expect(markup).toContain('data-variant="quiet"');
    expect(markup).toContain('data-ink="brand"');
    expect(markup).toContain('data-size="sm"');
    expect(markup).toContain('<span>ab</span>');
    expect(markup.match(/<span/g)).toHaveLength(1);
  });

  it('carries through the hooks a view finds it by', () => {
    const { markup } = shown({
      variant: 'quiet',
      children: 'ab',
      hook: { 'quick-add-kind': 'step' },
      hookClass: 'template-use',
    });

    expect(markup).toContain('data-quick-add-kind="step"');
    expect(markup).toContain('class="btn template-use"');
  });

  /**
   * A glyph says nothing to a screen reader and
   * nothing to somebody who has not seen it before,
   * so the name travels both ways: as the accessible
   * name, and as the tooltip a pointer finds.
   */
  it('names a Button drawn as a glyph, twice', () => {
    const { markup } = shown({
      variant: 'quiet',
      icon: 'refresh',
      label: 'ab',
    });

    expect(markup).toContain('aria-label="ab"');
    expect(markup).toContain('title="ab"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<path');
    expect(markup).not.toContain('<span');
  });

  it('marks a Button whose label is machine evidence', () => {
    expect(
      shown({ variant: 'quiet', mono: true, children: 'ab' }).markup,
    ).toContain('data-mono=""');

    expect(shown({ variant: 'quiet', children: 'ab' }).markup).not.toContain(
      'data-mono',
    );
  });

  it('says a Button is working without taking its words away', () => {
    const { markup } = shown({
      variant: 'primary',
      busy: true,
      children: 'ab',
    });

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('<span>ab</span>');
  });

  /**
   * Refused rather than switched off. The native
   * attribute takes a control out of the tab order,
   * so somebody on a keyboard cannot reach the one
   * thing that would say why it will not answer —
   * and a tooltip is no answer either, since it takes
   * a pointer to find one. It stays a stop, says it
   * is unavailable, and points at the reason so the
   * two are read together.
   */
  it('keeps a Button that refuses a press reachable, with its reason', () => {
    const { markup } = shown({
      variant: 'quiet',
      disabled: true,
      reason: 'ab',
      children: 'cd',
    });

    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain('title=');
    expect(markup).toContain('<span class="field-hint"');

    const named = /aria-describedby="([^"]+)"/.exec(markup)?.[1] ?? '';
    const hint = markup.slice(markup.indexOf('<span class="field-hint"'));

    expect(named).not.toBe('');
    expect(hint).toContain(`id="${named}"`);
    expect(hint).toContain('data-mono=""');
    expect(hint).toContain('>ab</span>');
  });

  it('says nothing back when a Button that refuses is pressed', () => {
    const presses: string[] = [];
    const press = (refusing: boolean) =>
      shown({
        variant: 'quiet',
        disabled: refusing,
        reason: 'ab',
        onClick: () => presses.push(refusing ? 'refusing' : 'open'),
        children: 'cd',
      }).control.props.onClick?.();

    press(false);
    press(true);

    expect(presses).toEqual(['open']);
  });
});
