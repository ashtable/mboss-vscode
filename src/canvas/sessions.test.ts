import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { emitter } from '../emitter.js';
import { REPO_ROOT, sourceFiles } from '../test-support/repo.js';

import type { CanvasSession } from './editor.js';
import { canvasSessions } from './sessions.js';

/**
 * The canvases that are open, as everything that is
 * not a canvas finds them.
 *
 * The registry asks a session one thing, to hear
 * it move, so a session here is an identity and
 * its own signal, and a panel only the one flag
 * the registry reads.
 */

/** A session that can say it moved, and nothing
 *  else. */
function aSession(): CanvasSession & { moved(): void } {
  const changes = emitter();

  return {
    onChanged: changes.on,
    moved: () => changes.fire(),
  } as unknown as CanvasSession & { moved(): void };
}

/** A panel, as far as the registry reads one. */
function aPanel(active = false): { active: boolean } {
  return { active };
}

describe('the canvases that are open', () => {
  it('answers the canvas registered for a path', () => {
    const sessions = canvasSessions();
    const one = aSession();

    sessions.register('/p/a.workflow.json', one, aPanel());

    expect(sessions.forPath('/p/a.workflow.json')).toBe(one);
    expect(sessions.forPath('/p/b.workflow.json')).toBeUndefined();
  });

  it('resolves a wait for a canvas the moment it registers', async () => {
    const sessions = canvasSessions();
    const one = aSession();
    let answered: CanvasSession | undefined;

    const waiting = sessions.whenOpen('/p/a.workflow.json');
    void waiting.then((session) => {
      answered = session;
    });
    await Promise.resolve();

    expect(answered).toBeUndefined();

    sessions.register('/p/a.workflow.json', one, aPanel());

    expect(await waiting).toBe(one);
    expect(await sessions.whenOpen('/p/a.workflow.json')).toBe(one);
  });

  /** A registration is the first word about a canvas,
   *  and every move the canvas says after it is
   *  forwarded with the canvas as payload. */
  it('tells whoever follows it which canvas moved', () => {
    const sessions = canvasSessions();
    const one = aSession();
    const other = aSession();
    const moved: CanvasSession[] = [];

    sessions.onChanged((session) => moved.push(session));

    sessions.register('/p/a.workflow.json', one, aPanel());
    sessions.register('/p/b.workflow.json', other, aPanel());
    other.moved();
    one.moved();

    expect(moved).toEqual([one, other, other, one]);
  });

  it('stops telling a follower that has let go', () => {
    const sessions = canvasSessions();
    const one = aSession();
    const moved: CanvasSession[] = [];

    sessions.onChanged((session) => moved.push(session)).dispose();
    sessions.register('/p/a.workflow.json', one, aPanel());
    one.moved();

    expect(moved).toEqual([]);
  });

  it('stops forwarding a canvas whose registration has let go', () => {
    const sessions = canvasSessions();
    const one = aSession();
    const moved: CanvasSession[] = [];

    const registered = sessions.register('/p/a.workflow.json', one, aPanel());
    sessions.onChanged((session) => moved.push(session));

    registered.dispose();
    one.moved();

    expect(moved).toEqual([]);
  });

  it('answers the canvas somebody is looking at', () => {
    const sessions = canvasSessions();
    const behind = aSession();
    const inFront = aSession();
    const panel = aPanel();

    sessions.register('/p/a.workflow.json', behind, aPanel());
    sessions.register('/p/b.workflow.json', inFront, panel);

    expect(sessions.active()).toBeUndefined();

    panel.active = true;

    expect(sessions.active()).toBe(inFront);
  });

  it('forgets a canvas once its registration is let go of', () => {
    const sessions = canvasSessions();
    const panel = aPanel(true);

    sessions.register('/p/a.workflow.json', aSession(), panel).dispose();

    expect(sessions.forPath('/p/a.workflow.json')).toBeUndefined();
    expect(sessions.active()).toBeUndefined();
  });

  /**
   * A tab closed and opened again on the same file
   * can register before the old one has finished
   * going away, and the old registration letting go
   * must not take the new canvas with it.
   */
  it('keeps a newer canvas for the path when an older one lets go', () => {
    const sessions = canvasSessions();
    const newer = aSession();

    const older = sessions.register('/p/a.workflow.json', aSession(), aPanel());
    sessions.register('/p/a.workflow.json', newer, aPanel());
    older.dispose();

    expect(sessions.forPath('/p/a.workflow.json')).toBe(newer);
  });

  /**
   * Nothing else may keep a list of open canvases.
   *
   * A second list would be one no Inspector hears
   * from and no opening canvas can be waited on
   * through — which is exactly what the registry is
   * for — so the editor's own static copy has to be
   * gone, and nothing may ask for it.
   */
  it('is the only door to the open canvases', () => {
    const editor = readFileSync(
      join(REPO_ROOT, 'src', 'canvas', 'editor.ts'),
      'utf8',
    );

    expect(editor).not.toMatch(/static readonly open\b/);
    expect(editor).not.toMatch(/static active\(/);

    const asking = sourceFiles()
      .filter((path) =>
        /\bWorkflowCanvasEditor\.active\(/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => path.slice(path.lastIndexOf('src/')));

    expect(sourceFiles().length).toBeGreaterThan(0);
    expect(asking).toEqual([]);
  });
});
