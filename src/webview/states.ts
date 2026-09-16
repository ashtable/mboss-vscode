import {
  FAILED_STATUSES,
  QUEUED_STATUSES,
  SUCCEEDED_STATUS,
} from '../runs/queries.js';
import { FIRST_DISPATCH } from '../runs/rows.js';

/**
 * The word every panel says a run or a step in, and
 * the glyph each word wears.
 *
 * Two vocabularies run through this extension. The
 * ledger's — `SUCCESS`, `PENDING`,
 * `MAX_RECOVERY_ATTEMPTS_EXCEEDED` — is DBOS's, and
 * it belongs on a row of the ledger and nowhere
 * else: it is evidence, and an evidence panel that
 * paraphrased it would be worth nothing. The
 * panel's is a lowercase word somebody can read at
 * a glance. This file is the one crossing between
 * them, because a screen that half-translates is
 * how one panel came to say `ERROR` where the next
 * said "failed" about the same run — and three
 * crossings, each with its own copy of the ledger's
 * words, is how the list came to tick a status the
 * page called still going.
 *
 * Its own file, importing only what a browser
 * bundle can carry, because the host and four
 * browser bundles all say these words and the
 * module they would otherwise come from —
 * `runs/view.ts` — imports `messages.ts`, which
 * imports the editor API. The ledger's own words
 * are read from the query module that filters by
 * them, so the crossing and the filter cannot drift
 * apart.
 *
 * Keys, not copy. The words themselves are
 * localized once in `runs/words.ts` and travel to
 * the webviews in the bags, so a view can draw a
 * state without resolving a string of its own.
 */

/** What a glyph draws. A run takes seven of these
 *  and a service two. */
export type GlyphState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'recovering'
  | 'waiting'
  | 'done'
  | 'failed'
  | 'healthy';

/** The voice a state is drawn in, by token name:
 *  every view resolves one against the theme it is
 *  mounted in, and a colour written here would be
 *  the same colour in all four. */
export type Tone = '--ok' | '--warn' | '--fail' | '--ink-faint';

/** The character a state wears where there is room
 *  for one. */
export type Mark = '✓' | '✕' | '↻' | '·';

export type Glyph = { tone: Tone; mark: Mark };

/**
 * The keys a run's word is looked up by.
 *
 * `gaveUp` is the one with no glyph of its own: a
 * run restarted as often as DBOS allows and then
 * abandoned is a failure and is drawn as one, but
 * it is not a bug in the workflow and will keep
 * happening until somebody breaks the loop, so it
 * is worth its own word.
 */
export type RunWord =
  | 'done'
  | 'running'
  | 'recovering'
  | 'waiting'
  | 'queued'
  | 'failed'
  | 'gaveUp'
  | 'cancelled';

/**
 * The four a step may be said in.
 *
 * Written as a subset rather than as a list of its
 * own, so that a run word a step may not take
 * cannot be spelled here by accident, and so that a
 * step and the run around it are looked up in one
 * bag of words. A step's word is decided where its
 * row is read, on the host, with `running` added by
 * the board between two rows; nothing crosses on
 * the browser side, which is why there is no
 * function beside `runWord` for it.
 */
export type StepWord = Extract<
  RunWord,
  'done' | 'failed' | 'waiting' | 'running'
>;

/**
 * What a reader holds about a run, as much of it as
 * the word turns on.
 *
 * A structural shape rather than the row type, so
 * that whoever holds a row passes it and whoever
 * holds five columns of one passes those. Whether
 * the run is parked is part of what is held, and it
 * is answered once by whoever read the run: the two
 * readers hold different evidence for the same
 * question — the run tab has every row the run
 * wrote, the list has one recorded name — and
 * asking either of them the other's question is
 * what let one surface say "running" about a run
 * the other called "waiting".
 */
export type RunEvidence = {
  /** DBOS's own status column, as it was read. */
  status: string;

  /**
   * `recovery_attempts`, which counts dispatches
   * and not crashes: a run that worked first time
   * already carries one.
   *
   * Absent where the reader did not keep it — a
   * queue item's row carries no dispatch count, so
   * an item still going reads `running` and nothing
   * finer. That is a limit and not an answer.
   */
  recoveryAttempts?: number;

  /**
   * Whether the run is sitting on somebody: parked
   * on a person's say-so, or sitting out a timer.
   * The run tab reads it off every row the run
   * wrote, the list off the one recorded name it
   * selected, and a read with no evidence at all
   * says `false` and says so where it does.
   */
  parked: boolean;
};

/**
 * DBOS's own words, each held to the set the
 * filters read.
 *
 * Spelled singly because each has to be told apart
 * — a run that gave up is not a run that threw —
 * and held to the filter's set by the compiler, so
 * a word the filter stops reading cannot go on
 * being said here.
 */
type Failed = (typeof FAILED_STATUSES)[number];

const THREW = 'ERROR' satisfies Failed;
const CANCELLED = 'CANCELLED' satisfies Failed;
const DEAD_LETTERED = 'MAX_RECOVERY_ATTEMPTS_EXCEEDED' satisfies Failed;

/** Filed and not claimed by a worker yet, the
 *  second of them waiting out a delay as well. */
const QUEUED: readonly string[] = QUEUED_STATUSES;

const GLYPHS: Record<GlyphState, Glyph> = {
  idle: { tone: '--ink-faint', mark: '·' },
  queued: { tone: '--ink-faint', mark: '·' },
  running: { tone: '--ok', mark: '·' },
  recovering: { tone: '--warn', mark: '↻' },
  waiting: { tone: '--warn', mark: '·' },
  done: { tone: '--ok', mark: '✓' },
  failed: { tone: '--fail', mark: '✕' },
  healthy: { tone: '--ok', mark: '·' },
};

/** The words a run is over at: nothing more will be
 *  written about it unless somebody picks it back
 *  up. */
const SETTLED: readonly RunWord[] = ['done', 'failed', 'gaveUp', 'cancelled'];

/** The words a run is moving at, or about to: a
 *  watch keeps reading it, a board draws a frontier
 *  ahead of the ledger. Not `waiting`, which is a
 *  run going nowhere until somebody acts. */
const IN_FLIGHT: readonly RunWord[] = ['running', 'recovering', 'queued'];

/**
 * The word a run is said in.
 *
 * Whether the run is parked arrives on the evidence
 * rather than being worked out here, because the
 * two readers hold different evidence for the same
 * question (see `RunEvidence`).
 */
export function runWord(run: RunEvidence): RunWord {
  if (run.status === SUCCEEDED_STATUS) return 'done';
  if (run.status === CANCELLED) return 'cancelled';
  if (run.status === DEAD_LETTERED) return 'gaveUp';
  if (run.status === THREW) return 'failed';
  if (QUEUED.includes(run.status)) return 'queued';

  // What is left is `PENDING`, or a status this
  // build has not heard of — either way a run that
  // is still somewhere in flight. A tick on a status
  // nobody understands is the one claim this set
  // must never make.

  // Parked before dispatched twice: a run sitting
  // in somebody's inbox is not moving, whatever it
  // took to get it there.
  if (run.parked) return 'waiting';

  return (run.recoveryAttempts ?? FIRST_DISPATCH) > FIRST_DISPATCH
    ? 'recovering'
    : 'running';
}

/**
 * Whether a word is one a run is over at.
 *
 * Asked by the session log before it stamps how
 * long a run took, and by the list before it offers
 * to stop one. One answer here, because four sites
 * used to spell the set by hand and none of them
 * had heard of a run that gave up.
 *
 * `quiet` is answered too, though it is the watch's
 * word rather than the ledger's — a run the watch
 * let go of, which may yet move — so that "over"
 * has one answer for every word a panel can hold.
 */
export function settled(word: RunWord | 'quiet'): boolean {
  return word !== 'quiet' && SETTLED.includes(word);
}

/**
 * Whether a word is one a run is still moving at.
 *
 * What a watch keeps reading for, and what a board
 * draws a frontier ahead of the ledger for. A parked
 * run is neither: it is at the block it parked on.
 */
export function inFlight(word: RunWord | 'quiet'): boolean {
  return word !== 'quiet' && IN_FLIGHT.includes(word);
}

/**
 * Which glyph a word wears.
 *
 * Two words do not wear their own. A cancelled run
 * is drawn idle, because somebody asked for it and
 * it is not the news a run that threw is; a run
 * that gave up is drawn failed, because that is
 * what it is.
 */
export function glyphStateOf(word: RunWord): GlyphState {
  if (word === 'cancelled') return 'idle';
  if (word === 'gaveUp') return 'failed';

  return word;
}

/**
 * The tone and the mark one state is drawn in.
 *
 * Everything unfinished wears a dot: a tick on a
 * run that is still going is the one thing this set
 * must never say, and a turning mark on a run
 * parked on a person would deny that nothing is
 * happening in it. What tells those apart is the
 * shape the glyph draws around the mark — filled,
 * hollow, pulsing — which is the glyph's own
 * reading of the same state.
 */
export function glyphOf(state: GlyphState): Glyph {
  return GLYPHS[state];
}
