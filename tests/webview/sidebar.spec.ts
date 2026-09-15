import { expect, test, type Locator, type Page } from '@playwright/test';

import type {
  DiagnosticEntry,
  SessionUpdate,
  ToolEntry,
} from '../../src/acp/transcript.js';
import { foldUpdates } from '../../src/acp/transcript.js';
import { filled } from '../../src/webview/fill.js';
import type { SidebarInit } from '../../src/webview/protocol.js';

import { fileEntry, sidebarEntries, sidebarInit } from './fixtures/sidebar.js';
import {
  mount,
  THEMES,
  THEMES_ALL,
  type Harness,
  type ThemeKind,
} from './harness.js';
import { colourOf, sameColour } from './palette.js';
import { sidebarWords as strings } from './words.js';

/**
 * The agent panel, driven.
 *
 * The panel renders a conversation it does not
 * own. The extension holds the session, folds the
 * stream into entries and decides what is pending;
 * the view is handed the result and draws it. So
 * these specs script what an agent said, fold it
 * with the extension's own fold, and check what
 * appears — which is the same path the running
 * extension takes, minus the agent.
 *
 * The words below are the ones sent in, not the
 * ones the extension resolves. That the extension
 * resolves the right ones, and that no English a
 * user reads is written into a browser bundle, is
 * checked where the extension is.
 */

const said = (body: string): SessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text: body },
});

/** The panel, showing what these updates fold
 *  into. */
async function showing(
  harness: Harness,
  updates: SessionUpdate[],
  over: Partial<SidebarInit> = {},
): Promise<void> {
  await harness.show(
    sidebarInit({
      transcript: sidebarEntries(foldUpdates([], updates)),
      ...over,
    }),
  );
}

async function openPanel(
  page: Page,
  theme: ThemeKind = 'light',
): Promise<Harness> {
  const harness = await mount(page, 'sidebar', theme);

  await harness.show(sidebarInit());

  return harness;
}

test.describe('the transcript', () => {
  test('grows a paragraph as the agent keeps talking', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [said('Wiring ')]);
    await expect(page.locator('[data-entry="message-0"]')).toHaveText('Wiring');

    await showing(harness, [said('Wiring '), said('the booking flow.')]);
    await expect(page.locator('[data-entry="message-0"]')).toHaveText(
      'Wiring the booking flow.',
    );
    await expect(page.locator('[data-entry]')).toHaveCount(1);
  });

  test('sets thinking apart from speaking', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [
      {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'The confirm step needs a handler.' },
      },
      said('Adding one.'),
    ]);

    await expect(page.locator('[data-from="thought"]')).toHaveText(
      'The confirm step needs a handler.',
    );
    await expect(page.locator('[data-from="agent"]')).toHaveText('Adding one.');
  });
});

/**
 * The two provenance colours, as the browser
 * resolves them over this harness' light theme.
 *
 * Written out rather than read back off the same
 * custom property the rule uses: a rail that read
 * its colour from the wrong token would agree with
 * itself and still be the wrong colour.
 */
const PERSON = 'rgb(83, 103, 255)';
const AGENT = 'rgb(149, 103, 255)';

test.describe('a tool call', () => {
  const call: SessionUpdate = {
    sessionUpdate: 'tool_call',
    toolCallId: 'call-1',
    title: 'Write lib/twilioChat.ts',
    kind: 'edit',
    status: 'pending',
  };

  test('is one line: a bold verb and a mono target', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [call]);

    const card = page.locator('[data-tool-call="call-1"]');

    await expect(card).toHaveAttribute('data-kind', 'edit');
    await expect(card).toHaveAttribute('data-status', 'pending');
    await expect(card.locator('.tool-verb')).toHaveText('Write');
    await expect(card.locator('.tool-target')).toHaveText('lib/twilioChat.ts');
    await expect(card.locator('.tool-mark')).not.toBeEmpty();
  });

  /**
   * Every entry the fold produces is the agent's;
   * a row the extension notes for itself carries
   * `person` and none of the protocol's four status
   * words, because its rail and verb — an "applied"
   * row's own — already say what happened.
   *
   * The colours are checked as the browser resolves
   * them, not as class names. Two rows in one column
   * are told apart by the edge of the card and
   * nothing else, so a rail that is present but
   * unpainted — a rule renamed, a token dropped —
   * loses the distinction this whole product turns
   * on while every attribute still reads correctly.
   */
  test('rails a row by who did it', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [call]);

    const asked = page.locator('[data-tool-call="call-1"]');

    await expect(asked).toHaveAttribute('data-by', 'agent');
    await expect(asked).toHaveCSS('border-left-width', '3px');
    await expect(asked).toHaveCSS('border-left-color', AGENT);

    await harness.show(
      sidebarInit({
        transcript: [
          {
            at: 'tool',
            id: 'apply-1',
            by: 'person',
            kind: 'edit',
            verb: 'Apply proposal',
            target: 'booking',
            status: 'applied',
            body: [],
            paths: [],
          },
        ],
      }),
    );

    const applied = page.locator('[data-tool-call="apply-1"]');

    await expect(applied).toHaveAttribute('data-by', 'person');
    await expect(applied.locator('.tool-status')).toHaveCount(0);
    await expect(applied).toHaveCSS('border-left-width', '3px');
    await expect(applied).toHaveCSS('border-left-color', PERSON);
  });

  /**
   * How a call went is a word in the row. Colouring
   * the edge with it too would leave the column with
   * two things to mean, and a person scanning it for
   * who did what would be reading the wrong signal
   * on the rows that went wrong.
   */
  test('keeps the rail about who, not about how it went', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [
      call,
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'failed',
      },
    ]);

    const card = page.locator('[data-tool-call="call-1"]');

    await expect(card).toHaveAttribute('data-status', 'failed');
    await expect(card).toHaveCSS('border-left-color', AGENT);
  });

  /**
   * The card is keyed by the id the agent gave it,
   * so an update moves the card it belongs to
   * instead of stacking a second one under it.
   */
  test('moves through its statuses without duplicating', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [call]);

    for (const status of ['in_progress', 'completed'] as const) {
      await showing(harness, [
        call,
        { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status },
      ]);

      await expect(page.locator('[data-tool-call]')).toHaveCount(1);
      await expect(page.locator('[data-tool-call="call-1"]')).toHaveAttribute(
        'data-status',
        status,
      );
    }

    await expect(page.locator('[data-tool-call="call-1"]')).toContainText(
      strings.toolStatus.completed,
    );
  });

  /**
   * The interesting part of a finished call is
   * usually whatever it printed, but not on
   * screen by default — a person asks for it.
   */
  test('folds what it printed until asked to show it', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [
      {
        ...call,
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: 'line one' } },
          { type: 'content', content: { type: 'text', text: 'line two' } },
        ],
      },
    ]);

    const card = page.locator('[data-tool-call="call-1"]');

    await expect(card.locator('.tool-body')).toHaveCount(0);
    await expect(card.locator('.tool-body-toggle')).toHaveText(
      '2 lines · show',
    );

    await card.locator('.tool-body-toggle').click();

    await expect(card.locator('.tool-body')).toHaveCount(2);
    await expect(card.locator('.tool-body').first()).toHaveText('line one');
  });

  /**
   * What mBoss read out of a run, in the column
   * beside what the agent did.
   *
   * The same row as any other read: folded, because
   * a summary of a run is a page of lines and the
   * agent has the whole of it attached to the turn
   * anyway.
   */
  const evidence: ToolEntry = {
    at: 'tool',
    id: 'evidence:wf_c9d2f3',
    by: 'person',
    kind: 'read',
    verb: 'Read',
    target: 'run wf_c9d2f3 · mBoss run evidence',
    status: 'applied',
    body: ['ERROR · recovered ×1 · v0.4.1', '3 of 3 operations carried'],
    paths: [],
    action: { label: 'Open run', posts: 'openRun', workflowId: 'wf_c9d2f3' },
  };

  test('folds a person-authored read row and expands it', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ transcript: [evidence] }));

    const card = page.locator('[data-tool-call="evidence:wf_c9d2f3"]');

    await expect(card).toHaveAttribute('data-by', 'person');
    await expect(card.locator('.tool-verb')).toHaveText('Read');
    await expect(card.locator('.tool-body')).toHaveCount(0);

    await card.locator('.tool-body-toggle').click();

    await expect(card.locator('.tool-body')).toHaveCount(2);
  });

  /**
   * The way out of the transcript. A row about a run
   * is the one place in this column that names
   * something with a page of its own, and the id it
   * posts is the row's rather than anything the view
   * worked out.
   */
  test("posts openRun from the row's action", async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ transcript: [evidence] }));

    const card = page.locator('[data-tool-call="evidence:wf_c9d2f3"]');

    await expect(card.locator('[data-tool-action]')).toHaveText('Open run');

    await card.locator('[data-tool-action]').click();

    expect(await harness.postedOfType('openRun')).toEqual([
      { type: 'openRun', workflowId: 'wf_c9d2f3' },
    ]);
  });

  /**
   * One row per file, path on the left and what
   * happened to it on the right — beside the call
   * rather than inside it, because a file is the
   * thing a person keeps or undoes. The counts are
   * arithmetic on the two texts the protocol
   * sends, so a file that did not exist reads as
   * new rather than as an enormous edit.
   */
  test('puts a row beside it for each file it touched', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [
      {
        ...call,
        content: [
          {
            type: 'diff',
            path: '/project/lib/twilioChat.ts',
            newText: 'a\nb\nc\n',
          },
          {
            type: 'diff',
            path: '/project/.mboss/workflows/groom.workflow.json',
            oldText: 'one\ntwo\n',
            newText: 'one\nthree\nfour\n',
          },
        ],
      },
    ]);

    const rows = page.locator('.file');

    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute(
      'data-file',
      '/project/lib/twilioChat.ts',
    );

    // A file that did not exist says so and counts
    // every line as added; one that did counts both
    // ways, and says nothing about removals when
    // there were none.
    await expect(rows.nth(0).locator('.new')).toHaveText(strings.newFile);
    await expect(rows.nth(0).locator('.added')).toHaveText('+3');
    await expect(rows.nth(0).locator('.removed')).toHaveCount(0);

    await expect(rows.nth(1).locator('.new')).toHaveCount(0);
    await expect(rows.nth(1).locator('.added')).toHaveText('+2');
    await expect(rows.nth(1).locator('.removed')).toHaveText('−1');
  });

  /**
   * A long path loses its head rather than its
   * filename, which the stylesheet does by laying
   * the line out right to left. That puts the
   * leading slash — a character with no direction of
   * its own, at the edge of the run — on the wrong
   * end, and the file reads as a directory.
   *
   * The words in the element are right either way,
   * so this is asked of where the glyphs are drawn
   * and not of what the text says.
   */
  test('draws a path from its root, not with the root at the end', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await showing(harness, [
      {
        ...call,
        content: [
          { type: 'diff', path: '/project/lib/twilioChat.ts', newText: 'a\n' },
        ],
      },
    ]);

    const drawn = await page
      .locator('.file-head > .path')
      .evaluate((element) => {
        const text = element.firstChild as Text;

        const leftOf = (index: number): number => {
          const range = document.createRange();

          range.setStart(text, index);
          range.setEnd(text, index + 1);

          return range.getBoundingClientRect().left;
        };

        return {
          root: leftOf(text.data.indexOf('/')),
          end: leftOf(text.data.lastIndexOf('s')),
        };
      });

    expect(drawn.root).toBeLessThan(drawn.end);
  });
});

test.describe('the plan', () => {
  test('collapses behind its own progress, expanding on click', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await showing(harness, [
      {
        sessionUpdate: 'plan',
        entries: [
          {
            content: 'Read the workflow',
            priority: 'high',
            status: 'completed',
          },
          {
            content: 'Scaffold handlers',
            priority: 'medium',
            status: 'in_progress',
          },
          { content: 'Regenerate', priority: 'low', status: 'pending' },
        ],
      },
    ]);

    const toggle = page.locator('.plan-toggle');

    await expect(toggle).toHaveText('Plan · 1/3');
    await expect(page.locator('.step')).toHaveCount(0);

    await toggle.click();

    const steps = page.locator('.step');

    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toHaveAttribute('data-status', 'completed');
    await expect(steps.nth(1)).toContainText('Scaffold handlers');
  });
});

/**
 * The step after a turn that answered a question
 * about one block of a run and left an edit
 * standing.
 *
 * The sentence is the host's, composed where the
 * run's short id and the block's title are in
 * reach, and the panel draws it as it arrives.
 */
test.describe('after a turn asked about a block', () => {
  test('says what to do next, in a sentence of its own', async ({ page }) => {
    const harness = await openPanel(page);
    const sentence =
      'Applied. Replay #7089 from Refund payment to verify — earlier ' +
      'durable results are reused.';

    await harness.show(
      sidebarInit({
        transcript: sidebarEntries([
          {
            at: 'next',
            id: 'next-0',
            about: {
              workflowId: '7089cd29-5b5e-4a4c-9c3e-6c8d1b2f4a10',
              nodeId: 'refund_payment',
            },
            block: 'Refund payment',
            edits: ['call-1:/project/lib/refund.ts'],
            sentence,
          },
        ]),
      }),
    );

    const next = page.locator('[data-next]');

    await expect(next).toHaveCount(1);
    await expect(next).toHaveText(sentence);
    await expect(page.locator('.plan')).toHaveCount(0);
  });
});

/**
 * Something the extension found, and the one thing
 * to do about it.
 *
 * The sentence the Fix button sends was written
 * beside the rows by whoever noted them, so the
 * panel sends it back untouched: it has no idea
 * what regenerating or a run found, and composing
 * a request of its own would be a second wording
 * to keep true.
 */
test.describe('a diagnostic', () => {
  const entry: DiagnosticEntry = {
    at: 'diagnostic',
    id: 'codegen:groom_booking:8',
    source: 'codegen',
    rows: [
      { code: 'V07', message: 'Open at requested time? names no handler.' },
    ],
    fix: { label: 'Fix', prompt: 'Fix the blocks this names.' },
  };

  test('draws what was found under where it came from', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ transcript: [entry] }));

    const found = page.locator('.diagnostic');

    await expect(found).toHaveAttribute('data-source', 'codegen');
    await expect(found.locator('.diagnostic-row')).toContainText(
      'Open at requested time? names no handler.',
    );
  });

  /** A regeneration reports everything it found at
   *  once, and each finding is about a different
   *  block. Folded into one line, the second one is
   *  the one nobody reads. */
  test('draws a line for each thing it found', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          {
            ...entry,
            rows: [
              ...entry.rows,
              { code: 'V08', message: 'Confirm by email names no handler.' },
            ],
          },
        ],
      }),
    );

    await expect(page.locator('.diagnostic-row')).toHaveText([
      /Open at requested time\? names no handler\./,
      /Confirm by email names no handler\./,
    ]);
  });

  test('hands the whole thing back on one press', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ transcript: [entry] }));
    await page.locator('[data-fix]').click();

    expect(await harness.postedOfType('prompt')).toEqual([
      { type: 'prompt', text: 'Fix the blocks this names.' },
    ]);
  });

  test('offers nothing on one nothing can be asked about', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({ transcript: [{ ...entry, fix: undefined }] }),
    );

    await expect(page.locator('[data-fix]')).toHaveCount(0);
  });
});

test.describe('a file edit, decided or not', () => {
  test('draws each line with a sign and gutter numbers', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          fileEntry({
            lines: [
              { kind: 'ctx', text: 'unchanged', oldNo: 1, newNo: 1 },
              { kind: 'del', text: 'old line', oldNo: 2 },
              { kind: 'add', text: 'new line', newNo: 2 },
            ],
          }),
        ],
      }),
    );

    const lines = page.locator('.diff-line');

    await expect(lines).toHaveCount(3);

    await expect(lines.nth(1)).toHaveAttribute('data-kind', 'del');
    await expect(lines.nth(1).locator('.sign')).toHaveText('−');
    await expect(lines.nth(1).locator('.gutter').first()).toHaveText('2');

    await expect(lines.nth(2)).toHaveAttribute('data-kind', 'add');
    await expect(lines.nth(2).locator('.sign')).toHaveText('+');
    await expect(lines.nth(2).locator('.gutter').nth(1)).toHaveText('2');
  });

  test('offers Keep and Undo while nothing is decided', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ transcript: [fileEntry()] }));

    await page.locator('[data-keep]').click();
    await page.locator('[data-undo-file]').click();

    expect(await harness.postedOfType('keepFile')).toEqual([
      { type: 'keepFile', id: 'call-1:/project/lib/twilioChat.ts' },
    ]);
    expect(await harness.postedOfType('undoFile')).toEqual([
      { type: 'undoFile', id: 'call-1:/project/lib/twilioChat.ts' },
    ]);
  });

  /** Nothing was kept past the byte cap, so there
   *  is nothing left to compare or write back. */
  test('offers no Undo for a file kept only as counts', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [fileEntry({ oldText: undefined, newText: undefined })],
      }),
    );

    await expect(page.locator('[data-keep]')).toBeVisible();
    await expect(page.locator('[data-undo-file]')).toHaveCount(0);
  });

  /** Something else wrote the file since: nothing
   *  is offered, because writing the snapshot back
   *  would be a second, silent edit. */
  test('offers nothing once a file changed since', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({ transcript: [fileEntry({ decision: 'changed-since' })] }),
    );

    await expect(page.locator('[data-keep]')).toHaveCount(0);
    await expect(page.locator('[data-undo-file]')).toHaveCount(0);
    await expect(page.locator('.file-note')).toHaveText(strings.changedSince);
  });

  test('rails a file by who touched it', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({ transcript: [fileEntry({ by: 'person' })] }),
    );

    await expect(page.locator('.file')).toHaveAttribute('data-by', 'person');
  });
});

test.describe("a turn's edits, closed out at once", () => {
  test('shows one row to keep or undo every pending file', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          fileEntry({ id: 'a', path: '/project/lib/a.ts' }),
          fileEntry({ id: 'b', path: '/project/lib/b.ts' }),
        ],
      }),
    );

    await expect(page.locator('.files-batch-count')).toHaveText(
      '2 files changed',
    );

    await page.locator('[data-keep-all]').click();

    expect(await harness.postedOfType('keepFile')).toEqual([
      { type: 'keepFile', id: 'a' },
      { type: 'keepFile', id: 'b' },
    ]);
  });

  /** One file's own Keep and Undo already say
   *  everything this row would. */
  test('says nothing over a single pending file', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ transcript: [fileEntry()] }));

    await expect(page.locator('.files-batch')).toHaveCount(0);
  });

  /** A file already decided drops out of the count
   *  a fresh click would act on. */
  test('leaves a decided file out of Undo all', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          fileEntry({ id: 'a', path: '/project/lib/a.ts', decision: 'kept' }),
          fileEntry({ id: 'b', path: '/project/lib/b.ts' }),
          fileEntry({ id: 'c', path: '/project/lib/c.ts' }),
        ],
      }),
    );

    await expect(page.locator('.files-batch-count')).toHaveText(
      '2 files changed',
    );

    await page.locator('[data-undo-all]').click();

    expect(await harness.postedOfType('undoFile')).toEqual([
      { type: 'undoFile', id: 'b' },
      { type: 'undoFile', id: 'c' },
    ]);
  });
});

test.describe('a permission request', () => {
  const prompt: SidebarInit['prompt'] = {
    toolCallId: 'call-1',
    title: 'Write lib/twilioChat.ts',
    toolKey: 'write_file',
    options: [
      { optionId: 'yes', label: 'Allow once', kind: 'allow_once' },
      { optionId: 'yes-always', label: 'Always allow', kind: 'allow_always' },
      { optionId: 'no', label: 'Reject', kind: 'reject_once' },
    ],
  };

  test('offers one button per option', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ status: 'awaiting-permission', prompt }));

    const buttons = page.locator('[data-option]');

    await expect(buttons).toHaveCount(3);

    // The agent's own wording for each option,
    // kept: it wrote the label from what it is
    // about to do, and a rewrite here would
    // describe something else.
    await expect(buttons.locator('span').first()).toHaveText('Allow once');
    await expect(page.locator('[data-option="no"]')).toHaveText('Reject');
    await expect(
      page.locator('[data-option="yes-always"] span').first(),
    ).toHaveText('Always allow');
  });

  /**
   * A promise that outlives this turn has to look
   * different from one that does not. The grouping
   * is read off the protocol's `kind`, never off
   * the option id, which is a string the agent
   * invented.
   */
  test('marks the options that outlive this turn', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ status: 'awaiting-permission', prompt }));

    await expect(page.locator('[data-option="yes-always"]')).toHaveAttribute(
      'data-always',
      'true',
    );
    await expect(page.locator('[data-option="yes"]')).toHaveAttribute(
      'data-always',
      'false',
    );
  });

  test('tells the extension which one was chosen', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ status: 'awaiting-permission', prompt }));

    await page.locator('[data-option="yes-always"]').click();

    expect(await harness.postedOfType('permission')).toEqual([
      { type: 'permission', optionId: 'yes-always', kind: 'allow_always' },
    ]);
  });
});

/** A draft far longer than the field may grow. */
const LONG_DRAFT = Array.from(
  { length: 30 },
  (_, index) => `step ${index + 1}`,
).join('\n');

/** One frame, so a scroll or a resize the page
 *  queued has been delivered. */
async function aFrame(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve(0))),
  );
}

/** How far the log is from showing its end. */
function gapBelow(log: Locator): Promise<number> {
  return log.evaluate(
    (element) =>
      element.scrollHeight - element.scrollTop - element.clientHeight,
  );
}

/**
 * The panel is a column the height of the view,
 * with the log scrolling inside it.
 *
 * A work log grows without limit and the box a
 * person types into is the one thing that must not
 * move. A panel that grew with its log would put
 * the composer further below the fold with every
 * chunk that arrived, so saying the next thing
 * would start with scrolling to the bottom of
 * everything already said.
 */
test.describe('the shape of the panel', () => {
  /** A log far longer than the view is tall. */
  const long = 'Wiring the booking flow.\n'.repeat(120);

  test('keeps the composer in view however long the log gets', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 700 });

    const harness = await openPanel(page);
    await showing(harness, [said(long)]);

    const composer = (await page.locator('.composer').boundingBox())!;

    expect(composer.y + composer.height).toBeLessThanOrEqual(700);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(700);
  });

  test('follows the log to whatever the agent said last', async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 700 });

    const harness = await openPanel(page);
    await showing(harness, [said(long)]);

    const log = page.locator('.transcript');

    // The last rendered line is visible. Chromium
    // rounds the scroll range and the fractional
    // line box at different stages, so compare the
    // overhang with that line instead of demanding a
    // particular number of CSS pixels.
    await expect
      .poll(() =>
        log.evaluate((element) => {
          const last = element.lastElementChild;
          if (last === null) return Number.POSITIVE_INFINITY;

          const overhang =
            last.getBoundingClientRect().bottom -
            element.getBoundingClientRect().bottom;
          const lineHeight = Number.parseFloat(
            getComputedStyle(last).lineHeight,
          );

          return overhang / lineHeight;
        }),
      )
      .toBeLessThanOrEqual(0.25);
    expect(await log.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      0,
    );
  });

  /**
   * Everything under the log shares one region that
   * scrolls on its own once it would take more than
   * its share, so a view too short for the header
   * and a long draft still never scrolls as a whole
   * page — which would carry the header away.
   */
  for (const height of [600, 200]) {
    test(`never scrolls the page itself, ${height}px tall`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 420, height });

      const harness = await openPanel(page);
      await showing(harness, [said('Wiring the booking flow.\n'.repeat(60))]);
      await page.locator('.composer textarea').fill(LONG_DRAFT);
      await aFrame(page);

      const view = await page.evaluate(() => ({
        scrolls: document.documentElement.scrollHeight,
        tall: window.innerHeight,
      }));

      expect(view.scrolls).toBe(view.tall);

      // Bounded by its own share of the view, edge
      // to edge, not merely cut off by the panel's.
      const foot = page.locator('.agent-foot');

      await expect(foot).toHaveCount(1);

      const box = (await foot.boundingBox())!;

      expect(box.height).toBeLessThanOrEqual(0.6 * view.tall + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(view.tall + 1);
    });
  }

  test('leaves a reader where they were when something arrives', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 700 });

    const harness = await openPanel(page);
    await showing(harness, [said(long)]);

    const log = page.locator('.transcript');

    expect(
      await log.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);

    await log.evaluate((element) => {
      element.scrollTop = 0;
    });
    await aFrame(page);

    await showing(harness, [
      said(long),
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-9',
        title: 'Read lib/booking.ts',
        kind: 'read',
        status: 'pending',
      },
    ]);

    await expect(page.locator('[data-tool-call="call-9"]')).toHaveCount(1);
    expect(await log.evaluate((element) => element.scrollTop)).toBe(0);
  });

  /**
   * A draft that grows takes its height from the
   * log. Someone reading the newest line keeps
   * reading it; someone scrolled back to something
   * earlier keeps that instead.
   */
  test('follows as the composer grows for a reader at the bottom', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 700 });

    const harness = await openPanel(page);
    await showing(harness, [said(long)]);

    const log = page.locator('.transcript');
    const field = page.locator('.composer textarea');

    await expect.poll(() => gapBelow(log)).toBeLessThanOrEqual(1);

    const before = (await field.boundingBox())!.height;
    await field.fill('and then\n'.repeat(6));

    await expect
      .poll(async () => (await field.boundingBox())!.height)
      .toBeGreaterThan(before);
    await expect.poll(() => gapBelow(log)).toBeLessThanOrEqual(1);
  });

  test('holds still as the composer grows for a reader scrolled up', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 700 });

    const harness = await openPanel(page);
    await showing(harness, [said(long)]);

    const log = page.locator('.transcript');
    const field = page.locator('.composer textarea');

    await log.evaluate((element) => {
      element.scrollTop = 0;
    });
    await aFrame(page);

    const before = (await field.boundingBox())!.height;
    await field.fill('and then\n'.repeat(6));

    await expect
      .poll(async () => (await field.boundingBox())!.height)
      .toBeGreaterThan(before);
    await aFrame(page);

    expect(await log.evaluate((element) => element.scrollTop)).toBe(0);
  });

  /** An overlay scrollbar sits over the log's own
   *  edge, so the text has to stop short of it. */
  test('keeps the scrollbar clear of the text', async ({ page }) => {
    await openPanel(page);

    const padding = await page
      .locator('.transcript')
      .evaluate((element) => getComputedStyle(element).paddingRight);

    expect(Number.parseFloat(padding)).toBeGreaterThanOrEqual(12);
  });
});

test.describe('the composer', () => {
  test('sends what was typed', async ({ page }) => {
    const harness = await openPanel(page);

    await page.locator('.composer textarea').fill('wire the booking flow');
    await page.locator('.composer button[type="submit"]').click();

    expect(await harness.postedOfType('prompt')).toEqual([
      { type: 'prompt', text: 'wire the booking flow' },
    ]);
    await expect(page.locator('.composer textarea')).toBeEmpty();
  });

  test('sends nothing when nothing was typed', async ({ page }) => {
    const harness = await openPanel(page);

    await page.locator('.composer textarea').fill('   ');
    await page.locator('.composer button[type="submit"]').click();

    expect(await harness.postedOfType('prompt')).toEqual([]);
  });

  /**
   * Mid-turn the one thing worth offering is a way
   * out of it, so the send control becomes the
   * stop control rather than sitting beside a
   * second button nobody can use.
   */
  test('becomes a way to stop while the agent is working', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ status: 'streaming' }));

    await expect(page.locator('.composer button[type="submit"]')).toHaveCount(
      0,
    );

    await page.locator('.composer button[data-stop]').click();

    expect(await harness.postedOfType('cancel')).toEqual([{ type: 'cancel' }]);
  });

  /** A turn stalled on a question is still a turn,
   *  and it is the one most worth a way out of. */
  test('offers Stop while the agent waits on a permission', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        status: 'awaiting-permission',
        prompt: {
          toolCallId: 'call-1',
          title: 'Write lib/twilioChat.ts',
          toolKey: 'write_file',
          options: [
            { optionId: 'yes', label: 'Allow once', kind: 'allow_once' },
          ],
        },
      }),
    );

    await expect(page.locator('.permission')).toBeVisible();
    await expect(page.locator('.composer [data-stop]')).toBeVisible();
    await expect(page.locator('.composer button[type="submit"]')).toHaveCount(
      0,
    );
  });

  /**
   * Somebody on a keyboard who pressed Send is on
   * the control that stops what they started. Were
   * Stop a new element, the press would drop them
   * at the top of the page, a whole log away.
   */
  test('keeps focus on the one button when Send becomes Stop', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await page.locator('.composer textarea').fill('wire the booking flow');
    await page.locator('.composer button[type="submit"]').focus();
    await page.keyboard.press('Space');

    expect(await harness.postedOfType('prompt')).toHaveLength(1);

    await harness.show(sidebarInit({ status: 'streaming' }));

    await expect(page.locator('.composer [data-stop]')).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.activeElement?.matches('[data-stop]') ?? false,
      ),
    ).toBe(true);
  });

  test('puts the agent before Send in one row', async ({ page }) => {
    const harness = await openPanel(page);

    const field = page.locator('.composer textarea');
    const agent = page.locator('.composer [data-composer-agent]');
    const send = page.locator('.composer button[type="submit"]');

    await expect(agent).toHaveCount(1);
    await expect(send).toHaveCount(1);

    expect(
      await page
        .locator('.composer')
        .evaluate((form) =>
          [...form.querySelectorAll('button')].map((button) =>
            button.matches('[data-composer-agent]') ? 'agent' : button.type,
          ),
        ),
    ).toEqual(['agent', 'submit']);

    const under = (await field.boundingBox())!;
    const left = (await agent.boundingBox())!;
    const right = (await send.boundingBox())!;

    expect(left.y).toBeGreaterThanOrEqual(under.y + under.height);
    expect(
      Math.abs(left.y + left.height / 2 - (right.y + right.height / 2)),
    ).toBeLessThanOrEqual(1);
    expect(left.x + left.width).toBeLessThan(right.x);

    await expect(agent).toHaveText(
      `${filled(strings.composerAgent, 'claude code')} ▾`,
    );
    await expect(agent).toHaveAccessibleName(
      filled(strings.composerAgent, 'claude code'),
    );

    await agent.click();

    expect(await harness.postedOfType('chooseAgent')).toEqual([
      { type: 'chooseAgent' },
    ]);
  });

  test('names the field and the send', async ({ page }) => {
    await openPanel(page);

    const send = page.locator('.composer button[type="submit"]');

    await expect(send).toHaveCount(1);
    await expect(page.locator('.composer textarea')).toHaveAccessibleName(
      strings.composerLabel,
    );
    await expect(send).toHaveAccessibleName(strings.send);
  });

  test('sends on Enter', async ({ page }) => {
    const harness = await openPanel(page);
    const field = page.locator('.composer textarea');

    await field.fill('wire the booking flow');
    await field.press('Enter');

    expect(await harness.postedOfType('prompt')).toEqual([
      { type: 'prompt', text: 'wire the booking flow' },
    ]);
    await expect(field).toHaveValue('');
  });

  /**
   * An input method uses Enter to settle the
   * character being built. Sending then would send
   * half a word and throw the rest away.
   */
  test('sends nothing while a character is still being composed', async ({
    page,
  }) => {
    const harness = await openPanel(page);
    const field = page.locator('.composer textarea');

    await field.fill('予約');
    await field.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await aFrame(page);

    expect(await harness.postedOfType('prompt')).toEqual([]);
    await expect(field).toHaveValue('予約');
  });

  test('breaks the line on Shift+Enter', async ({ page }) => {
    const harness = await openPanel(page);
    const field = page.locator('.composer textarea');

    await field.fill('wire the booking flow');
    await field.press('Shift+Enter');

    await expect(field).toHaveValue('wire the booking flow\n');
    expect(await harness.postedOfType('prompt')).toEqual([]);
  });

  /**
   * The field's height is what was typed, never a
   * handle somebody dragged: at least three lines,
   * so an empty field reads as a place to write, and
   * at most a share of the panel, so a long draft
   * scrolls inside itself and leaves the log room.
   */
  for (const height of [600, 300, 1000]) {
    test(`grows with its text, to a share of a ${height}px panel`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 420, height });
      await openPanel(page);

      const field = page.locator('.composer textarea');

      await expect(field).toHaveCount(1);

      const empty = await field.evaluate((element) => ({
        tall: element.clientHeight,
        line: Number.parseFloat(getComputedStyle(element).lineHeight),
      }));

      expect(empty.line).toBeGreaterThan(0);
      expect(empty.tall).toBeGreaterThanOrEqual(3 * empty.line);

      await field.fill(LONG_DRAFT);
      await aFrame(page);

      const grown = await field.evaluate((element) => ({
        tall: element.clientHeight,
        scrolls: element.scrollHeight,
      }));
      const ceiling = Math.min(320, Math.max(160, 0.4 * height));

      expect(Math.abs(grown.tall - ceiling)).toBeLessThanOrEqual(1);
      expect(grown.scrolls).toBeGreaterThan(grown.tall);
    });
  }

  for (const theme of THEMES_ALL) {
    test(`draws the composer in ${theme}`, async ({ page }) => {
      const harness = await mount(page, 'sidebar', theme);
      await harness.show(sidebarInit());

      const field = page.locator('.composer textarea');
      const send = page.locator('.composer button[type="submit"]');

      await expect(send).toHaveCount(1);

      expect(
        await field.evaluate((element) => {
          const style = getComputedStyle(element);

          return { resize: style.resize, padding: style.padding };
        }),
      ).toEqual({ resize: 'none', padding: '9px 12px 2px' });

      const button = (await send.boundingBox())!;

      expect(button.width).toBeCloseTo(26, 1);
      expect(button.height).toBeCloseTo(26, 1);

      // Nothing typed yet: a hole where the send
      // will be, not a button asking to be pressed.
      const ground = await send.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      const hole = colourOf(theme, 'surface-2');

      expect(sameColour(ground, hole), `${ground} ≠ ${hole}`).toBe(true);

      // And not the primary's edge, which round a
      // hole reads as a control that has focus. An
      // edge only where a theme draws every
      // control's.
      const edge = await send.evaluate(
        (element) => getComputedStyle(element).borderTopColor,
      );
      const drawnEdge = theme.startsWith('high-contrast')
        ? THEMES[theme]['--vscode-contrastBorder']!
        : 'rgba(0, 0, 0, 0)';

      expect(sameColour(edge, drawnEdge), `${edge} ≠ ${drawnEdge}`).toBe(true);

      // Pointing at it offers nothing to press.
      await send.hover();

      const hovered = await send.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );

      expect(sameColour(hovered, hole), `${hovered} ≠ ${hole}`).toBe(true);

      // One ring, on the card: the field is the card,
      // and a second ring inside the first would say
      // there were two things to type into.
      await field.focus();

      const ring = await page.locator('.composer').evaluate((element) => {
        const style = getComputedStyle(element);

        return {
          colour: style.outlineColor,
          style: style.outlineStyle,
          width: style.outlineWidth,
          offset: style.outlineOffset,
        };
      });
      const focus = colourOf(theme, 'focus-ring');

      expect(sameColour(ring.colour, focus), `${ring.colour} ≠ ${focus}`).toBe(
        true,
      );
      expect(ring).toMatchObject({
        style: 'solid',
        width: '1px',
        offset: '-1px',
      });
      expect(
        await field.evaluate(
          (element) => getComputedStyle(element).outlineStyle,
        ),
      ).toBe('none');
    });

    test(`draws Stop in the failure voice in ${theme}`, async ({ page }) => {
      const harness = await mount(page, 'sidebar', theme);
      await harness.show(sidebarInit({ status: 'streaming' }));

      const stop = page.locator('.composer [data-stop]');

      await expect(stop).toHaveCount(1);

      const drawn = await stop.evaluate((element) => {
        const style = getComputedStyle(element);

        return {
          padding: style.padding,
          ground: style.backgroundColor,
          ink: style.color,
        };
      });

      // Stopping throws work away, so it is drawn in
      // the failure tone. Where that tone is too
      // light to read as text, the ink says it.
      const tint = colourOf(theme, 'fail-tint');
      const ink =
        theme === 'high-contrast-light'
          ? colourOf(theme, 'ink')
          : colourOf(theme, 'fail');

      expect(drawn.padding).toBe('4px 12px');
      expect(sameColour(drawn.ground, tint), `${drawn.ground} ≠ ${tint}`).toBe(
        true,
      );
      expect(sameColour(drawn.ink, ink), `${drawn.ink} ≠ ${ink}`).toBe(true);
    });
  }
});

test.describe('before there is an agent', () => {
  test('says a folder has to be trusted first', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ status: 'untrusted', agent: undefined }));

    await expect(page.locator('.state')).toHaveText(strings.notTrusted);
    await expect(page.locator('.composer')).toHaveCount(0);
  });

  test('says a folder has to be open first', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ status: 'no-project', agent: undefined }));

    await expect(page.locator('.state')).toHaveText(strings.noProject);
    await expect(page.locator('.composer')).toHaveCount(0);
  });

  test('offers to pick one when none is chosen', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ status: 'no-agent', agent: undefined }));

    await expect(page.locator('.state')).toHaveText(strings.noAgent);

    await page.locator('[data-choose-agent]').click();

    expect(await harness.postedOfType('chooseAgent')).toEqual([
      { type: 'chooseAgent' },
    ]);
  });

  /**
   * Four independently released binaries and one
   * protocol number between them, so an agent
   * answering with a version nobody asked for is
   * routine rather than exotic. The panel says
   * which two numbers disagreed and leaves the
   * picker within reach.
   */
  test('shows what went wrong, with a way out', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        status: 'failed',
        failure: {
          headline: 'claude code speaks a different version of the protocol.',
          detail: 'It answered 2; this extension speaks 1.',
        },
      }),
    );

    await expect(page.locator('.failure')).toContainText('It answered 2');
    await expect(page.locator('[data-choose-agent]')).toBeVisible();
  });
});

test.describe('every theme the editor publishes', () => {
  for (const theme of THEMES_ALL) {
    test(`draws the panel in ${theme}`, async ({ page }) => {
      const harness = await mount(page, 'sidebar', theme);

      await showing(harness, [
        said('Wiring the booking flow.'),
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          title: 'Write lib/twilioChat.ts',
          kind: 'edit',
          status: 'completed',
          content: [
            {
              type: 'diff',
              path: '/project/lib/twilioChat.ts',
              newText: 'a\nb\n',
            },
          ],
        },
      ]);

      // Text that disappears into the ground is the
      // one failure a screenshot-free spec can
      // still catch.
      const ink = await page
        .locator('[data-entry="message-0"]')
        .evaluate((element) => getComputedStyle(element).color);
      const ground = await page
        .locator('body')
        .evaluate((element) => getComputedStyle(element).backgroundColor);

      expect(ink).not.toBe(ground);
      await expect(page.locator('[data-tool-call="call-1"]')).toBeVisible();
    });
  }
});
