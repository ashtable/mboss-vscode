import { beforeEach, describe, expect, it } from 'vitest';

import {
  createStatusBar,
  type StatusBar,
  type StatusItem,
} from './statusBar.js';

/**
 * What the status bar says, and when it starts
 * saying it.
 *
 * The row that matters here is the one reporting
 * code generation. It is the only feedback a person
 * gets that saving a workflow did anything at all —
 * the code lands in files nobody has open — so a
 * row that stays blank, or that keeps reporting the
 * run before last, is the difference between a loop
 * that works and one that looks broken.
 */

/** A row, as far as the status bar drives one. */
type FakeItem = StatusItem & { shown: boolean; disposed: boolean };

let items: FakeItem[];
let bar: StatusBar;

function fakeItem(): FakeItem {
  return {
    text: '',
    tooltip: '',
    shown: false,
    disposed: false,
    show(): void {
      this.shown = true;
    },
    dispose(): void {
      this.disposed = true;
    },
  };
}

/** The row reporting code generation: the second
 *  one the bar asks for. */
function codegenRow(): FakeItem {
  expect(items.length).toBeGreaterThan(1);

  return items[1]!;
}

beforeEach(() => {
  items = [];
  bar = createStatusBar(() => {
    const item = fakeItem();
    items.push(item);

    return item;
  });
});

describe('before anything has happened', () => {
  it('says the extension is up and local', () => {
    expect(items[0]?.text).toContain('mBoss');
    expect(items[0]?.shown).toBe(true);
  });

  it('says nothing about a generation that has not run', () => {
    expect(codegenRow().shown).toBe(false);
  });
});

describe('after a generation', () => {
  it('carries how long it took', () => {
    bar.codegenFinished(142, true);

    expect(codegenRow().text).toContain('142');
    expect(codegenRow().shown).toBe(true);
  });

  it('reports the newest run rather than the first', () => {
    bar.codegenFinished(142, true);
    bar.codegenFinished(8, true);

    expect(codegenRow().text).toContain('8');
    expect(codegenRow().text).not.toContain('142');
  });

  it('reads differently when nothing was generated', () => {
    bar.codegenFinished(142, true);
    const succeeded = codegenRow().text;

    bar.codegenFinished(142, false);

    expect(codegenRow().text).not.toBe(succeeded);
    expect(codegenRow().text).toContain('142');
  });
});

describe('in a folder nobody has trusted', () => {
  it('says why nothing is being generated', () => {
    bar.codegenNeedsTrust();

    expect(codegenRow().shown).toBe(true);
    expect(codegenRow().text.length).toBeGreaterThan(0);
    expect(codegenRow().tooltip.length).toBeGreaterThan(0);
  });
});

describe('when the extension shuts down', () => {
  it('lets go of every row it created', () => {
    bar.dispose();

    expect(items).not.toHaveLength(0);
    expect(items.every((item) => item.disposed)).toBe(true);
  });
});
