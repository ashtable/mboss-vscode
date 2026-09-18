import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEBVIEW_ENTRIES } from '../build.js';
import { REPO_ROOT, sourceFiles, styleFiles } from '../test-support/repo.js';

/**
 * The rules the stylesheets are held to, read off
 * the stylesheets themselves.
 *
 * Every one of these is a rule about the whole
 * extension rather than about one surface, and a
 * surface that breaks one of them looks right in
 * the theme it was written against and wrong in
 * the other three. A rendered check would catch
 * that only where a spec happens to mount the
 * offending element in the offending theme, so the
 * source is what is read here: a literal cannot
 * hide in a view nobody mounted.
 */

type Rule = { sheet: string; selector: string; body: string };

type Declaration = { name: string; value: string };

/** A hex, `rgb()` or `hsl()` written out by hand. */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

/** A theme the editor picks, named as a class. */
const THEME = /vscode-(?:dark|light|high-contrast)(?!\w)/;

/** A control, as the subject of a rule. */
const CONTROL = /(^|[\s,>+~])(button|\.btn|\.tab)(?![\w-])/;

/** Every custom property one value reads. */
const READS = /var\(\s*(--[\w-]+)/g;

/** A body wearing nothing but theme classes, named
 *  or ruled out. One appearance can only be told
 *  from another it also wears by excluding it. */
const THEMED = /^body(\.vscode-[\w-]+|:not\(\.vscode-[\w-]+\))+$/;

const TOKENS = 'src/webview/tokens.css';

/** Where the components every view draws live. */
const SIGNAL = 'src/webview/signal/';

/** The components every view draws, by the class
 *  their own rules are written against. */
const SHARED_CLASSES = [
  'btn',
  'tab',
  'state-word',
  'lib-fn',
  'section-label',
  'field-hint',
  'callout',
  'empty-state',
];

/** One of them as a whole class, so `.tab` is not
 *  `.tab-pane`. */
const SHARED = new RegExp(`\\.(?:${SHARED_CLASSES.join('|')})(?![\\w-])`);

/** What a view's sheet may say about a shared
 *  component: where it sits, and nothing else. */
const PLACING = [
  /^margin(?:-[\w-]+)?$/,
  /^(?:order|align-self|justify-self)$/,
  /^flex(?:-grow|-shrink|-basis)?$/,
  /^grid-(?:area|column|row)(?:-start|-end)?$/,
];

/** The files a card belongs in: the two things that
 *  float over the canvas, and the gallery's
 *  pattern tiles. */
const CARDS = [
  'src/canvas/Canvas.tsx',
  'src/canvas/connect/QuickAdd.tsx',
  'src/gallery/index.tsx',
];

/** A name written into the markup rather than handed
 *  to it. */
const NAMED_BY_HAND = /\b(?:title|aria-label|placeholder|label|alt)=['"]/;

/**
 * Prose, once the expressions are out of the way.
 *
 * Code runs between a `>` and a `<` all the time — a
 * generic closes, an arrow points — so what is
 * looked for is a run that reads as writing rather
 * than as an expression: at least one letter, and
 * none of the punctuation only code uses.
 */
const PROSE = /^[^<>{}()=;`[\]$]*[A-Za-z][^<>{}()=;`[\]$]*$/;

/** The two tracked labels, and no tracking at all. */
const TRACKING = ['var(--label-tracking)', 'var(--state-tracking)', 'normal'];

const FACES = ['var(--font-body)', 'var(--font-mono)'];

/** The two ways an element asks for the machine
 *  face: a view's class, a component's attribute. */
const MONO_HOOK = /\.mono(?![\w-])|\[data-mono(?![\w-])/;

/** A component's props offering the machine face,
 *  and its markup asking for it because of them. */
const TAKES_MONO = /\bmono\?:/;
const WRITES_MONO = /\bdata-mono=\{[^}]*\bmono\b/;

/** Provenance as a class of its own, so not the
 *  property row's `.property-provenance`. */
const PROVENANCE = /\.provenance(?![\w-])/;

/** The elements that are only boxes and text: none
 *  of them is announced as something to press, and
 *  none of them takes a key. */
const PLAIN = /^<(?:div|span|p|li)\b/;

const CLICKED = /\bonClick=/;

function named(path: string): string {
  return relative(REPO_ROOT, path);
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Where the block opened at `open` closes. */
function closes(text: string, open: number): number {
  let depth = 0;

  for (let at = open; at < text.length; at += 1) {
    if (text[at] === '{') depth += 1;
    if (text[at] === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }

  return text.length;
}

/**
 * Every `selector { … }` in one sheet.
 *
 * An at-rule is descended into rather than kept,
 * so a rule inside `@media` is read as the rule it
 * is — and so `@font-face`, whose block holds
 * declarations and no rules, drops out entirely.
 * That is the one place a family may be a literal.
 */
function rulesOf(sheet: string, css: string): Rule[] {
  const rules: Rule[] = [];
  let head = '';

  for (let at = 0; at < css.length; at += 1) {
    if (css[at] !== '{') {
      head += css[at];
      continue;
    }

    const close = closes(css, at);
    const body = css.slice(at + 1, close);
    const selector = head.replace(/\s+/g, ' ').trim();

    if (selector.startsWith('@')) rules.push(...rulesOf(sheet, body));
    else rules.push({ sheet, selector, body });

    at = close;
    head = '';
  }

  return rules;
}

function declarationsOf(body: string): Declaration[] {
  return body.split(';').flatMap((text) => {
    const [, name, value] = /^\s*([\w-]+)\s*:\s*([\s\S]+)$/.exec(text) ?? [];

    if (name === undefined || value === undefined) return [];
    return [{ name, value: value.replace(/\s+/g, ' ').trim() }];
  });
}

/**
 * The blocks a token is written down in: the one
 * `:root` scale and the theme blocks that re-point
 * it. A colour belongs in one of these and nowhere
 * else, because these are the only rules a theme
 * change is allowed to reach.
 */
function isSource(selector: string): boolean {
  return selector
    .split(',')
    .every((one) => one.trim() === ':root' || THEMED.test(one.trim()));
}

/**
 * A rule the body itself carries: the block a theme
 * is chosen by, its per-theme twins, and a view's
 * own re-points. A rule that only reaches through
 * the body to something inside it is not one.
 */
function isBody(selector: string): boolean {
  return selector.split(',').every((one) => /^body[^\s>+~]*$/.test(one.trim()));
}

function reads(value: string): string[] {
  return [...value.matchAll(READS)].flatMap((found) => found[1] ?? []);
}

/** Each selector in a list, split only where the
 *  comma is the list's own and not an argument's. */
function selectorsOf(list: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let one = '';

  for (const letter of list) {
    if (letter === '(') depth += 1;
    if (letter === ')') depth -= 1;

    if (letter === ',' && depth === 0) {
      selectors.push(one.trim());
      one = '';
    } else {
      one += letter;
    }
  }

  return [...selectors, one.trim()];
}

/**
 * The compound a selector styles: the last one,
 * with what an attribute or a pseudo-class is asked
 * about taken out first — `.row:has(> .btn)` styles
 * the row, not the Button.
 */
function subjectOf(selector: string): string {
  return compoundOf(selector.replace(/\[[^\]]*\]/g, ''));
}

/**
 * The last compound, with what it asks of its own
 * element kept: `.value[data-mono]` is a value that
 * asked for something. What a pseudo-class asks
 * about is still taken out, because it may ask the
 * opposite — `:not([data-mono])`.
 */
function compoundOf(selector: string): string {
  let bare = selector.trim();

  while (/\([^()]*\)/.test(bare)) bare = bare.replace(/\([^()]*\)/g, '');

  // A combinator inside an attribute's brackets is
  // the attribute's own.
  let depth = 0;
  let start = 0;

  for (let at = 0; at < bare.length; at += 1) {
    const letter = bare[at] ?? '';

    if (letter === '[') depth += 1;
    else if (letter === ']') depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(letter)) start = at + 1;
  }

  return bare.slice(start).trim();
}

/** Whether every selector in a list styles only an
 *  element that asked for the machine face. */
function isHooked(list: string): boolean {
  return selectorsOf(list).every((one) => MONO_HOOK.test(compoundOf(one)));
}

/** Every class one file writes into a `className`,
 *  word by word, whether the value is a string or
 *  an expression choosing between strings. */
function classNamesOf(tsx: string): string[] {
  const names: string[] = [];
  const opens = /className=/g;

  for (let found = opens.exec(tsx); found !== null; found = opens.exec(tsx)) {
    const at = found.index + found[0].length;
    const value =
      tsx[at] === '{'
        ? tsx.slice(at, closes(tsx, at) + 1)
        : (/^(['"])[^'"]*\1/.exec(tsx.slice(at))?.[0] ?? '');

    for (const literal of value.matchAll(/(['"`])([^'"`]*)\1/g)) {
      names.push(...(literal[2] ?? '').split(/\s+/).filter(Boolean));
    }
  }

  return names;
}

/** One file with what it says about itself taken
 *  out, so a sentence in a comment is not read as a
 *  sentence in the markup. */
function withoutNotes(tsx: string): string {
  return withoutComments(tsx).replace(/\/\/[^\n]*/g, '');
}

/** Every run of text between a tag that closed and
 *  the next one that opened. */
function childrenOf(tsx: string): string[] {
  const runs: string[] = [];
  const between = /(?<!=)>([^<]*)</g;

  for (
    let found = between.exec(tsx);
    found !== null;
    found = between.exec(tsx)
  ) {
    runs.push(found[1] ?? '');
  }

  return runs;
}

/**
 * One run with its expressions taken out, leaving
 * whatever somebody typed into the markup itself.
 *
 * An expression that runs past the end of the run
 * takes the rest of it: a `{` with no `}` before the
 * next tag means the tag is inside the expression,
 * and nothing between them is markup text.
 */
function withoutExpressions(run: string): string {
  let text = '';

  for (let at = 0; at < run.length; at += 1) {
    if (run[at] === '{') at = closes(run, at);
    else text += run[at];
  }

  return text;
}

/**
 * Every opening tag in one file, as far as its
 * attributes go.
 *
 * A brace is descended past rather than stopped at,
 * because an attribute holding an arrow function
 * carries a `>` of its own and a tag cut there would
 * be read as two.
 */
function tagsOf(tsx: string): string[] {
  const tags: string[] = [];
  const opens = /<[A-Za-z][\w.]*/g;

  for (let found = opens.exec(tsx); found !== null; found = opens.exec(tsx)) {
    let depth = 0;
    let at = found.index + found[0].length;

    for (; at < tsx.length; at += 1) {
      const letter = tsx[at];

      if (letter === '{') depth += 1;
      else if (letter === '}') depth -= 1;
      else if (letter === '>' && depth === 0) break;
    }

    tags.push(tsx.slice(found.index, at));
    opens.lastIndex = at;
  }

  return tags;
}

/** The text of every `style=` prop in one file. */
function styleProps(tsx: string): string[] {
  const props: string[] = [];
  const opens = /style=\{/g;

  for (let found = opens.exec(tsx); found !== null; found = opens.exec(tsx)) {
    const open = found.index + found[0].length - 1;
    const close = closes(tsx, open);

    props.push(tsx.slice(open, close + 1));
    opens.lastIndex = close + 1;
  }

  return props;
}

const sheets = styleFiles().map((path) => ({
  name: named(path),
  text: readFileSync(path, 'utf8'),
}));

const rules = sheets.flatMap((sheet) =>
  rulesOf(sheet.name, withoutComments(sheet.text)),
);

const components = sourceFiles()
  .filter((path) => path.endsWith('.tsx'))
  .map((path) => ({ name: named(path), text: readFileSync(path, 'utf8') }));

/** Every declaration of one property, and where. */
function declaredAs(property: string): (Rule & { value: string })[] {
  return rules.flatMap((rule) =>
    declarationsOf(rule.body)
      .filter((declaration) => declaration.name === property)
      .map((declaration) => ({ ...rule, value: declaration.value })),
  );
}

function where(found: { sheet: string; selector: string }[]): string[] {
  return found.map((rule) => `${rule.sheet} ${rule.selector}`);
}

describe('the stylesheets this extension ships', () => {
  /**
   * The reader, before anything is read with it.
   * Every check below is a filter over these rules,
   * and a filter over nothing passes.
   */
  it('are the token sheet and one for every view', () => {
    expect(sheets.map((sheet) => sheet.name).sort()).toEqual(
      [
        TOKENS,
        ...WEBVIEW_ENTRIES.map((view) => `src/${view}/${view}.css`),
      ].sort(),
    );

    for (const sheet of sheets) {
      expect(rules.filter((rule) => rule.sheet === sheet.name)).not.toEqual([]);
    }
  });

  /**
   * A colour written into a view's own sheet is a
   * colour the theme blocks cannot re-point, so it
   * survives into a ground it was never chosen
   * against.
   */
  it('spend no colour outside the blocks a theme re-points', () => {
    const spent = rules
      .filter((rule) => !(rule.sheet === TOKENS && isSource(rule.selector)))
      .flatMap((rule) =>
        declarationsOf(rule.body)
          .filter((declaration) => COLOUR.test(declaration.value))
          .map(
            (declaration) =>
              `${rule.sheet} ${rule.selector} ` + declaration.name,
          ),
      );

    expect(spent).toEqual([]);
  });

  /**
   * A mix is a colour too. `color-mix()` reads a
   * role and hands back something no theme block
   * ever wrote: the token sheet can re-point what
   * goes in, and not what comes out, so a value
   * mixed in a view's own sheet is a fifth ink the
   * four appearances were never checked against.
   * Where a softer step is wanted, it is a role of
   * its own, mixed once where the themes are
   * answered.
   */
  it('mix colours only where the themes are answered', () => {
    const mixed = rules.flatMap((rule) =>
      declarationsOf(rule.body)
        .filter((declaration) => declaration.value.includes('color-mix('))
        .map((declaration) => ({ ...rule, name: declaration.name })),
    );

    expect(mixed.filter((rule) => rule.sheet === TOKENS)).not.toEqual([]);
    expect(
      mixed
        .filter((rule) => rule.sheet !== TOKENS)
        .map((rule) => `${rule.sheet} ${rule.selector} ${rule.name}`),
    ).toEqual([]);
  });

  /** The same rule, where React writes the style. */
  it('spend no colour in a style prop either', () => {
    const props = components.flatMap((file) =>
      styleProps(file.text).map((text) => ({ name: file.name, text })),
    );

    expect(props.length).toBeGreaterThan(0);
    expect(
      props.filter((prop) => COLOUR.test(prop.text)).map((prop) => prop.name),
    ).toEqual([]);
  });

  /**
   * A view that answers a theme by name answers
   * four of them badly: the token sheet is where
   * the four appearances are told apart, so every
   * other file reads a role and gets the right
   * value for free.
   */
  it('name a theme only where the themes are answered', () => {
    const naming = [...sheets, ...components]
      .filter((file) => file.name !== TOKENS)
      .filter((file) => THEME.test(file.text))
      .map((file) => file.name);

    expect(naming).toEqual([]);
  });

  /**
   * Capitals are how this system says what state
   * something is in, and nothing else. A label,
   * a button or a tab set in capitals spends that
   * signal on furniture, and a person scanning for
   * the one word that is shouting finds a page of
   * them.
   */
  it('shout in exactly one rule', () => {
    const shouting = declaredAs('text-transform').filter(
      (rule) => rule.value === 'uppercase',
    );

    expect(where(shouting)).toEqual([`${TOKENS} .state-word`]);
  });

  /**
   * Tracking opens up a word set in capitals, so
   * the two live together: the state word has its
   * own step, the section label has the other, and
   * a rule that is neither carries none. Hand-set
   * tracking is what makes two labels a person
   * reads as one thing drift apart.
   */
  it('track a label and a state word and nothing else', () => {
    const tracked = declaredAs('letter-spacing');

    expect(tracked.length).toBeGreaterThan(0);
    expect(
      where(tracked.filter((rule) => !TRACKING.includes(rule.value))),
    ).toEqual([]);
    expect(
      where(tracked.filter((rule) => CONTROL.test(rule.selector))),
    ).toEqual([]);
  });

  /**
   * A custom property is worked out where it is
   * written, and the classes a theme is chosen by
   * are on the body — one element below the root.
   * So a value worked out on the root is worked out
   * from the light sources and then inherits down
   * already wrong: white cards on a dark panel.
   * Every derived value belongs on the body, and
   * the root is left holding only what no theme
   * moves.
   */
  it('work out no value on the root that a theme re-points', () => {
    const roots = rules.filter((rule) => rule.selector === ':root');
    const themed = new Set(
      rules
        .filter((rule) => isBody(rule.selector))
        .flatMap((rule) => declarationsOf(rule.body))
        .map((declaration) => declaration.name)
        .filter((name) => name.startsWith('--')),
    );

    expect(roots).not.toEqual([]);
    expect(themed.size).toBeGreaterThan(0);

    const written = roots.flatMap((rule) =>
      declarationsOf(rule.body).map((declaration) => ({ rule, declaration })),
    );

    expect(
      written
        .filter(({ declaration }) => declaration.value.includes('color-mix('))
        .map(({ rule, declaration }) => `${rule.sheet} ${declaration.name}`),
    ).toEqual([]);

    expect(
      written.flatMap(({ rule, declaration }) =>
        reads(declaration.value)
          .filter((name) => themed.has(name))
          .map((name) => `${rule.sheet} ${declaration.name} reads ${name}`),
      ),
    ).toEqual([]);
  });

  /**
   * Two faces, and which one a thing is set in is
   * the difference between something a person wrote
   * and something a machine did. A rule that
   * inherits the family instead of naming one is
   * how a surface ends up saying neither.
   */
  it('set every face through one of the two font tokens', () => {
    const set = declaredAs('font-family');

    expect(set.length).toBeGreaterThan(0);
    expect(where(set.filter((rule) => !FACES.includes(rule.value)))).toEqual(
      [],
    );
  });

  /**
   * The machine face is what an element asks for,
   * never what a rule decides on its behalf. A view
   * marks an id, a signature or a count as machine
   * text, and a rule that sets the face on anything
   * else sets a person's words in it the day that
   * element holds some. The token sheet is the one
   * place the ask is answered, so the face is
   * spelled once. It is defined once as well, on
   * the root: a rule that points the token at
   * another face reads nothing, and still moves
   * every element that asked.
   */
  it('set the machine face only where a hook asks for it', () => {
    // The reader first: an element that asked,
    // however specific the rule answering it.
    expect(isHooked('.mono, [data-mono]')).toBe(true);
    expect(isHooked('.property > .value[data-mono]')).toBe(true);
    expect(isHooked('.value')).toBe(false);
    expect(isHooked('.row:not([data-mono])')).toBe(false);
    expect(isHooked('.monospace')).toBe(false);

    const set = rules.filter((rule) =>
      declarationsOf(rule.body).some((declaration) =>
        reads(declaration.value).includes('--font-mono'),
      ),
    );
    const answered = set.filter(
      (rule) => rule.sheet === TOKENS && isHooked(rule.selector),
    );

    expect(where(answered)).toContain(`${TOKENS} .mono, [data-mono]`);
    expect(where(set.filter((rule) => !answered.includes(rule)))).toEqual([]);
    expect(where(declaredAs('--font-mono'))).toEqual([`${TOKENS} :root`]);

    const code = sourceFiles()
      .filter((path) => !/\.test(?:-d)?\.tsx?$/.test(path))
      .map((path) => ({ name: named(path), text: readFileSync(path, 'utf8') }));

    expect(code.map((file) => file.name)).toEqual(
      expect.arrayContaining([
        `${SIGNAL}Button.tsx`,
        'src/webview/protocol.ts',
      ]),
    );
    expect(
      code
        .filter((file) => withoutNotes(file.text).includes('--font-mono'))
        .map((file) => file.name),
    ).toEqual([]);
  });

  /**
   * The other half of the same ask. A shared
   * component that offers the machine face as a
   * prop turns it into the hook on its own markup,
   * so the one rule above answers it and a view
   * never reaches inside a component to say so.
   */
  it('write the machine face into every shared component that takes it', () => {
    const taking = components
      .filter((file) => file.name.startsWith(SIGNAL))
      .map((file) => ({ ...file, text: withoutNotes(file.text) }))
      .filter((file) => TAKES_MONO.test(file.text));

    expect(taking.map((file) => file.name)).toContain(`${SIGNAL}Button.tsx`);
    expect(
      taking
        .filter((file) => !WRITES_MONO.test(file.text))
        .map((file) => file.name),
    ).toEqual([]);
  });

  /**
   * Where a value came from — derived, configured,
   * recorded — is a lowercase word after the value
   * or a title on it, never a chip of its own: a
   * chip is a second thing to read on a row that
   * says one. The row's own class and the attribute
   * naming the word are how it is found and styled.
   */
  it('call nothing provenance by a class of its own', () => {
    expect(PROVENANCE.test('.row > .provenance')).toBe(true);
    expect(PROVENANCE.test('.property-provenance')).toBe(false);
    expect(classNamesOf('className="chip provenance"')).toContain('provenance');

    const named = components.map((file) => ({
      name: file.name,
      classes: classNamesOf(withoutNotes(file.text)),
    }));

    expect(named.flatMap((file) => file.classes)).toContain(
      'property-provenance',
    );
    expect(
      where(rules.filter((rule) => PROVENANCE.test(rule.selector))),
    ).toEqual([]);
    expect(
      named
        .filter((file) => file.classes.includes('provenance'))
        .map((file) => file.name),
    ).toEqual([]);
  });

  /**
   * A shared component draws the words it is handed
   * and none of its own. A word typed into one of
   * them is a word no bag records and no translator
   * ever sees: it appears in whichever language the
   * person who typed it was thinking in, in every
   * view that draws the component.
   */
  it('write no word of their own into a shared component', () => {
    const shared = components.filter((file) => file.name.startsWith(SIGNAL));

    expect(shared).not.toEqual([]);

    const written = shared.flatMap((file) => {
      const code = withoutNotes(file.text);

      return [
        ...childrenOf(code)
          .map((run) => withoutExpressions(run).replace(/\s+/g, ' ').trim())
          .filter((text) => PROSE.test(text))
          .map((text) => `${file.name}: ${text}`),
        ...(NAMED_BY_HAND.test(code) ? [`${file.name}: a name by hand`] : []),
      ];
    });

    expect(written).toEqual([]);
  });

  /**
   * A shared component looks the same wherever it is
   * drawn. A view's own sheet may say where one sits
   * — a margin, an order, its place in a row or a
   * grid — and nothing about how it looks: a Button
   * that is a different button on one surface is two
   * buttons to learn, and the rule that would make
   * it one is written where every view reads it.
   */
  it('restyle no shared component in a view’s own sheet', () => {
    const placed = rules
      .filter((rule) => rule.sheet !== TOKENS)
      .flatMap((rule) =>
        selectorsOf(rule.selector)
          .filter((one) => SHARED.test(subjectOf(one)))
          .map((selector) => ({ ...rule, selector })),
      );

    expect(placed.length).toBeGreaterThan(0);
    expect(
      placed.flatMap((rule) =>
        declarationsOf(rule.body)
          .filter(({ name }) => !PLACING.some((one) => one.test(name)))
          .map(({ name }) => `${rule.sheet} ${rule.selector} ${name}`),
      ),
    ).toEqual([]);
  });

  /**
   * A card floats. What floats over the canvas — the
   * quick add, a wiring refusal — and the gallery's
   * pattern tiles are cards; a panel and the sections
   * in it are not, because a box drawn inside a panel
   * is chrome between somebody and what they came to
   * read.
   */
  it('draw a card only where a card belongs', () => {
    const carding = components
      .filter((file) => classNamesOf(withoutNotes(file.text)).includes('card'))
      .map((file) => file.name);

    expect(carding.filter((name) => CARDS.includes(name))).not.toEqual([]);
    expect(carding.filter((name) => !CARDS.includes(name))).toEqual([]);
  });

  /**
   * A bordered Button in neutral ink is a fifth look
   * this system does not have. The second choice
   * with an edge is the outline — that same border
   * with the product's own ink in it — so the
   * bordered variant exists only in that pairing,
   * here as well as in its props.
   */
  it('give every bordered Button the product’s own ink', () => {
    const tags = components.flatMap((file) =>
      tagsOf(file.text).map((tag) => ({ name: file.name, tag })),
    );
    const bordered = tags.filter((one) =>
      one.tag.includes('variant="secondary"'),
    );

    expect(bordered).not.toEqual([]);
    expect(
      bordered
        .filter((one) => !one.tag.includes('ink="brand"'))
        .map((one) => one.name),
    ).toEqual([]);
  });
});

describe('the views this extension ships', () => {
  /**
   * What a person clicks is a Button, or a handler
   * the graph library calls for its own nodes, and
   * never a plain element with a click on it. A
   * plain element tells a screen reader nothing about
   * being pressable and takes no key, so a click on
   * one is a way in that a keyboard does not have.
   */
  it('take no click on a plain element', () => {
    // The reader first: a tag written over several
    // lines, with an arrow inside it, is one tag and
    // the whole of it.
    const sample = '<div\n  a={1}\n  onClick={() => x}\n';

    expect(tagsOf(`${sample}>`)).toEqual([sample]);
    expect(PLAIN.test(sample) && CLICKED.test(sample)).toBe(true);
    expect(components).not.toEqual([]);

    const clicked = components.flatMap((file) =>
      tagsOf(withoutNotes(file.text))
        .filter((tag) => PLAIN.test(tag) && CLICKED.test(tag))
        .map(() => file.name),
    );

    expect(clicked).toEqual([]);
  });
});
