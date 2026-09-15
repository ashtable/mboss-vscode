/**
 * What changed between two texts, for a file edit
 * the agent made.
 *
 * The protocol sends the file before and the file
 * after, not a unified diff, so everything here is
 * arithmetic on two strings: how many lines a badge
 * should say, and which lines a card should show.
 * Its own module because it reads two strings and
 * nothing else, and the fold beside it reads a
 * protocol.
 */

/** What happened to one file, in counts. */
export type FileStat = {
  added: number;

  removed: number;

  isNew: boolean;
};

/**
 * One row of a diff.
 *
 * Only lines that are drawn. The stretches nobody
 * touched get no row standing in for them: where
 * two hunks meet, the line numbers jump, and that
 * already says how far.
 */
export type DiffLine = {
  kind: 'add' | 'del' | 'ctx';

  text: string;

  oldNo?: number;

  newNo?: number;
};

/**
 * Counts a change the way a badge says it.
 *
 * The protocol sends the file before and the file
 * after, not a unified diff, so this is arithmetic
 * on two texts. Matching lines at each end are
 * dropped first and the rest is compared properly:
 * two small edits far apart in a long file are two
 * small edits, not one rewrite of everything
 * between them.
 */
export function lineDiffStat(
  oldText: string | null | undefined,
  newText: string,
): FileStat {
  if (oldText === null || oldText === undefined) {
    return { added: linesOf(newText).length, removed: 0, isNew: true };
  }

  const before = linesOf(oldText);
  const after = linesOf(newText);

  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  ) {
    head += 1;
  }

  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  const changedBefore = before.slice(head, before.length - tail);
  const changedAfter = after.slice(head, after.length - tail);
  const shared = commonLength(changedBefore, changedAfter);

  return {
    added: changedAfter.length - shared,
    removed: changedBefore.length - shared,
    isNew: false,
  };
}

/**
 * How many lines two versions still have in
 * common, in order.
 *
 * The table is quadratic, so a pathologically
 * large rewrite falls back to "none of it
 * matches". That over-counts a badge on a file
 * nobody is going to read the badge on, and it
 * keeps a streaming panel from stalling on one
 * enormous generated file.
 */
const CELL_BUDGET = 4_000_000;

function commonLength(before: string[], after: string[]): number {
  if (before.length === 0 || after.length === 0) return 0;
  if (before.length * after.length > CELL_BUDGET) return 0;

  let previous = new Array<number>(after.length + 1).fill(0);

  for (const line of before) {
    const row = new Array<number>(after.length + 1).fill(0);

    for (let index = 1; index <= after.length; index += 1) {
      row[index] =
        line === after[index - 1]
          ? (previous[index - 1] as number) + 1
          : Math.max(previous[index] as number, row[index - 1] as number);
    }

    previous = row;
  }

  return previous[after.length] as number;
}

/**
 * The two versions, line by line, as a diff reads.
 *
 * Counting is not enough once a person is being
 * asked to keep or undo an edit: what they are
 * agreeing to is these lines. Stretches nobody
 * touched are left out, keeping two lines either
 * side of every change — a panel a few hundred
 * pixels wide cannot show a whole file, and the
 * untouched part is not what is being asked about.
 */
export function lineDiff(
  oldText: string | null | undefined,
  newText: string,
): DiffLine[] {
  const before = linesOf(oldText ?? '');
  const after = linesOf(newText);
  const aligned = alignment(before, after);

  return aligned === undefined ? [] : collapsed(aligned);
}

/**
 * The lines, without the indentation all of them
 * share.
 *
 * A hunk from inside a method starts eight or ten
 * columns in, which in a narrow panel is half the
 * card before any code. That shared margin says
 * nothing about the change, so it goes, and the
 * lines keep only how they sit against each other.
 *
 * What is shared is a string, not a width: a tab
 * and four spaces line up in one editor and not in
 * the next, so neither stands for the other. A
 * blank line has no indentation to share and would
 * otherwise take the margin to nothing, so it is
 * left out of the reckoning and drawn empty.
 */
export function stripIndent(lines: readonly DiffLine[]): DiffLine[] {
  const margin = lines
    .filter((line) => line.text.trim() !== '')
    .map((line) =>
      line.text.slice(0, line.text.length - line.text.trimStart().length),
    )
    .reduce<string | undefined>(
      (shared, indent) =>
        shared === undefined ? indent : commonStart(shared, indent),
      undefined,
    );

  return lines.map((line) => ({
    ...line,
    text: line.text.trim() === '' ? '' : line.text.slice(margin?.length ?? 0),
  }));
}

function commonStart(one: string, other: string): string {
  let at = 0;

  while (at < one.length && one[at] === other[at]) at += 1;

  return one.slice(0, at);
}

/** Lines around a change that stay, either side. */
const DIFF_CONTEXT = 2;

/**
 * Which line became which, or nothing.
 *
 * The table is the same quadratic one the counts
 * use, and it gives up at the same budget — a file
 * too large to align is one the entry shows counts
 * for and no lines, which is a better answer than a
 * guess at which thousand lines are the interesting
 * ones.
 */
function alignment(before: string[], after: string[]): DiffLine[] | undefined {
  if (before.length * after.length > CELL_BUDGET) return undefined;

  // How many lines the two still share from here
  // on, for every pair of starting points.
  const width = after.length + 1;
  const table = new Int32Array((before.length + 1) * width);
  const shared = (oldAt: number, newAt: number): number =>
    table[oldAt * width + newAt] as number;

  for (let oldAt = before.length - 1; oldAt >= 0; oldAt -= 1) {
    for (let newAt = after.length - 1; newAt >= 0; newAt -= 1) {
      table[oldAt * width + newAt] =
        before[oldAt] === after[newAt]
          ? shared(oldAt + 1, newAt + 1) + 1
          : Math.max(shared(oldAt + 1, newAt), shared(oldAt, newAt + 1));
    }
  }

  const lines: DiffLine[] = [];
  let oldAt = 0;
  let newAt = 0;

  while (oldAt < before.length && newAt < after.length) {
    const oldLine = before[oldAt] as string;
    const newLine = after[newAt] as string;

    if (oldLine === newLine) {
      lines.push({
        kind: 'ctx',
        text: oldLine,
        oldNo: oldAt + 1,
        newNo: newAt + 1,
      });
      oldAt += 1;
      newAt += 1;

      continue;
    }

    // A tie takes the removal first, so a replaced
    // line reads as the old one struck out and the
    // new one under it.
    if (shared(oldAt + 1, newAt) >= shared(oldAt, newAt + 1)) {
      lines.push({ kind: 'del', text: oldLine, oldNo: oldAt + 1 });
      oldAt += 1;

      continue;
    }

    lines.push({ kind: 'add', text: newLine, newNo: newAt + 1 });
    newAt += 1;
  }

  for (; oldAt < before.length; oldAt += 1) {
    lines.push({
      kind: 'del',
      text: before[oldAt] as string,
      oldNo: oldAt + 1,
    });
  }

  for (; newAt < after.length; newAt += 1) {
    lines.push({ kind: 'add', text: after[newAt] as string, newNo: newAt + 1 });
  }

  return lines;
}

/** The rows near enough to a change to be worth
 *  drawing. */
function collapsed(lines: DiffLine[]): DiffLine[] {
  const near = lines.map(() => false);

  lines.forEach((line, at) => {
    if (line.kind === 'ctx') return;

    const from = Math.max(0, at - DIFF_CONTEXT);
    const to = Math.min(lines.length - 1, at + DIFF_CONTEXT);

    for (let index = from; index <= to; index += 1) near[index] = true;
  });

  return lines.filter((_, at) => near[at]);
}

/** A file's lines, with the trailing newline not
 *  counted as one. */
function linesOf(text: string): string[] {
  if (text === '') return [];

  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
}
