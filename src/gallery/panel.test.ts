import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import { paletteLabels } from '../canvas/words.js';
import { listPatterns, patternNamed } from '../core/index.js';
import { messages } from '../messages.js';
import { makeProject } from '../test-support/project.js';

import {
  gallery,
  refusalFor,
  type Gallery,
  type GalleryHost,
} from './panel.js';

/**
 * What pressing Use actually does.
 *
 * The gallery itself is a catalog and is drawn in
 * its own Playwright spec. What is here is the one
 * thing choosing a card comes to: a document and
 * its handlers written into somebody's project, or
 * a sentence saying why they were not.
 */

const scratch: string[] = [];

afterAll(() => {
  while (scratch.length > 0) {
    rmSync(scratch.pop() as string, { recursive: true, force: true });
  }
});

/** A real project, thrown away afterwards: what is
 *  asserted here is files on disk. */
async function project(): Promise<string> {
  const dir = await makeProject();
  scratch.push(dir);

  return dir;
}

function workflowFile(dir: string, name: string): string {
  return join(dir, '.mboss', 'workflows', `${name}.workflow.json`);
}

type Driver = {
  /** Everything the editor was told, in order. */
  shown: string[];

  /** Every document it was asked to open. */
  opened: string[];

  /** What the name box said about each name the
   *  spec typed into it. */
  refusals: (string | undefined)[];

  /** How often the gallery was closed. */
  closed: () => number;

  zone: Gallery;
};

/**
 * The flow, driven against an editor that only
 * records what it was asked.
 *
 * `typed` is the names somebody tries in the box
 * before settling; `answer` is what they press
 * Enter on, and `undefined` is the box being
 * dismissed.
 */
function driven(opts: {
  projects?: string[];
  trusted?: boolean;
  typed?: string[];
  answer?: string;
}): Driver {
  const shown: string[] = [];
  const opened: string[] = [];
  const refusals: (string | undefined)[] = [];
  let closed = 0;

  const host: GalleryHost = {
    projects: () => opts.projects ?? [],

    askName: async (prompt) => {
      for (const value of opts.typed ?? []) {
        refusals.push(prompt.validate(value));
      }

      return opts.answer;
    },

    withProgress: async (_title, work) => await work(),

    info: (message) => void shown.push(message),

    openCanvas: async (path) => void opened.push(path),
  };

  return {
    shown,
    opened,
    refusals,
    closed: () => closed,
    zone: gallery({
      host,
      trust: fakeTrust(opts.trusted ?? true),
      done: () => void (closed += 1),
    }),
  };
}

describe('starting a workflow from a pattern', () => {
  it('refuses in a window that is not trusted', async () => {
    const driver = driven({ trusted: false, projects: ['/somewhere'] });

    await driver.zone.usePattern('refund_approval');

    expect(driver.shown).toEqual([messages.newWorkflowNeedsTrust()]);
    expect(driver.opened).toEqual([]);
  });

  it('refuses when there is no project', async () => {
    const driver = driven({ projects: [] });

    await driver.zone.usePattern('refund_approval');

    expect(driver.shown).toEqual([messages.newWorkflowNeedsProject()]);
    expect(driver.opened).toEqual([]);
  });

  it('refuses a name the workspace already has', async () => {
    const dir = await project();
    mkdirSync(join(dir, '.mboss', 'workflows'), { recursive: true });
    writeFileSync(workflowFile(dir, 'taken'), '{}', 'utf8');

    const driver = driven({
      projects: [dir],
      typed: ['taken', 'Not A Name', 'free'],
    });

    await driver.zone.usePattern('refund_approval');

    expect(driver.refusals).toEqual([
      messages.workflowNameTaken('taken'),
      messages.newWorkflowNameRefused(),
      undefined,
    ]);
    expect(driver.opened).toEqual([]);
  });

  /**
   * The handlers are written before the document,
   * so an apply that refuses is the one refusal
   * that leaves a trace. A sentence that did not
   * name the files would leave somebody hunting for
   * them.
   */
  it('says which files were written when applying failed', () => {
    const said = refusalFor({
      at: 'refused',
      detail: 'the rules said no',
      written: ['/p/lib/getPurchase.ts', '/p/lib/refundPolicy.ts'],
    });

    expect(said).toContain('the rules said no');
    expect(said).toContain('/p/lib/getPurchase.ts');
    expect(said).toContain('/p/lib/refundPolicy.ts');
  });

  it('says the pattern is on the canvas with its handlers', async () => {
    const dir = await project();
    const driver = driven({ projects: [dir], answer: 'deliveries' });

    await driver.zone.usePattern('reliable_webhook');

    const handlers = patternNamed('reliable_webhook')?.lib.length ?? 0;

    expect(driver.opened).toEqual([workflowFile(dir, 'deliveries')]);
    expect(driver.closed()).toBe(1);
    expect(driver.shown).toEqual([
      messages.newWorkflowCreated('deliveries', handlers),
    ]);
    expect(existsSync(join(dir, 'lib', 'applyEvent.ts'))).toBe(true);
  });

  /**
   * The blocks that mail somebody are the one part
   * of a pattern that reaches outside the machine
   * it was started on, so the pattern that carries
   * them says so before anybody runs it.
   */
  it('adds the mail sentence for a pattern that sends mail', async () => {
    const dir = await project();
    const driver = driven({ projects: [dir], answer: 'refunds' });

    await driver.zone.usePattern('refund_approval');

    expect(driver.shown[0]).toContain(messages.newWorkflowSendsMail());
  });

  /**
   * Writing a document and its handlers is not
   * generating code: the app still runs whatever
   * the last generation produced until a save sets
   * one going. A sentence promising otherwise
   * points somebody at a file that is not there.
   */
  it('never says generated code exists', async () => {
    const dir = await project();
    const driver = driven({ projects: [dir], answer: 'deliveries' });

    await driver.zone.usePattern('reliable_webhook');

    expect(driver.shown.join(' ')).not.toMatch(/generat|compil/i);
    expect(
      existsSync(join(dir, 'src', 'workflows', 'deliveries.workflow.ts')),
    ).toBe(false);
  });

  it('starts blank from the blank spec', async () => {
    const dir = await project();
    const driver = driven({ projects: [dir], answer: 'greetings' });

    await driver.zone.startBlank();

    const written = JSON.parse(
      readFileSync(workflowFile(dir, 'greetings'), 'utf8'),
    ) as { nodes: { kind: string; config: Record<string, unknown> }[] };

    expect(written.nodes).toHaveLength(1);
    expect(written.nodes[0]?.kind).toBe('trigger');
    expect(written.nodes[0]?.config).toMatchObject({
      mode: 'event',
      topic: 'greetings',
    });
    expect(driver.opened).toEqual([workflowFile(dir, 'greetings')]);
    expect(driver.closed()).toBe(1);
  });
});

/**
 * The cards, which are the whole of what the
 * gallery draws.
 */
describe('the cards the gallery is sent', () => {
  const shelves = driven({}).zone.init().groups;
  const cards = shelves.flatMap((shelf) => shelf.cards);

  /**
   * The glyph run is drawn from the same ten kinds
   * the palette offers. A card naming an eleventh
   * would draw a hole, and would be the gallery
   * promising a block this product does not have.
   */
  it('draws every glyph from the ten kinds the palette has', () => {
    const kinds = new Set(Object.keys(paletteLabels()));

    expect(cards.length).toBeGreaterThan(0);

    for (const card of cards) {
      for (const glyph of card.glyphs) {
        expect({ card: card.name, glyph, known: kinds.has(glyph) }).toEqual({
          card: card.name,
          glyph,
          known: true,
        });
      }
    }
  });

  /** A shelf nobody wrote down is a pattern that
   *  ships and is never offered. */
  it('puts every pattern the library ships on a shelf', () => {
    expect(cards.map((card) => card.name).sort()).toEqual(
      listPatterns()
        .map((pattern) => pattern.name)
        .sort(),
    );
  });

  it('gives the halo to exactly one pattern', () => {
    expect(cards.filter((card) => card.demo).map((card) => card.name)).toEqual([
      'refund_approval',
    ]);
  });
});
