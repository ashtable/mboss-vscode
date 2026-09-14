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
 * said "failed" about the same run.
 *
 * Its own file, importing nothing, because the host
 * and four browser bundles all say these words and
 * the module they would otherwise come from —
 * `runs/view.ts` — imports `messages.ts`, which
 * imports the editor API.
 *
 * Keys, not copy. The words themselves are
 * localized once in `canvas/words.ts` and travel to
 * the webviews in the init message, so a view can
 * draw a state without resolving a string of its
 * own.
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
 * bag of words.
 */
export type StepWord = Extract<
  RunWord,
  'done' | 'failed' | 'waiting' | 'running'
>;

/**
 * What the ledger holds about a run, as much of it
 * as the word turns on.
 *
 * A structural shape rather than the row type, so
 * that whoever holds a row passes it and whoever
 * holds five columns of one passes those.
 */
export type RunReading = {
  /** DBOS's own status column, as it was read. */
  status: string;

  /**
   * `recovery_attempts`, which counts dispatches
   * and not crashes: a run that worked first time
   * already carries one.
   *
   * Absent where the reader never selected it — a
   * queue item is read by five columns and this is
   * not one of them, so an item still going reads
   * `running` and nothing finer. That is a limit
   * and not an answer.
   */
  recoveryAttempts?: number;
};

/** A step as whoever draws one holds it: what its
 *  row says, or the `running` worked out between
 *  two rows, since the ledger writes a step only
 *  once it has finished. */
export type StepReading = { state: StepWord };

/** DBOS's own words. Spelled here because this file
 *  imports nothing; `states.test.ts` holds them to
 *  the sets `runs/queries.ts` declares. */
const SUCCEEDED = 'SUCCESS';
const CANCELLED = 'CANCELLED';
const DEAD_LETTERED = 'MAX_RECOVERY_ATTEMPTS_EXCEEDED';
const THREW = 'ERROR';

/** Filed and not claimed by a worker yet, the
 *  second of them waiting out a delay as well. */
const QUEUED: readonly string[] = ['ENQUEUED', 'DELAYED'];

/** What `recovery_attempts` reads for a run nothing
 *  ever picked back up. */
const FIRST_DISPATCH = 1;

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

/**
 * The word a run is said in.
 *
 * Whether the run is parked arrives as an answer
 * rather than being worked out here, because the
 * two readers hold different evidence for the same
 * question: the run tab has every row the run
 * wrote, and the list has one recorded name and a
 * wake deadline. Asking either of them the other's
 * question is what let one surface say "running"
 * about a run the other called "waiting".
 */
export function runWord(run: RunReading, parked: boolean): RunWord {
  if (run.status === SUCCEEDED) return 'done';
  if (run.status === CANCELLED) return 'cancelled';
  if (run.status === DEAD_LETTERED) return 'gaveUp';
  if (run.status === THREW) return 'failed';
  if (QUEUED.includes(run.status)) return 'queued';

  // What is left is `PENDING`, or a status this
  // build has not heard of — either way a run that
  // is still somewhere in flight.

  // Parked before dispatched twice: a run sitting
  // in somebody's inbox is not moving, whatever it
  // took to get it there.
  if (parked) return 'waiting';

  return (run.recoveryAttempts ?? FIRST_DISPATCH) > FIRST_DISPATCH
    ? 'recovering'
    : 'running';
}

/**
 * The word a step is said in.
 *
 * A step takes four of the run's words and none of
 * its own, and every surface goes through here so
 * that stays true. "gave up" in particular is about
 * a whole run: a step whose retries ran out failed,
 * and a run nothing restarts any more writes no
 * error row for a step to carry.
 */
export function stepWord(step: StepReading): StepWord {
  return step.state;
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
