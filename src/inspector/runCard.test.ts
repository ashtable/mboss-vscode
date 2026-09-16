import { describe, expect, it } from 'vitest';

import { inspectorWords } from '../canvas/words.js';
import { INLINE_LIMIT } from '../runs/rows.js';
import { filled } from '../webview/fill.js';

import { runCardOf, type RunInputRead } from './runCard.js';

/**
 * The Runs view, as a trigger's card shows it.
 *
 * The card reads the Runs view and never writes it,
 * so what is pinned here is what the card says of
 * what it read: the sample a run would start with,
 * whether Run would start what the canvas shows,
 * and the two sentences about a Runs view set
 * elsewhere or a start it refused.
 */

const strings = inspectorWords();

/** The Runs view about a saved, trusted, manual
 *  workflow, with an empty box set to it. */
function read(over: Partial<RunInputRead> = {}): RunInputRead {
  return {
    text: '',
    selectedWorkflow: 'groom_booking',
    saved: { name: 'groom_booking', mode: 'manual' },
    needsTopic: false,
    unsaved: false,
    trusted: true,
    problem: undefined,
    ...over,
  };
}

const card = (over: Partial<RunInputRead> = {}) =>
  runCardOf(read(over), strings);

describe('the workflow a trigger’s card names', () => {
  it('is the saved workflow, by name', () => {
    expect(card().saved).toBe('groom_booking');
  });

  it('is nothing where the Runs view has no saved workflow for the file', () => {
    expect(card({ saved: undefined }).saved).toBeUndefined();
  });
});

describe('the sample a run would start with', () => {
  it('is nothing for an empty box', () => {
    expect(card({ text: '' }).sample).toBeUndefined();
    expect(card({ text: '   ' }).sample).toBeUndefined();
  });

  it('prints JSON the way a recorded payload is printed', () => {
    expect(card({ text: '{ "bookingId": 7 }' }).sample).toEqual({
      json: true,
      value: { kind: 'inline', text: '{ "bookingId": 7 }' },
    });
  });

  it('draws text that is not JSON as it was typed, and says so', () => {
    expect(card({ text: '{ bookingId:' }).sample).toEqual({
      json: false,
      value: { kind: 'inline', text: '{ bookingId:' },
    });
  });

  /** By the one rule every recorded value is drawn
   *  under: the same limit, the same size. */
  it('names a long one by its size rather than drawing it', () => {
    const text = JSON.stringify({ note: 'x'.repeat(INLINE_LIMIT) });

    expect(card({ text }).sample).toMatchObject({
      json: true,
      value: { kind: 'artifact', size: `${text.length} B` },
    });
  });
});

describe('what the card says beside the sample', () => {
  it('says Run switches the Runs view where it is set to another workflow', () => {
    expect(card({ selectedWorkflow: 'expense_claim' }).switches).toBe(
      filled(strings.localRunsSetTo, 'expense_claim', 'groom_booking'),
    );
  });

  it('says nothing of switching where the Runs view is set to this one, or to none', () => {
    expect(card().switches).toBeUndefined();
    expect(card({ selectedWorkflow: undefined }).switches).toBeUndefined();
    expect(
      card({ saved: undefined, selectedWorkflow: 'expense_claim' }).switches,
    ).toBeUndefined();
  });

  /** A refusal is about the workflow the Runs view is
   *  set to, which is this card's only when it is
   *  this workflow. */
  it('says why the last start was refused only where it was a start of this workflow', () => {
    const problem = { detail: 'The app is not up.', rebuildToRun: false };

    expect(card({ problem }).refused).toBe('The app is not up.');
    expect(
      card({ problem, selectedWorkflow: 'expense_claim' }).refused,
    ).toBeUndefined();
    expect(card({ problem, saved: undefined }).refused).toBeUndefined();
  });
});

describe('whether Run would start what the canvas shows', () => {
  it('starts the saved workflow by name', () => {
    expect(card().start).toEqual({ ok: true, workflow: 'groom_booking' });
  });

  /** Said before anything about the file, because
   *  nothing a person does to the document changes
   *  it. */
  it('refuses first for a window nobody has trusted', () => {
    expect(card({ trusted: false, unsaved: true }).start).toEqual({
      ok: false,
      reason: strings.untrusted,
    });
  });

  /** Any unsaved change means a run would start
   *  something that is not on screen, and saving is
   *  also how a file gets the topic it lacks. */
  it('asks for a save while the document has unsaved changes', () => {
    expect(card({ unsaved: true }).start).toEqual({
      ok: false,
      reason: strings.saveToRun,
    });
    expect(
      card({ unsaved: true, saved: undefined, needsTopic: true }).start,
    ).toEqual({ ok: false, reason: strings.saveToRun });
  });

  it('says a saved event trigger needs a topic before it can run', () => {
    expect(card({ saved: undefined, needsTopic: true }).start).toEqual({
      ok: false,
      reason: strings.needsTopic,
    });
  });

  it('asks for a save where the Runs view has no saved workflow for the file', () => {
    expect(card({ saved: undefined }).start).toEqual({
      ok: false,
      reason: strings.saveToRun,
    });
  });

  /** A trigger on a schedule is started by DBOS and
   *  never by Run; the pane says so in the run's
   *  place, and this answer is never drawn. */
  it('offers no run of a workflow saved on a schedule', () => {
    expect(
      card({ saved: { name: 'groom_booking', mode: 'schedule' } }).start,
    ).toEqual({ ok: false, reason: strings.saveToRun });
  });
});
