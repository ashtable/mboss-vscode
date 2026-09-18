import { describe, expect, it } from 'vitest';

import type { WorkflowIR } from '../core/rules.js';
import { messages } from '../messages.js';
import { FORM_INTAKE, TIMER_THEN_ANSWER } from '../test-support/runs.js';
import { shortRunId } from '../webview/ids.js';
import type {
  RunRow,
  SeeRun,
  TraceDetail,
  TraceRowView,
} from '../webview/protocol.js';
import { glyphStateOf, type RunWord } from '../webview/states.js';
import { fine, when } from '../webview/time.js';

import type { RecordedRunEvidence } from './evidence.js';
import type { Run, Step } from './rows.js';
import {
  evidenceEcho,
  evidenceLines,
  evidenceSentence,
  rowOf,
  runControlsOf,
  runLine,
  seeInit,
  seeTitle,
  type SeeView,
} from './view.js';
import { runWords } from './words.js';

/**
 * The two init messages, as words.
 *
 * A webview has no localization bundle and may draw
 * no string the host did not resolve, so everything
 * a person reads in either surface is composed
 * here.
 */

const RUN: Run = {
  workflowId: 'wf_c9d2f3',
  name: 'groom_booking',
  status: 'SUCCESS',
  recoveryAttempts: 2,
  executorId: 'local-dev',
  applicationVersion: 'v0.4.1',
  createdAt: 0,
  startedAt: 0,
  completedAt: 10_000,
  error: undefined,
  forkedFrom: undefined,
  wasForkedFrom: false,
};

function step(functionId: number, from: number, to: number): Step {
  return {
    functionId,
    name: `step_${functionId}`,
    startedAt: from,
    completedAt: to,
    output: `{"n":${functionId}}`,
    error: undefined,
    childWorkflowId: undefined,
  };
}

const STEPS = [step(0, 0, 1000), step(1, 1000, 2000), step(2, 8000, 9000)];

/**
 * The moment every list row below is read at.
 * Built from local components rather than written
 * as an epoch: the list writes the machine's own
 * clock, so a literal would name a different hour
 * on every machine.
 */
const NOW = new Date(2026, 8, 11, 18, 30).getTime();

const DAY = 24 * 60 * 60 * 1000;

/** A row as the list draws it: at that moment, in
 *  English. */
const listed = (run: Run, page: readonly Run[] = []): RunRow =>
  rowOf(run, page, NOW, 'en-US');

/** A run dispatched once, that started ten minutes
 *  before that moment and took ten seconds, and
 *  the clock the list writes for it. */
const TODAY: Run = {
  ...RUN,
  recoveryAttempts: 1,
  createdAt: NOW - 600_000,
  completedAt: NOW - 590_000,
};

const TODAY_AT = when(TODAY.createdAt, NOW, 'en-US');

/** A run another one was replayed from, with the
 *  id DBOS mints for a run started at the top. */
const PARENT = '5e7a1c3d-2b4f-4a6c-8d0e-1f2a3b4c5d6e';

describe('a row of the run history', () => {
  it('names a run by the workflow it is a run of', () => {
    const shown = listed(RUN);

    expect(shown.workflowId).toBe('wf_c9d2f3');
    expect(shown.name).toBe('groom_booking');
  });

  /**
   * Recovering is a thing that happened during a
   * run, not a way one ended, so the glyph says how
   * it ended and the edge says it recovered.
   */
  it('marks a run that recovered, whatever it went on to do', () => {
    const shown = listed(RUN);

    expect(shown.state).toBe('done');
    expect(shown.recovered).toBe(true);
  });

  /**
   * The line says a run recovered; the number is
   * worth its space only past the first crash. It
   * also keeps the sentence grammatical, which one
   * without plural forms otherwise would not be
   * for the commonest case there is. The count is
   * worked out from a column that counts
   * dispatches, and the note says so.
   */
  it('counts the crashes past the first, and says it worked them out', () => {
    expect(listed(RUN).recoveredNote).toBeUndefined();
    expect(listed({ ...RUN, recoveryAttempts: 3 }).recoveredNote).toBe(
      'recovered from 2 crashes · derived',
    );
  });

  it('draws a failure loudly and says what it was', () => {
    const shown = listed({ ...RUN, status: 'ERROR', error: 'login failed' });

    expect(shown.state).toBe('failed');
    expect(shown.error).toBe('login failed');
  });

  /**
   * A run DBOS gave up on wears the failed glyph,
   * because that is what it is, and says in its own
   * word that nothing will pick it back up.
   */
  it('draws a run DBOS gave up on as a failure, and says it gave up', () => {
    const shown = listed({ ...RUN, status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED' });

    expect(shown.state).toBe('failed');
    expect(shown.status).toBe('MAX_RECOVERY_ATTEMPTS_EXCEEDED');
    expect(shown.line.startsWith(runWords().gaveUp)).toBe(true);
  });

  /**
   * And a run somebody stopped is not news about the
   * code at all. It stays under Failed, because that
   * filter is DBOS's own partial index — but it is
   * drawn idle and says what happened, since nobody
   * has to go and look into it.
   */
  it('draws a run somebody cancelled idle, and says it was cancelled', () => {
    const shown = listed({ ...RUN, status: 'CANCELLED' });

    expect(shown.state).toBe('idle');
    expect(shown.status).toBe('CANCELLED');
    expect(shown.line.startsWith(runWords().cancelled)).toBe(true);
    expect(listed({ ...RUN, status: 'ERROR' }).state).toBe('failed');
  });

  it('draws a run that has not finished as still going', () => {
    const going = { ...RUN, status: 'PENDING', completedAt: undefined };

    expect(listed({ ...going, recoveryAttempts: 1 }).state).toBe('running');
  });

  /** The column counts dispatches, so one more than
   *  the first is the first time anything picked the
   *  run back up — and somebody reading a slow run is
   *  owed that word. */
  it('says recovering for a run something picked back up', () => {
    const again = { ...RUN, status: 'PENDING', completedAt: undefined };

    expect(listed(again).state).toBe('recovering');
  });

  it('says queued for a run nothing has claimed yet', () => {
    for (const status of ['ENQUEUED', 'DELAYED']) {
      expect(listed({ ...RUN, status, completedAt: undefined }).state).toBe(
        'queued',
      );
    }
  });

  /** Where a replay of a failed run would start:
   *  the first row of its own that threw. */
  it('carries the first step that threw', () => {
    expect(listed({ ...RUN, status: 'ERROR', failedStep: 2 }).failedStep).toBe(
      2,
    );
    expect(listed(RUN).failedStep).toBeUndefined();
  });

  /**
   * The list read asks every run where it began,
   * and a run that is not a replay began at the
   * top — which is not worth a field.
   */
  it('names what a run is a replay of, and where it began', () => {
    const shown = listed({ ...RUN, forkedFrom: PARENT, startStep: 3 });

    expect(shown.lineage).toEqual([
      {
        direction: 'of',
        workflowId: PARENT,
        short: shortRunId(PARENT),
        startStep: 3,
      },
    ]);
    expect(shown.startStep).toBe(3);

    const plain = listed({ ...RUN, startStep: 0 });

    expect(plain.lineage).toEqual([]);
    expect(plain.startStep).toBeUndefined();
  });

  /**
   * Out of the runs the page already holds and out
   * of nothing else. `forked_from` is a column every
   * row selects, so a child that is on screen is a
   * line the list can draw for free — and a child
   * that is not is a query nobody asked for.
   */
  it('names the runs replayed from it that are on this page', () => {
    const parent = { ...RUN, wasForkedFrom: true, startStep: 0 };
    const child = {
      ...RUN,
      workflowId: 'wf_fork1',
      status: 'ERROR',
      forkedFrom: 'wf_c9d2f3',
      startStep: 2,
    };

    expect(listed(parent, [parent, child]).lineage).toEqual([
      {
        direction: 'to',
        workflowId: 'wf_fork1',
        short: shortRunId('wf_fork1'),
        startStep: 2,
        word: 'failed',
      },
    ]);
    expect(listed(parent, [parent]).lineage).toEqual([]);
  });

  /** A lineage line says where the replay began,
   *  and a run read without that has no line to
   *  draw. */
  it('draws no lineage for a run read without its start step', () => {
    expect(listed({ ...RUN, forkedFrom: PARENT }).lineage).toEqual([]);
  });

  /**
   * A run DBOS gave up on and a run that threw both
   * wear the failed glyph, and a cancelled one the
   * idle glyph, so the glyph cannot say whether
   * Resume or Cancel run is on offer. The host says,
   * by the rule the Inspector's card reads.
   */
  it('offers a listed run the controls its status allows', () => {
    const offered = {
      PENDING: { cancel: true, resume: false },
      ENQUEUED: { cancel: true, resume: false },
      CANCELLED: { cancel: false, resume: true },
      MAX_RECOVERY_ATTEMPTS_EXCEEDED: { cancel: false, resume: true },
      SUCCESS: { cancel: false, resume: false },
      ERROR: { cancel: false, resume: false },
    };

    for (const [status, controls] of Object.entries(offered)) {
      const run = { ...RUN, status };
      const card = runControlsOf(run, false);

      expect(listed(run).controls).toEqual(controls);
      expect(listed(run).controls).toEqual({
        cancel: card.cancel,
        resume: card.resume,
      });
    }
  });
});

describe('one run in detail', () => {
  const init = seeInit({
    run: RUN,
    steps: STEPS,
    selectedStep: 2,
    note: undefined,
  });
  const run = init.run;

  it('is addressed to the view that draws it', () => {
    expect(init.view).toBe('see');
  });

  /**
   * What a run recorded about a block or about the
   * whole run is the Inspector's to say, so the run
   * page is sent none of the words it says it in and
   * none of what it would say.
   */
  it('carries nothing the Inspector says about a run', () => {
    const inspectors = [
      'status',
      'ledger',
      'workflowInput',
      'asRecorded',
      'cancel',
      'resume',
      'cancelledAt',
      'lastRecorded',
      'resumeHint',
      'resumeResetsAttempts',
      'bothRemain',
      'recoveredTag',
      'replay',
    ];

    expect(Object.keys(init).sort()).toEqual(
      ['run', 'showing', 'strings', 'type', 'view'].sort(),
    );
    expect(
      Object.keys(init.strings).filter((word) => inspectors.includes(word)),
    ).toEqual([]);
    expect(
      Object.keys(run ?? {}).filter((field) =>
        ['recovered', 'controls', 'lineage'].includes(field),
      ),
    ).toEqual([]);
  });

  /**
   * The trace is one list of the rows the run wrote,
   * with a length of time on each. A strip of the
   * same steps, a chart of the same lengths and the
   * table they were all read from said it three more
   * times, so none of them is sent any more, and
   * neither are the words they were labelled with.
   */
  it('carries no strip, timeline, table or groups any more', () => {
    expect(
      Object.keys(run ?? {}).filter((field) =>
        ['groups', 'chips', 'timeline', 'raw', 'showRaw', 'span'].includes(
          field,
        ),
      ),
    ).toEqual([]);
    expect(
      Object.keys(init.strings).filter((word) =>
        [
          'steps',
          'timeline',
          'hatched',
          'raw',
          'columns',
          'showRaw',
          'dbosOwned',
          'recorded',
          'childRun',
        ].includes(word),
      ),
    ).toEqual([]);
  });

  /**
   * The ledger, the input and what the last replay
   * did are the Inspector's card about the whole
   * run, so the page is sent none of them: the
   * header says which run it is and where it got
   * to, and nothing else.
   */
  it('carries no ledger, input, note or headline of its own', () => {
    expect(
      Object.keys(run ?? {}).filter((field) =>
        [
          'breadcrumb',
          'headline',
          'word',
          'rail',
          'selectedStep',
          'note',
          'input',
        ].includes(field),
      ),
    ).toEqual([]);
  });

  it('carries the step a replay would fork from', () => {
    expect(run?.selected.functionId).toBe(2);
  });

  it('has nothing to draw before a run is picked', () => {
    const empty = seeInit(undefined);

    expect(empty.run).toBeUndefined();
    expect(empty.strings.nothingSelected).toBe('Pick a run to see what it did');
  });
});

/**
 * Which run the tab is, said twice and differently.
 *
 * The header is one row, so it names the run by the
 * short id a person reads a run by and sums it up in
 * the line every surface uses. The whole id is the
 * editor tab's, where it can be read and copied
 * without costing the page a line.
 */
describe('the run tab’s title and line', () => {
  const run = seeInit({
    run: RUN,
    steps: STEPS,
    selectedStep: undefined,
    note: undefined,
  }).run;

  it('titles the tab with the workflow and the whole id', () => {
    if (run === undefined) throw new Error('no run to title');

    expect(seeTitle(run)).toBe('groom_booking · wf_c9d2f3');
  });

  /** `recovery_attempts` is two, so DBOS picked this
   *  run back up once and the line says so. */
  it('sums the run up after the workflow it is a run of', () => {
    expect(run?.line).toBe('groom_booking · done · 10.0 s · ↻ recovered');
    expect(run?.short).toBe(shortRunId('wf_c9d2f3'));
    expect(run?.state).toBe('done');
  });

  it('says a run still going in its word alone', () => {
    const going = seeInit({
      run: { ...RUN, status: 'PENDING', completedAt: undefined },
      steps: STEPS,
      selectedStep: undefined,
      note: undefined,
    }).run;

    expect(going?.line).toBe('groom_booking · recovering');
    expect(going?.state).toBe('recovering');
  });
});

/**
 * What a row says about where a run got to, in one
 * line: the run's word, then the parts that word
 * has to say.
 *
 * The block is worked out from the last operation
 * the run recorded of its own, which is the only
 * thing the ledger holds about where a run is —
 * nothing marks a run as "at" a block. So the row
 * wears the word that says the line was derived.
 */
describe('the line a listed run is summed up in', () => {
  it('dates a finished run, times it and counts its blocks', () => {
    // The today form, so the lines below are the
    // clock alone.
    expect(TODAY_AT).toMatch(/^\d{2}:\d{2}$/);

    expect(listed({ ...TODAY, operationCount: 3 }).line).toBe(
      `done · ${TODAY_AT} · 10.0 s · 3 steps`,
    );
    expect(listed({ ...TODAY, operationCount: 1 }).line).toBe(
      `done · ${TODAY_AT} · 10.0 s · 1 step`,
    );
    expect(listed({ ...TODAY, operationCount: 0 }).line).toBe(
      `done · ${TODAY_AT} · 10.0 s`,
    );
    expect(listed(TODAY).line).toBe(`done · ${TODAY_AT} · 10.0 s`);
  });

  /** A 24-hour clock in every language, with the
   *  month named in the editor's. */
  it('names the day of a run from before today', () => {
    const created = NOW - 2 * DAY;
    const day = when(created, NOW, 'en-US');
    const shown = listed({
      ...TODAY,
      createdAt: created,
      completedAt: created + 10_000,
    });

    expect(day).toMatch(/^[A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}$/);
    expect(shown.line.startsWith(`done · ${day} ·`)).toBe(true);

    for (const part of shown.line.split(' · ')) {
      expect(part).not.toMatch(/AM|PM/);
    }
  });

  it('says which block a failure stopped at', () => {
    const failed = { ...TODAY, status: 'ERROR' };

    expect(listed({ ...failed, lastOperation: 'charge_card.r2' }).line).toBe(
      `failed · charge_card · ${TODAY_AT} · 10.0 s`,
    );
    expect(listed(failed).line).toBe(`failed · ${TODAY_AT} · 10.0 s`);
  });

  /**
   * Dead-lettering writes no error row, so the
   * block the run last finished is all the ledger
   * says. Restarted until DBOS stopped is what the
   * word means, so no recovered tag follows it.
   */
  it('says a run DBOS gave up on gave up, after its last block', () => {
    const dead = {
      ...TODAY,
      status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
      recoveryAttempts: 2,
    };

    expect(listed({ ...dead, lastOperation: 'find_slot' }).line).toBe(
      `gave up · after find_slot · ${TODAY_AT}`,
    );
    expect(listed(dead).line).toBe(`gave up · ${TODAY_AT}`);
  });

  it('says since when a run has waited on a person', () => {
    const last = NOW - 120_000;
    const since = when(last, NOW, 'en-US');
    const waiting = {
      ...TODAY,
      status: 'PENDING',
      completedAt: undefined,
      lastOperationAt: last,
    };

    expect(
      listed({ ...waiting, lastOperation: 'await_reply.register' }).line,
    ).toBe(`waiting · await_reply · since ${since}`);
    expect(
      listed({ ...waiting, lastOperation: 'await_reply.resend.2' }).line,
    ).toBe(`waiting · await_reply · since ${since}`);
    expect(
      listed({
        ...waiting,
        lastOperation: 'await_reply.register',
        lastOperationAt: undefined,
      }).line,
    ).toBe('waiting · await_reply');
  });

  /**
   * The wake is the deadline the SDK wrote on the
   * sleep row, said as a clock and never as the
   * epoch it is stored as. Once that moment is past
   * the run is running again, whatever it has not
   * yet written.
   */
  it('says when a run asleep on the clock wakes, and what it got past', () => {
    const wakes = when(NOW + 60_000, NOW, 'en-US');
    const asleep = {
      ...TODAY,
      status: 'PENDING',
      completedAt: undefined,
      lastOperation: 'load_records',
      sleepingUntil: NOW + 60_000,
    };
    const shown = listed(asleep);

    expect(shown.state).toBe('waiting');
    expect(shown.line).toBe(`waiting · after load_records · wakes ${wakes}`);
    expect(shown.line).not.toContain(String(NOW + 60_000));
    expect(listed({ ...asleep, lastOperation: undefined }).line).toBe(
      `waiting · wakes ${wakes}`,
    );
    expect(listed({ ...asleep, sleepingUntil: NOW - 1 }).line).toBe(
      `running · after load_records · ${TODAY_AT}`,
    );
  });

  /** How long a run still going took would be
   *  stale the moment it was drawn. */
  it('says where a running run got to', () => {
    const going = { ...TODAY, status: 'PENDING', completedAt: undefined };

    expect(listed({ ...going, lastOperation: 'find_slot' }).line).toBe(
      `running · after find_slot · ${TODAY_AT}`,
    );
    expect(listed(going).line).toBe(`running · ${TODAY_AT}`);
  });

  /** The run tab and the Inspector say
   *  "recovering" for the same run, and the mark
   *  beside the line turns. */
  it('says a recovering run is recovering, where it got to and no more', () => {
    const again = {
      ...TODAY,
      status: 'PENDING',
      recoveryAttempts: 2,
      completedAt: undefined,
      lastOperation: 'find_slot',
    };

    expect(listed(again).line).toBe(
      `recovering · after find_slot · ${TODAY_AT}`,
    );
  });

  it('says a queued or a cancelled run in its word and when it started', () => {
    for (const status of ['ENQUEUED', 'DELAYED']) {
      expect(listed({ ...TODAY, status, completedAt: undefined }).line).toBe(
        `queued · ${TODAY_AT}`,
      );
    }

    expect(listed({ ...TODAY, status: 'CANCELLED' }).line).toBe(
      `cancelled · ${TODAY_AT}`,
    );
  });

  it('says a finished run was picked back up', () => {
    const tag = messages.runsRecoveredTag();

    expect(
      listed({ ...TODAY, recoveryAttempts: 2, operationCount: 3 }).line,
    ).toBe(`done · ${TODAY_AT} · 10.0 s · 3 steps · ${tag}`);
    expect(
      listed({ ...TODAY, status: 'ERROR', recoveryAttempts: 2 }).line,
    ).toBe(`failed · ${TODAY_AT} · 10.0 s · ${tag}`);
  });

  /**
   * By the short id, as text: the whole id is on
   * the parent's own row, and the line has no room
   * for thirty-six characters. A scheduled firing's
   * id is shortened as well as a UUID is.
   */
  it('says which run a replay came out of, by its short id', () => {
    const shown = listed({ ...TODAY, forkedFrom: PARENT, startStep: 2 });

    expect(shown.line).toBe(
      `done · replay of ${shortRunId(PARENT)} · ${TODAY_AT} · 10.0 s`,
    );
    expect(shown.line).not.toContain(PARENT);

    const nightly = 'sched-nightly_sync-2026-09-11T02:00:00.000Z';
    const fired = listed({ ...TODAY, forkedFrom: nightly, startStep: 2 });

    expect(fired.line).toContain(`replay of ${shortRunId(nightly)}`);
    expect(fired.line).not.toContain(nightly);
  });
});

describe('a run waiting on a person', () => {
  /**
   * Only the shape of the last operation says so.
   * A run is `PENDING` whether it is executing a
   * step or parked on somebody's inbox, and telling
   * those apart is the whole reason the list reads
   * the other table at all.
   */
  it('calls a run waiting only when its last operation says so', () => {
    const inFlight = {
      ...RUN,
      status: 'PENDING',
      recoveryAttempts: 1,
      completedAt: undefined,
      lastOperationAt: 1000,
    };

    expect(listed({ ...inFlight, lastOperation: 'x.register' }).state).toBe(
      'waiting',
    );
    expect(listed({ ...inFlight, lastOperation: 'x.resend.2' }).state).toBe(
      'waiting',
    );
    expect(listed({ ...inFlight, lastOperation: 'x.clear' }).state).toBe(
      'running',
    );
    expect(listed({ ...inFlight, lastOperation: 'find_slot' }).state).toBe(
      'running',
    );

    // A run that has ended is not waiting for
    // anybody, whatever its last row was.
    expect(
      listed({ ...RUN, lastOperation: 'x.register', lastOperationAt: 1000 })
        .state,
    ).toBe('done');
  });

  /** Built from local components rather than
   *  written as an epoch: the clock reads the
   *  machine's own zone, so a literal would name a
   *  different hour on every machine. */
  it('takes the moment a run last recorded something', () => {
    const at = new Date(2026, 8, 11, 18, 24, 19, 240).getTime();

    expect(listed({ ...RUN, lastOperationAt: at }).stoppedAt).toBe('18:24');
  });

  it('has no such moment for a run with no operation of its own', () => {
    expect(listed(RUN).stoppedAt).toBeUndefined();
  });

  /**
   * The two readers hold different evidence and ask
   * the question of what they have. The list has one
   * recorded name per run; the page has every row the
   * run wrote, read through a query that does not
   * select that column at all — so a page that asked
   * the list's question could only ever answer
   * `running`, however long the run had been sitting
   * in somebody's inbox.
   */
  it('says a parked run is waiting on the page as well as in the list', () => {
    const parked = {
      run: { ...RUN, status: 'PENDING', completedAt: undefined },
      steps: [
        { ...step(0, 0, 1000), name: 'parse_request' },
        { ...step(1, 1000, 2000), name: 'find_slot.register' },
      ],
      selectedStep: undefined,
      note: undefined,
    };

    expect(seeInit(parked).run?.state).toBe('waiting');
  });

  it('says a run whose blocks all cleared is running', () => {
    const woken = {
      run: {
        ...RUN,
        status: 'PENDING',
        recoveryAttempts: 1,
        completedAt: undefined,
      },
      steps: [
        { ...step(0, 0, 1000), name: 'find_slot.register' },
        { ...step(1, 1000, 2000), name: 'find_slot.clear' },
      ],
      selectedStep: undefined,
      note: undefined,
    };

    expect(seeInit(woken).run?.state).toBe('running');
  });
});

/**
 * One crossing, two readers.
 *
 * The list and the page hold different evidence for
 * whether a run is parked, and may disagree about
 * that on purpose. About everything else the
 * ledger says they must not: three crossings used
 * to answer this, and a status none of them had
 * heard of was done on one surface and still going
 * on the next.
 */
describe('one word for one run', () => {
  const page = (run: Run): SeeView => ({
    run,
    steps: [],
    selectedStep: undefined,
    note: undefined,
  });

  it('says the same word in the list and on the page', () => {
    const statuses = [
      'SUCCESS',
      'ERROR',
      'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
      'CANCELLED',
      'PENDING',
      'ENQUEUED',
      'DELAYED',
      'PAUSED',
    ];

    for (const status of statuses) {
      const run = { ...RUN, status, completedAt: undefined };

      expect(listed(run).state, status).toBe(seeInit(page(run)).run?.state);
    }
  });

  it('says a run DBOS gave up on gave up, on the page as well', () => {
    const dead = { ...RUN, status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED' };

    const shown = seeInit(page(dead)).run;

    expect(shown?.state).toBe(glyphStateOf('gaveUp'));
    expect(shown?.line).toContain(runWords().gaveUp);
    expect(listed(dead).state).toBe('failed');
    expect(listed(dead).line.startsWith(runWords().gaveUp)).toBe(true);
  });

  /** A status this build has never seen is a run
   *  still somewhere in flight, on both surfaces: a
   *  tick on a state nobody understands is the one
   *  claim neither may make. */
  it('calls a status it has never seen still going, on both', () => {
    const odd = { ...RUN, status: 'PAUSED', recoveryAttempts: 1 };

    expect(listed(odd).state).toBe('running');
    expect(seeInit(page(odd)).run?.state).toBe('running');
  });
});

/**
 * A run summed up in one line: its word, how long it
 * took once it is over, and whether DBOS picked it
 * back up. The run tab's header and the Inspector's
 * card both say this line, so it is composed once.
 */
describe('the line a run is summed up in', () => {
  const at = (
    word: RunWord,
    took: number | undefined,
    recovered = false,
  ): string =>
    runLine({
      word,
      createdAt: 5000,
      completedAt: took === undefined ? undefined : 5000 + took,
      recovered,
    });

  it('says how long a run that is over took', () => {
    expect(at('done', 1600)).toBe('done · 1.6 s');
    expect(at('failed', 8200)).toBe('failed · 8.2 s');
    expect(at('gaveUp', 7_500_000)).toBe('gave up · 2 h 5 m');
    expect(at('cancelled', 3200)).toBe('cancelled · 3.2 s');
  });

  /** A length of time for a run still going would be
   *  stale the moment it was drawn. */
  it('says a run that is not over in its word alone', () => {
    expect(at('running', undefined)).toBe('running');
    expect(at('recovering', undefined, true)).toBe('recovering');
    expect(at('waiting', undefined)).toBe('waiting');
    expect(at('queued', undefined)).toBe('queued');
  });

  /**
   * Only on a run that is over: a run still being
   * picked back up already says "recovering". A run
   * DBOS gave up on says it was restarted in its own
   * word, so the tag would say it twice.
   */
  it('tags a run that finished after DBOS picked it back up', () => {
    expect(at('done', 9100, true)).toBe('done · 9.1 s · ↻ recovered');
    expect(at('gaveUp', 7_500_000, true)).toBe('gave up · 2 h 5 m');
  });
});

/**
 * The run page's own half of the message: the
 * saved workflow and the trace, one recorded
 * operation to a row.
 */
describe('one run, as the run page draws it', () => {
  const IR = {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 4,
    name: 'groom_booking',
    nodes: [
      { id: 'parse_request', kind: 'step', title: 'Parse', config: {} },
      { id: 'find_slot', kind: 'step', title: 'Find a slot', config: {} },
    ],
    edges: [],
  } as unknown as WorkflowIR;

  const BOXES = {
    parse_request: { x: 0, y: 0, w: 230, h: 64 },
    find_slot: { x: 0, y: 120, w: 230, h: 64 },
  };

  /** The same run, created after its first step had
   *  already finished — which is what a fork looks
   *  like from inside. */
  const REPLAY: Run = {
    ...RUN,
    createdAt: 1500,
    forkedFrom: 'wf_a1b4e7',
  };

  function page(over: Partial<SeeView> = {}): SeeRun {
    const shown = seeInit({
      run: {
        ...RUN,
        input: { shape: 'payload', value: { email: 'ada@example.com' } },
      },
      steps: [
        { ...step(0, 0, 1000), name: 'parse_request' },
        { ...step(1, 1000, 2000), name: 'find_slot' },
      ],
      selectedStep: 1,
      note: undefined,
      ir: IR,
      boxes: BOXES,
      ...over,
    }).run;

    if (shown === undefined) throw new Error('no run to draw');

    return shown;
  }

  /** Every row the trace carries: the SDK's under
   *  their block rows, then the ones nothing owns. */
  function rows(run: SeeRun): TraceRowView[] {
    return [
      ...run.trace.flatMap((row) => [row, ...row.sdk]),
      ...run.unattributed,
    ];
  }

  /** The trace row a case is about, by the number
   *  DBOS gave it. */
  function rowAt(run: SeeRun, functionId: number): TraceRowView {
    const found = rows(run).find((one) => one.functionId === functionId);
    if (found === undefined) throw new Error(`no row ${functionId}`);

    return found;
  }

  /**
   * Every row a person can see carries whether a
   * replay may begin there, so a chip or a trace row
   * with no button says why instead of leaving a
   * gap.
   */
  it('says which rows a replay could start from', () => {
    const shown = page();

    expect(rows(shown).map((one) => [one.name, one.replayable])).toEqual([
      ['parse_request', true],
      ['find_slot', true],
    ]);
  });

  it('says why a row is not one', () => {
    const shown = page({
      steps: [
        { ...step(0, 0, 1000), name: 'parse_request' },
        { ...step(1, 1000, 2000), name: 'DBOS.sleep' },
      ],
    });
    const withheld = rows(shown).find((one) => one.name === 'DBOS.sleep');

    expect(withheld?.replayable).toBe(false);
    expect(withheld?.because).toBe(messages.replayRowSdkOwned());
  });

  /**
   * The rule is asked of a drawing, so a page with
   * no document beside it can offer no point at all
   * — and says so rather than offering every row.
   */
  it('offers no point at all without a document', () => {
    const shown = rows(page({ ir: undefined, boxes: undefined }));

    expect(shown.map((one) => one.replayable)).toEqual([false, false]);
    expect(shown[0]?.because).toBe(messages.replayNotOffered());
  });

  /**
   * A fork carries over every operation the run it
   * came from had already finished, timestamps and
   * all — so a row that completed before its own
   * run was created is one of those. Nothing in the
   * schema marks a row as copied, and this is the
   * only evidence there is.
   */
  it('marks a reused row reused, and an own row not', () => {
    const shown = page({ run: REPLAY });

    expect(rows(shown).map((one) => [one.name, one.reused])).toEqual([
      ['parse_request', true],
      ['find_slot', false],
    ]);
    expect(seeInit(undefined).strings.reused).toBe('reused');
  });

  it('carries the trace, the graph and the selection', () => {
    const shown = page({ selectedNode: 'find_slot', following: 'following' });

    expect(shown.graph?.caption).toBe('workflow as saved · revision 4');
    expect(shown.noGraph).toBeUndefined();
    expect(shown.graph?.ir.name).toBe('groom_booking');
    expect(shown.trace.map((row) => row.nodeId)).toEqual([
      'parse_request',
      'find_slot',
    ]);
    expect(shown.selected).toEqual({
      nodeId: 'find_slot',
      functionId: 1,
    });
    expect(shown.following).toBe('following');
  });

  /**
   * With no document nothing tells one row's block
   * from another's, so every row is drawn under no
   * block — apart, under the one label that says so,
   * which is exactly what a trace with no picture
   * beside it is. None of them is named after a
   * block: only the document says what a block is
   * called.
   */
  it('draws no graph for a run whose workflow the project lost', () => {
    const shown = page({ ir: undefined, boxes: undefined });

    expect(shown.graph).toBeUndefined();
    expect(shown.noGraph).toBe(
      'no saved workflow named groom_booking · trace only',
    );
    expect(shown.trace).toEqual([]);
    expect(
      shown.unattributed.map((row) => [row.functionId, row.nodeId]),
    ).toEqual([
      [0, undefined],
      [1, undefined],
    ]);
  });

  it('draws a block’s own row as one trace row', () => {
    const [first] = page().trace;

    expect(first?.name).toBe('parse_request');
    expect(first?.owner).toBe('node');
    expect(first?.nodeId).toBe('parse_request');
    expect(first?.duration).toBe('1.0 s');
    expect(first?.sdk).toEqual([]);
  });

  /**
   * The trace, one recorded operation to a row, in
   * the order DBOS numbered them: how long each
   * took, one line about what it did, the SDK's own
   * rows under the block row they ran beside, and a
   * row no block owns kept apart rather than filed
   * under a block it did not run in.
   */
  describe('a run’s trace, row by row', () => {
    const DAY = 86_400_000;

    /** When the intake form's wait gives up, three
     *  days after the page is read. */
    const DEADLINE = Date.now() + 3 * DAY;

    /** What a `void` step leaves: `null`, with the
     *  serializer's note that it was nothing. */
    const RETURNED_NOTHING =
      '{"json":null,"meta":{"values":["undefined"]},' +
      '"__dbos_serializer":"superjson"}';

    /** A run of a document, still going on its first
     *  dispatch, with the rows it has written. */
    function running(
      ir: WorkflowIR | undefined,
      steps: Step[],
      over: Partial<SeeView> = {},
    ): SeeRun {
      return page({
        run: {
          ...RUN,
          status: 'PENDING',
          recoveryAttempts: 1,
          completedAt: undefined,
        },
        steps,
        selectedStep: undefined,
        ir,
        boxes: undefined,
        ...over,
      });
    }

    /** Rows in the order DBOS numbered them, a tenth
     *  of a second apart. */
    function named(...names: string[]): Step[] {
      return names.map((name, index) => ({
        ...step(index, 1000 + index * 100, 1050 + index * 100),
        name,
      }));
    }

    /** The intake form parked on its answer: the
     *  message is not in yet, so only the sleep that
     *  times the wait out is recorded, and it has no
     *  width. */
    const PARKED: Step[] = [
      { ...step(0, 4000, 4100), name: 'ask_details' },
      { ...step(1, 4900, 5000), name: 'await_details.register' },
      {
        ...step(3, 5100, 5100),
        name: 'DBOS.sleep',
        output: String(DEADLINE),
      },
    ];

    /** The sleep a wait on the clock writes, due at
     *  `at`. */
    function sleepUntil(at: number): Step {
      return { ...step(0, 1000, at), name: 'DBOS.sleep', output: String(at) };
    }

    /** Every part of a row's line that says anything. */
    function said(row: TraceRowView): string[] {
      const { derived, plain, verbatim } = row.detail;

      return [derived, plain, verbatim].flatMap((part) =>
        part === undefined ? [] : [part],
      );
    }

    /**
     * A child start is written with one clock read
     * for both ends, so its length is always nothing;
     * a sleep's end is a deadline, not something that
     * happened.
     */
    it('times each row it can, and no child start and no sleep', () => {
      const shown = page({
        steps: [
          { ...step(0, 0, 1000), name: 'parse_request' },
          { ...step(1, 1000, 2000), name: 'find_slot' },
          {
            ...step(2, 2000, 2000),
            name: 'find_slot',
            childWorkflowId: 'wf_child',
          },
          { ...step(3, 2000, 90_000), name: 'DBOS.sleep', output: '90000' },
          { ...step(4, 0, 2100), name: 'find_slot', startedAt: undefined },
        ],
      });

      expect([0, 1, 2, 3, 4].map((id) => rowAt(shown, id).duration)).toEqual([
        '1.0 s',
        '1.0 s',
        undefined,
        undefined,
        undefined,
      ]);
    });

    it('says what a row returned, and that it was reused first', () => {
      const shown = page({ run: { ...REPLAY, recoveryAttempts: 1 } });

      expect(rowAt(shown, 0).detail).toEqual({
        derived: 'reused · ',
        plain: undefined,
        verbatim: '{ "n": 0 }',
      });
      expect(rowAt(shown, 1).detail).toEqual({
        derived: undefined,
        plain: undefined,
        verbatim: '{ "n": 1 }',
      });
    });

    /**
     * The recovered run's widest hole comes after its
     * first two rows, which therefore came back from
     * the ledger. A replay created after the first
     * finished carried that one over as well.
     */
    it('says a row was restored before it says it was reused', () => {
      const recovered = page({ steps: STEPS, ir: undefined, boxes: undefined });
      const replayed = page({
        run: { ...RUN, createdAt: 1500 },
        steps: STEPS,
        ir: undefined,
        boxes: undefined,
      });

      expect([0, 1, 2].map((id) => rowAt(recovered, id).detail)).toEqual([
        { derived: 'restored · ', plain: undefined, verbatim: '{ "n": 0 }' },
        { derived: 'restored · ', plain: undefined, verbatim: '{ "n": 1 }' },
        { derived: undefined, plain: undefined, verbatim: '{ "n": 2 }' },
      ]);
      expect(rowAt(replayed, 0).detail.derived).toBe('restored · reused · ');
    });

    it('names the block where a row returned nothing', () => {
      const shown = page({
        steps: [
          {
            ...step(0, 0, 1000),
            name: 'parse_request',
            output: RETURNED_NOTHING,
          },
          { ...step(1, 1000, 2000), name: 'find_slot', output: undefined },
        ],
      });

      expect(rowAt(shown, 0).detail).toEqual({
        derived: undefined,
        plain: 'Parse',
        verbatim: undefined,
      });
      expect(rowAt(shown, 1).detail).toEqual({
        derived: undefined,
        plain: 'Find a slot',
        verbatim: undefined,
      });
    });

    it('says what a failed row threw, the message as recorded', () => {
      const shown = page({
        steps: [
          {
            ...step(0, 0, 1000),
            name: 'parse_request',
            failure: { message: 'no body' },
          },
          {
            ...step(1, 1000, 2000),
            name: 'find_slot',
            failure: { name: 'TypeError', message: 'no slot' },
          },
          { ...step(2, 2000, 2100), name: 'find_slot' },
        ],
      });

      expect(rowAt(shown, 1).detail).toEqual({
        derived: undefined,
        plain: 'TypeError',
        verbatim: 'no slot',
      });
      expect(rowAt(shown, 0).detail).toEqual({
        derived: undefined,
        plain: undefined,
        verbatim: 'no body',
      });
      expect([0, 1, 2].map((id) => rowAt(shown, id).detailTone)).toEqual([
        'fail',
        'fail',
        'faint',
      ]);
    });

    /**
     * Only while it is parked: once the answer is in,
     * the registration is a row like any other and
     * says what it returned.
     */
    it('says when a parked wait began and gives up, only while parked', () => {
      const untimed = structuredClone(FORM_INTAKE);
      for (const node of untimed.nodes) {
        if (node.kind === 'durableWait') delete node.config.timeoutDays;
      }

      const shown = running(FORM_INTAKE, PARKED, { timing: true });
      const bare = running(untimed, PARKED, { timing: true });
      const answered = running(FORM_INTAKE, [
        ...PARKED,
        { ...step(4, 6000, 6100), name: 'await_details.clear' },
      ]);

      expect(rowAt(answered, 1).state).toBe('done');
      expect(rowAt(answered, 1).detail).toEqual({
        derived: undefined,
        plain: undefined,
        verbatim: '{ "n": 1 }',
      });

      expect(rowAt(shown, 1).state).toBe('waiting');
      expect(rowAt(shown, 1).detail).toEqual({
        derived: `waiting since ${fine(5000)} · timeout 3 d`,
        plain: undefined,
        verbatim: undefined,
      });
      expect(rowAt(bare, 1).detail.derived).toBe(`waiting since ${fine(5000)}`);
    });

    /**
     * A wait inside a loop registers once per round,
     * and the block stays parked from the first
     * round to the last — so whether a round is
     * still open is the round's own question, and
     * only the open one says since when.
     */
    it('says since when only of the round still parked', () => {
      const shown = running(
        FORM_INTAKE,
        named(
          'await_details.r1.register',
          'DBOS.recv',
          'DBOS.sleep',
          'await_details.r1.clear',
          'await_details.r2.register',
        ),
        { timing: true },
      );

      expect([0, 4].map((id) => rowAt(shown, id).state)).toEqual([
        'waiting',
        'waiting',
      ]);
      expect(rowAt(shown, 4).detail.derived).toBe(
        `waiting since ${fine(1450)} · timeout 3 d`,
      );
      expect(rowAt(shown, 0).detail.derived).toBeUndefined();
    });

    /**
     * The deadline is the one the SDK wrote, and it
     * is said as a moment: the number itself is the
     * ledger's, never the page's.
     */
    it('says when a sleeping wait wakes or woke, under the gate', () => {
      const ahead = Date.now() + DAY;
      const asleep = running(TIMER_THEN_ANSWER, [sleepUntil(ahead)], {
        timing: true,
      });
      const woken = running(TIMER_THEN_ANSWER, [sleepUntil(90_000)], {
        timing: true,
      });
      const parked = running(FORM_INTAKE, PARKED, { timing: true });

      expect(rowAt(asleep, 0).detail.derived).toBe(`wakes ${fine(ahead)}`);
      expect(rowAt(woken, 0).detail.derived).toBe(`woke ${fine(90_000)}`);
      expect(rowAt(parked, 3).detail.derived).toBe(
        `times out ${fine(DEADLINE)}`,
      );

      expect(said(rowAt(asleep, 0)).join()).not.toContain(String(ahead));
      expect(said(rowAt(woken, 0)).join()).not.toContain('90000');
      expect(said(rowAt(parked, 3)).join()).not.toContain(String(DEADLINE));
    });

    /**
     * An older SDK does not write the row the moment
     * is read from, so where the host has not said it
     * does, the row names its block instead.
     */
    it('says no wake and no deadline below the gate', () => {
      const ahead = Date.now() + DAY;

      for (const over of [{ timing: false }, {}]) {
        const shown = running(TIMER_THEN_ANSWER, [sleepUntil(ahead)], over);

        expect(rowAt(shown, 0).detail).toEqual({
          derived: undefined,
          plain: 'Let it wait',
          verbatim: undefined,
        });
      }

      expect(
        rowAt(running(FORM_INTAKE, PARKED, { timing: false }), 3).detail,
      ).toEqual({
        derived: undefined,
        plain: 'Wait for the details',
        verbatim: undefined,
      });
    });

    it('puts the SDK’s rows under the block row they ran beside', () => {
      const shown = running(
        FORM_INTAKE,
        named(
          'ask_details',
          'await_details.register',
          'DBOS.recv',
          'DBOS.sleep',
          'await_details.clear',
          'record_intake',
        ),
      );

      expect(
        shown.trace.map((row) => [
          row.functionId,
          row.nodeId,
          row.sdk.map((one) => one.functionId),
          row.sdkLabel,
        ]),
      ).toEqual([
        [0, 'ask_details', [], undefined],
        [
          1,
          'await_details',
          [2, 3],
          'await_details.register · 2 durable operations',
        ],
        [4, 'await_details', [], undefined],
        [5, 'record_intake', [], undefined],
      ]);
      expect(
        shown.trace[1]?.sdk.map((one) => [
          one.nodeId,
          one.owner,
          one.sdk,
          one.sdkLabel,
        ]),
      ).toEqual([
        ['await_details', 'sdk', [], undefined],
        ['await_details', 'sdk', [], undefined],
      ]);
      expect(shown.unattributed).toEqual([]);
    });

    /**
     * Named after the function the block runs where
     * it runs one, since that is where those rows
     * came from; after the row itself where it runs
     * none. One operation is said as one.
     */
    it('puts an SDK row nobody placed under the block row before it', () => {
      const steps = named('parse_request', 'DBOS.getStatus', 'find_slot');
      const handled = {
        ...IR,
        nodes: IR.nodes.map((node) =>
          node.id === 'parse_request'
            ? { ...node, handler: { export: 'parseRequest' } }
            : node,
        ),
      };

      const plain = page({ steps });

      expect(
        plain.trace.map((row) => [
          row.functionId,
          row.sdk.map((one) => [one.functionId, one.nodeId]),
        ]),
      ).toEqual([
        [0, [[1, 'parse_request']]],
        [2, []],
      ]);
      expect(plain.trace[0]?.sdkLabel).toBe(
        'parse_request · 1 durable operation',
      );
      expect(page({ steps, ir: handled }).trace[0]?.sdkLabel).toBe(
        'parseRequest · 1 durable operation',
      );
    });

    it('keeps a row no block owns apart', () => {
      const deleted = page({ steps: named('deleted_block', 'parse_request') });
      const early = page({ steps: named('DBOS.getEvent', 'parse_request') });
      const lost = page({ ir: undefined, boxes: undefined });

      expect(
        deleted.unattributed.map((row) => [row.functionId, row.owner]),
      ).toEqual([[0, 'unmapped']]);
      expect(deleted.trace.map((row) => [row.functionId, row.sdk])).toEqual([
        [1, []],
      ]);
      expect(
        early.unattributed.map((row) => [row.functionId, row.owner]),
      ).toEqual([[0, 'sdk']]);
      expect(early.trace.map((row) => [row.functionId, row.sdk])).toEqual([
        [1, []],
      ]);
      expect(lost.trace).toEqual([]);
      expect(lost.unattributed.map((row) => row.name)).toEqual([
        'parse_request',
        'find_slot',
      ]);
      expect(lost.unattributed.map((row) => row.nodeId)).toEqual([
        undefined,
        undefined,
      ]);
    });
  });
});

/**
 * When a run wakes, drawn only where the project's
 * SDK records the row it is read off.
 */
describe('when a run wakes', () => {
  /** One step, then a wait on the clock. */
  const WAITING = {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 2,
    name: 'expense_claim',
    nodes: [
      { id: 'file_it', kind: 'step', title: 'File it', config: {} },
      {
        id: 'hold_on',
        kind: 'durableWait',
        title: 'Hold on',
        config: { source: { kind: 'timer', seconds: 60 }, onTimeout: 'abort' },
      },
    ],
    edges: [
      {
        id: 'e1',
        from: { node: 'file_it', port: 'out' },
        to: { node: 'hold_on' },
      },
    ],
  } as unknown as WorkflowIR;

  function sleeping(over: Partial<SeeView> = {}): SeeRun {
    const shown = seeInit({
      run: { ...RUN, status: 'PENDING', completedAt: undefined },
      steps: [
        { ...step(0, 0, 1000), name: 'file_it' },
        { ...step(1, 1000, 90_000), name: 'DBOS.sleep', output: '90000' },
      ],
      selectedStep: 0,
      note: undefined,
      ir: WAITING,
      boxes: {
        file_it: { x: 0, y: 0, w: 230, h: 64 },
        hold_on: { x: 0, y: 120, w: 230, h: 64 },
      },
      ...over,
    }).run;

    if (shown === undefined) throw new Error('no run to draw');

    return shown;
  }

  /** The line under the sleep row the run wrote,
   *  wherever the trace draws that row. */
  function sleepLine(run: SeeRun | undefined): TraceDetail {
    const all = [
      ...(run?.trace ?? []).flatMap((row) => [row, ...row.sdk]),
      ...(run?.unattributed ?? []),
    ];
    const [sleep, ...more] = all.filter((row) => row.name === 'DBOS.sleep');

    if (sleep === undefined || more.length > 0) {
      throw new Error('not one sleep row');
    }

    return sleep.detail;
  }

  it('says when a sleeping block wakes, under the gate', () => {
    expect(sleepLine(sleeping({ timing: true })).derived).toMatch(
      /^(wakes|woke) /,
    );
  });

  /**
   * An older SDK does not write the deadline this is
   * read from, so below the gate there is no moment
   * to say — and the number the row holds is never
   * said in its place.
   */
  it('says nothing about it below the gate', () => {
    for (const shown of [sleeping({ timing: false }), sleeping()]) {
      const line = sleepLine(shown);
      const said = [line.derived, line.plain, line.verbatim].join(' ');

      expect(said).not.toMatch(/\b(wakes|woke|times out)\b/);
      expect(said).not.toContain('90000');
    }
  });

  it('says when a parked block gives up, wherever one is recorded', () => {
    const shown = seeInit({
      run: { ...RUN, status: 'PENDING', completedAt: undefined },
      steps: [
        { ...step(0, 0, 1000), name: 'manager_ok.register' },
        { ...step(1, 1000, 1000), name: 'DBOS.sleep', output: '90000' },
      ],
      selectedStep: 0,
      note: undefined,
      timing: true,
    }).run;

    expect(sleepLine(shown).derived).toMatch(/^times out /);
  });
});

/**
 * The two readings a parked run needs at once.
 *
 * One walk over the same rows answers two different
 * questions: which arm a branch took, read out of
 * what a step returned, and whether the run is
 * asleep, read off a sleep row's deadline. Each is
 * covered on its own; this is the run that asks
 * both, because the rows they read sit side by side
 * in one ledger.
 */
describe('a run that decided and then went to sleep', () => {
  const BRANCHING = {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 5,
    name: 'expense_claim',
    nodes: [
      {
        id: 'how_big',
        kind: 'branch',
        title: 'How big',
        config: {
          cases: [
            { port: 'large', when: { path: 'amount', op: 'gt', value: 500 } },
          ],
          elsePort: 'small',
        },
      },
      { id: 'charge_it', kind: 'step', title: 'Charge it', config: {} },
    ],
    edges: [
      {
        id: 'e1',
        from: { node: 'how_big', port: 'large' },
        to: { node: 'charge_it' },
      },
    ],
  } as unknown as WorkflowIR;

  /** The branch's own row as DBOS stores it, beside
   *  a sleep row whose deadline is `wakesAt`. */
  function parked(wakesAt: number): SeeRun {
    const shown = seeInit({
      run: {
        ...RUN,
        status: 'PENDING',
        recoveryAttempts: 1,
        completedAt: undefined,
      },
      steps: [
        {
          ...step(0, 0, 1000),
          name: 'how_big',
          output: JSON.stringify({
            json: { amount: 900 },
            __dbos_serializer: 'superjson',
          }),
        },
        {
          ...step(1, wakesAt - 120_000, wakesAt),
          name: 'DBOS.sleep',
          output: String(wakesAt),
        },
      ],
      selectedStep: 0,
      note: undefined,
      ir: BRANCHING,
      boxes: {
        how_big: { x: 0, y: 0, w: 230, h: 64 },
        charge_it: { x: 0, y: 160, w: 230, h: 64 },
      },
    }).run;

    if (shown === undefined) throw new Error('no run to draw');

    return shown;
  }

  it('reads the arm it took and reports it still asleep', () => {
    const shown = parked(Date.now() + 120_000);

    expect(shown.graph?.decided).toEqual({ how_big: 'large' });
    expect(shown.live?.outcome).toBe('waiting');
  });

  it('keeps the arm once the deadline has passed', () => {
    const shown = parked(Date.now() - 1000);

    expect(shown.graph?.decided).toEqual({ how_big: 'large' });
    expect(shown.live?.outcome).toBe('running');
  });
});

/**
 * What mBoss says it read out of a run, twice over:
 * the lines folded under the row it writes into the
 * transcript, and the question as the column shows
 * it.
 *
 * The agent is handed the run's full id and DBOS's
 * own status word, because it reads the ledger
 * with them. A person reads the column, where a
 * run is known by its short id and the word every
 * panel says, and where a value the run itself
 * recorded is kept apart from the words around it.
 */
describe('what mBoss says it read out of a run', () => {
  const RUN_ID = '7089cd29-5b5e-4a4c-9c3e-6c8d1b2f4a10';

  function recordedEvidence(
    over: Partial<RecordedRunEvidence> = {},
  ): RecordedRunEvidence {
    return {
      at: 'run',
      assembledAt: '2026-01-01T12:00:00.000Z',
      reader: {
        by: 'mboss-vscode',
        tables: ['dbos.workflow_status', 'dbos.operation_outputs'],
        database: 'db.local:5432/runs',
        from: 'DATABASE_URL',
      },
      workflow: 'refund_order',
      workflowId: RUN_ID,
      status: 'ERROR',
      executorId: 'local-dev',
      createdAt: '2026-01-01T12:00:00.000Z',
      recoveryAttempts: 1,
      recovered: false,
      input: { shape: 'none' },
      error: {
        name: 'StripeTimeoutError',
        message: 'the refund timed out',
        retriesExhausted: false,
      },
      focus: { nodeId: 'refund_payment', how: 'selected' },
      operations: [
        {
          functionId: 2,
          name: 'refund_payment',
          nodeId: 'refund_payment',
          owner: 'node',
          state: 'failed',
        },
      ],
      operationsTotal: 1,
      node: {
        id: 'refund_payment',
        title: 'Refund payment',
        kind: 'step',
      },
      document: { found: true, revision: 3 },
      ...over,
    };
  }

  it('sets a recorded error apart from the words around it', () => {
    const said = 'StripeTimeoutError: Awaited 0190c8f2-5b5e was cancelled';
    const lines = evidenceLines(
      recordedEvidence({
        error: {
          name: 'StripeTimeoutError',
          message: 'Awaited 0190c8f2-5b5e was cancelled',
          retriesExhausted: false,
        },
      }),
    );

    expect(lines).toContainEqual({ text: 'error · ', recorded: said });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.filter((line) => line.recorded !== undefined)).toHaveLength(1);
  });

  it('says where a run got to in the word every panel uses', () => {
    const lines = evidenceLines(
      recordedEvidence({
        status: 'SUCCESS',
        error: undefined,
        operations: [],
      }),
    );

    expect(lines).toContainEqual({ text: 'status · done' });
    expect(lines.some((line) => line.text.includes('SUCCESS'))).toBe(false);
  });

  it('says a run parked on somebody is waiting', () => {
    const lines = evidenceLines(
      recordedEvidence({
        status: 'PENDING',
        error: undefined,
        operations: [
          {
            functionId: 1,
            name: 'approve',
            nodeId: 'approve',
            owner: 'node',
            state: 'waiting',
          },
        ],
      }),
    );

    expect(lines).toContainEqual({ text: 'status · waiting' });
  });

  it('says when a refused run was refused on a 24-hour clock', () => {
    expect(
      evidenceLines({
        at: 'refused',
        assembledAt: '2026-01-01T13:05:00.000Z',
        workflow: 'groom_booking',
        refusedAt: new Date(2026, 0, 1, 13, 4, 5, 6).getTime(),
        detail: 'the app refused the request: 401',
        input: {},
      }),
    ).toEqual([
      { text: 'refused · groom_booking at 13:04:05.006' },
      { text: 'detail · ', recorded: 'the app refused the request: 401' },
    ]);
  });

  it("writes the column's copy of the question beside the agent's", () => {
    const succeeded = recordedEvidence({
      status: 'SUCCESS',
      error: undefined,
      operations: [],
    });
    const echo = evidenceEcho(succeeded);

    expect(echo).toContain(shortRunId(RUN_ID));
    expect(echo).toContain('done');
    expect(echo).not.toContain(RUN_ID);
    expect(echo).not.toContain('SUCCESS');

    // The agent keeps the id and the status it can
    // look the run up by.
    const asked = evidenceSentence(succeeded);

    expect(asked).toContain(RUN_ID);
    expect(asked).toContain('SUCCESS');
  });

  it('names a failed run by its short id where the column says it', () => {
    const echo = evidenceEcho(recordedEvidence());

    expect(echo).toContain(
      `Run \`${shortRunId(RUN_ID)}\` of \`refund_order\` failed at ` +
        'Refund payment — StripeTimeoutError: the refund timed out.',
    );
    expect(echo).not.toContain(RUN_ID);
  });
});
