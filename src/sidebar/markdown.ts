/**
 * The little markdown an agent writes, read into
 * blocks the panel draws with elements.
 *
 * Three things change how a sentence reads — a word
 * leaned on, a name out of the code, a list of steps
 * — so those are set apart and nothing else is.
 * Everything comes back as data rather than as
 * markup: the panel builds elements from it and
 * never HTML from a string, so an agent quoting a
 * tag shows a tag.
 *
 * A marker is only a marker once it closes. The
 * agent streams, and a half-written `**` that
 * turned the rest of the paragraph bold would flash
 * and then change back when the pair arrived.
 *
 * One `*` or `_` is not emphasis: the faces this
 * panel ships have no italic, and in an agent's
 * sentence either one is as often a glob or a
 * snake-cased name.
 *
 * Pure and browser-safe, because the panel draws
 * with it and the host reads a heading with it.
 */

/** A stretch of one paragraph or list item. */
export type ProseRun = { at: 'text' | 'strong' | 'code'; text: string };

export type ProseBlock =
  | { at: 'paragraph'; runs: ProseRun[] }
  | { at: 'list'; ordered: false; items: ProseRun[][] }
  | {
      at: 'list';
      ordered: true;

      /** The number the agent gave the first item,
       *  so a list picked up again after a
       *  paragraph goes on counting. */
      start: number;

      items: ProseRun[][];
    };

const BULLET = /^ {0,3}[-*] (.*)$/;
const NUMBERED = /^ {0,3}(\d{1,9})\. (.*)$/;

export function parseInline(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let paragraph: string[] = [];

  const closeParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ at: 'paragraph', runs: runsOf(paragraph.join('\n')) });
    }

    paragraph = [];
  };

  for (const line of text.split('\n')) {
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);

    if (line.trim() === '') {
      closeParagraph();
    } else if (bullet !== null) {
      closeParagraph();
      itemInto(blocks, false, 1, bullet[1] ?? '');
    } else if (numbered !== null) {
      closeParagraph();
      itemInto(blocks, true, Number(numbered[1]), numbered[2] ?? '');
    } else {
      paragraph.push(line);
    }
  }

  closeParagraph();

  return blocks;
}

/**
 * One list line, added to the list just above it
 * when that list is the same kind and no paragraph
 * came between them, and opening a new one
 * otherwise. A blank line between two items keeps
 * them one list: agents space their steps out.
 */
function itemInto(
  blocks: ProseBlock[],
  ordered: boolean,
  start: number,
  item: string,
): void {
  const last = blocks.at(-1);
  const runs = runsOf(item);

  if (last?.at === 'list' && last.ordered === ordered) {
    last.items.push(runs);

    return;
  }

  blocks.push(
    ordered
      ? { at: 'list', ordered, start, items: [runs] }
      : { at: 'list', ordered, items: [runs] },
  );
}

/**
 * The runs of one paragraph or item, read left to
 * right. Code is looked for before bold wherever a
 * backtick comes first, so a `**` inside a name
 * from the code stays part of the name.
 */
function runsOf(text: string): ProseRun[] {
  const runs: ProseRun[] = [];
  let at = 0;

  const push = (run: ProseRun): void => {
    const last = runs.at(-1);

    if (run.at === 'text' && last?.at === 'text') {
      last.text += run.text;
    } else if (run.text !== '') {
      runs.push(run);
    }
  };

  while (at < text.length) {
    const marker = nextMarker(text, at);

    if (marker === undefined) {
      push({ at: 'text', text: text.slice(at) });
      break;
    }

    push({ at: 'text', text: text.slice(at, marker.at) });

    const open = marker.at + marker.mark.length;
    const close = text.indexOf(marker.mark, open);

    // Unclosed, or closed on nothing: the marker is
    // what the agent typed, and reading goes on
    // after it.
    if (close === -1 || close === open) {
      const literal = close === open ? marker.mark.repeat(2) : marker.mark;

      push({ at: 'text', text: literal });
      at = marker.at + literal.length;
    } else {
      push({
        at: marker.mark === '`' ? 'code' : 'strong',
        text: text.slice(open, close),
      });
      at = close + marker.mark.length;
    }
  }

  return runs;
}

/** Where the next backtick or pair of asterisks
 *  starts, whichever comes first. */
function nextMarker(
  text: string,
  from: number,
): { at: number; mark: '`' | '**' } | undefined {
  const code = text.indexOf('`', from);
  const strong = text.indexOf('**', from);

  if (code === -1 && strong === -1) return undefined;
  if (strong === -1 || (code !== -1 && code < strong)) {
    return { at: code, mark: '`' };
  }

  return { at: strong, mark: '**' };
}
