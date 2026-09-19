import { expect, test, type Locator, type Page } from '@playwright/test';

import { evidenceRowId } from '../../src/acp/evidenceRow.js';
import type {
  DiagnosticEntry,
  FileEditEntry,
  SessionUpdate,
  ToolEntry,
} from '../../src/acp/transcript.js';
import { foldUpdates } from '../../src/acp/transcript.js';
import { filled } from '../../src/webview/fill.js';
import { shortRunId } from '../../src/webview/ids.js';
import type { SidebarInit } from '../../src/webview/protocol.js';

import {
  evidenceOf,
  fileEntry,
  sidebarEntries,
  sidebarInit,
} from './fixtures/sidebar.js';
import { mount, THEMES_ALL, type Harness, type ThemeKind } from './harness.js';
import { colourOf, contrast, sameColour, type Role } from './palette.js';
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

/**
 * One row naming the product and the panel, and the
 * agent a prompt goes to.
 *
 * The product's name is spelled one way, and the
 * agent's is the lowercase machine name it goes by.
 * Neither is a label to shout, and the picker is a
 * quiet control rather than a bordered pill: it is
 * there to be found, not read first.
 */
test.describe('the head of the panel', () => {
  for (const theme of THEMES_ALL) {
    test(`says whose panel this is in one row, in ${theme}`, async ({
      page,
    }) => {
      const harness = await mount(page, 'sidebar', theme);
      await harness.show(sidebarInit());

      const head = page.locator('[data-agent-head]');

      await expect(head).toHaveCount(1);
      await expect(head).toContainText(strings.heading);

      const title = head.getByText(strings.heading, { exact: true });

      await expect(title).toHaveCSS('text-transform', 'none');
      await expect(title).toHaveCSS('font-weight', '600');
      await expect(title).toHaveCSS('font-size', '13px');

      const picker = head.locator('[data-choose-agent]');

      await expect(picker).toHaveAttribute('data-mono', '');
      await expect(picker).toHaveText('claude code ▾');
      await expect(picker).toHaveAccessibleName('claude code');

      // An edge only where a theme draws every
      // control's.
      const edge = await picker.evaluate(
        (element) => getComputedStyle(element).borderTopColor,
      );
      const drawn = theme.startsWith('high-contrast')
        ? colourOf(theme, 'control-edge')
        : 'rgba(0, 0, 0, 0)';

      expect(sameColour(edge, drawn), `${edge} ≠ ${drawn}`).toBe(true);

      // One row: the title and the picker share a
      // line.
      const titleBox = (await title.boundingBox())!;
      const pickerBox = (await picker.boundingBox())!;
      const middle = (box: { y: number; height: number }): number =>
        box.y + box.height / 2;

      expect(Math.abs(middle(titleBox) - middle(pickerBox))).toBeLessThan(2);

      const shouted = await page.evaluate(
        () =>
          [...document.querySelectorAll('body *')].filter(
            (one) =>
              one instanceof HTMLElement &&
              ['AGENT', 'MBoss'].includes(one.innerText.trim()),
          ).length,
      );

      expect(shouted).toBe(0);

      await harness.show(sidebarInit({ agent: undefined }));

      await expect(picker).toHaveText(`${strings.chooseAgent} ▾`);
    });
  }
});

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

  /**
   * An agent writes a little markdown whether asked
   * to or not. A word it leaned on is bold and a
   * name from the code is set in the machine face,
   * rather than either arriving with its asterisks
   * and backticks still round it.
   */
  test('renders what the agent wrote as prose', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [
      said('Fixing **customer-ID** first in `lib/airtableEtl.ts`:\n'),
      said('- trim it\n- compare it'),
    ]);

    const prose = page.locator('[data-block="prose"]');

    await expect(prose).toHaveCount(1);
    await expect(prose.locator('[data-verbatim] strong')).toHaveText(
      'customer-ID',
    );
    await expect(prose.locator('[data-verbatim] code')).toHaveText(
      'lib/airtableEtl.ts',
    );
    await expect(prose.locator('[data-verbatim] li')).toHaveText([
      'trim it',
      'compare it',
    ]);
    expect(await prose.textContent()).not.toMatch(/[*`]/);

    const face = await prose
      .locator('code')
      .evaluate((element) => getComputedStyle(element).fontFamily);

    expect(face).toContain('Spline Sans Mono');
  });

  /**
   * A name out of the code is machine text, and asks
   * for its face by the hook every other piece of
   * machine text uses rather than by a rule of its
   * own.
   */
  test('sets code the agent quotes in the machine face by a hook', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await showing(harness, [said('Run `npm install` first.')]);

    const code = page.locator('[data-block="prose"] code');

    await expect(code).toHaveCount(1);

    const read = await code.evaluate((element) => ({
      hooked: element.closest('[data-mono], .mono') !== null,
      face: getComputedStyle(element).fontFamily,
    }));

    expect(read.hooked).toBe(true);
    expect(read.face).toMatch(/^"?Spline Sans Mono/);
  });

  /**
   * A coding agent fences the code it is talking
   * about. What is inside the fence is characters
   * it is showing, so nothing in it is read: the
   * exponents and the dash stay, and the span after
   * the block is still the only code on the row.
   */
  test('shows code the agent fenced as it wrote it', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [
      said('Change it like this:\n```ts\nconst total = base ** 2;\n'),
      said('- items.push(x)\n```\nThen run `npm test`.'),
    ]);

    const prose = page.locator('[data-block="prose"]');
    const written = await prose.textContent();

    await expect(prose).toHaveCount(1);
    expect(written).toContain('const total = base ** 2;');
    expect(written).toContain('- items.push(x)');
    await expect(prose.locator('strong')).toHaveCount(0);
    await expect(prose.locator('li')).toHaveCount(0);
    await expect(prose.locator('code')).toHaveText(['npm test']);
  });

  /**
   * What somebody typed is theirs, asterisks and
   * all: the panel shows what was sent, not a
   * reading of it.
   */
  test('shows a typed prompt exactly as it was sent', async ({ page }) => {
    const harness = await openPanel(page);
    const typed = 'make **every** `refund` idempotent';

    await harness.show(
      sidebarInit({
        transcript: [
          { at: 'message', id: 'user-0', from: 'user', text: typed },
        ],
      }),
    );

    const asked = page.locator('[data-block="user"]');

    await expect(asked).toHaveCount(1);
    await expect(asked.locator('[data-verbatim]')).toHaveText(typed);
    await expect(asked.locator('strong, code')).toHaveCount(0);
  });

  /**
   * The six kinds of thing a column holds are told
   * apart by one attribute each, whatever else a
   * block's markup says about it.
   */
  test('marks each block with what kind it is', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        status: 'awaiting-permission',
        transcript: sidebarEntries([
          { at: 'message', id: 'user-0', from: 'user', text: 'Fix it.' },
          { at: 'message', id: 'message-0', from: 'agent', text: 'On it.' },
          {
            at: 'tool',
            id: 'call-1',
            by: 'agent',
            kind: 'read',
            verb: 'Read',
            target: 'lib/a.ts',
            status: 'completed',
            body: [],
            paths: ['/project/lib/a.ts'],
          },
          fileEntry({ id: 'a', path: '/project/lib/a.ts' }),
          fileEntry({ id: 'b', path: '/project/lib/b.ts' }),
          {
            at: 'diagnostic',
            id: 'codegen:x',
            source: 'codegen',
            rows: [{ message: 'Nothing handles it.' }],
          },
          {
            at: 'next',
            id: 'next-0',
            about: { workflowId: 'wf_1', nodeId: 'refund' },
            block: 'Refund',
            edits: ['a'],
          },
        ]),
        prompt: {
          toolCallId: 'call-2',
          title: 'Write lib/a.ts',
          toolKey: 'write_file',
          options: [
            { optionId: 'yes', label: 'Allow once', kind: 'allow_once' },
          ],
        },
      }),
    );

    const blocks = page.locator('.transcript [data-block]');

    await expect(page.locator('.transcript > li')).toHaveCount(8);
    await expect(blocks).toHaveCount(8);
    expect(
      await blocks.evaluateAll((all) =>
        all.map((one) => one.getAttribute('data-block')),
      ),
    ).toEqual([
      'user',
      'prose',
      'tool',
      'diff',
      'diff',
      'diff',
      'diagnostic',
      'prose',
    ]);

    // The two kinds of message keep the root the
    // journeys read what was said off.
    await expect(
      page.locator('.transcript .said[data-block="user"][data-from="user"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('.transcript .said[data-from="agent"]:not([data-next])'),
    ).toHaveAttribute('data-block', 'prose');

    await expect(
      page.locator('.agent-foot [data-block="permission"]'),
    ).toHaveCount(1);
  });

  /**
   * Six kinds of block and no seventh. The shapes an
   * agent sends that are not one of them — a plan, a
   * heading it is thinking under, the row closing
   * out a turn's files, the step after a turn — are
   * each drawn as the block they read as, so a
   * column of them is still read by six rules.
   *
   * The row closing out the files cannot be drawn
   * without the files it counts, and each of those
   * is a block of the same kind, so the kinds are
   * read both whole and as they change down the
   * column.
   */
  test('draws only the six kinds of block', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        status: 'streaming',
        transcript: sidebarEntries([
          {
            at: 'plan',
            id: 'plan',
            steps: [{ text: 'Trim the id', status: 'in_progress' }],
          },
          fileEntry({ id: 'a', path: '/project/lib/a.ts' }),
          fileEntry({ id: 'b', path: '/project/lib/b.ts' }),
          {
            at: 'message',
            id: 'thought-0',
            from: 'thought',
            text: '**Validating uniqueness**',
            reasoning: { verb: 'Validating', target: 'uniqueness' },
          },
          {
            at: 'next',
            id: 'next-0',
            about: { workflowId: 'wf_1', nodeId: 'refund' },
            block: 'Refund',
            edits: ['a', 'b'],
          },
        ]),
        prompt: {
          toolCallId: 'call-2',
          title: 'Write lib/a.ts',
          toolKey: 'write_file',
          options: [
            { optionId: 'yes', label: 'Allow once', kind: 'allow_once' },
          ],
        },
      }),
    );

    const six = ['user', 'prose', 'tool', 'diff', 'permission', 'diagnostic'];
    const inLog = page.locator('.transcript [data-block]');
    const pinned = page.locator('.agent-foot [data-block]');

    await expect(inLog).toHaveCount(6);
    await expect(pinned).toHaveCount(1);
    await expect(page.locator('.files-batch')).toHaveCount(1);

    const kinds = await inLog.evaluateAll((all) =>
      all.map((one) => one.getAttribute('data-block') ?? ''),
    );

    expect(kinds).toEqual(['tool', 'diff', 'diff', 'diff', 'tool', 'prose']);
    expect(kinds.filter((kind, index) => kind !== kinds[index - 1])).toEqual([
      'tool',
      'diff',
      'tool',
      'prose',
    ]);
    await expect(pinned).toHaveAttribute('data-block', 'permission');

    const every = await page
      .locator('[data-block]')
      .evaluateAll((all) => all.map((one) => one.getAttribute('data-block')));

    expect(every.filter((kind) => !six.includes(kind ?? ''))).toEqual([]);
  });

  /**
   * While the agent streams, a thought that is only a
   * bold title is the work it names, drawn as a row
   * of work under way rather than as a line of prose
   * saying the same thing.
   */
  test('draws a heading the agent is working under as a running row', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        status: 'streaming',
        transcript: [
          {
            at: 'message',
            id: 'message-0',
            from: 'thought',
            text: '**Validating source and destination uniqueness**',
            reasoning: {
              verb: 'Validating',
              target: 'source and destination uniqueness',
            },
          },
        ],
      }),
    );

    const row = page.locator('[data-block="tool"]');

    await expect(row).toHaveCount(1);
    await expect(row.locator('.tool-verb')).toHaveText('Validating');
    await expect(row.locator('.tool-target')).toHaveText(
      'source and destination uniqueness',
    );
    await expect(row.locator('.state-word')).toHaveText(
      strings.toolStatus.in_progress,
    );
    await expect(row.locator('.state-word')).toHaveAttribute('data-pulse', '');
    await expect(page.locator('.said[data-from="thought"]')).toHaveCount(0);
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

/** A row mBoss wrote when it applied a proposal. */
const applyRow: ToolEntry = {
  at: 'tool',
  id: 'apply-1',
  by: 'person',
  kind: 'edit',
  verb: 'Apply proposal',
  target: 'booking',
  status: 'applied',
  body: [],
  paths: [],
};

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
    await expect(card.locator('.tool-verb')).toHaveCSS('font-weight', '600');
    await expect(card.locator('.tool-target')).toHaveText('lib/twilioChat.ts');

    const face = await card
      .locator('.tool-target')
      .evaluate((element) => getComputedStyle(element).fontFamily);

    expect(face).toContain('Spline Sans Mono');
  });

  /** What was done is a word; a glyph beside it
   *  would be a second, vaguer way of saying it. */
  test('draws no glyph beside the verb', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [call]);

    const line = page.locator('[data-tool-call="call-1"] .tool-line');

    await expect(line).toHaveCount(1);
    await expect(page.locator('.tool-mark')).toHaveCount(0);
    expect(
      await line.evaluate((element) =>
        element.firstElementChild?.matches('.tool-verb'),
      ),
    ).toBe(true);
  });

  /**
   * A column of calls is scanned down its left
   * edge, so each stays one line: a long target
   * gives up its end rather than pushing the state
   * word onto a line of its own, and so does a
   * title that is a whole sentence, which is all
   * verb and no target.
   */
  test('keeps a call to one line however long its name', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 });

    const harness = await openPanel(page);
    const card = page.locator('[data-tool-call="call-1"]');

    const oneLine = async (clipped: string): Promise<void> => {
      const line = card.locator('.tool-line');
      const cut = card.locator(clipped);

      await expect(line).toHaveCount(1);
      await expect(cut).toHaveCount(1);
      await expect(cut).toHaveCSS('text-overflow', 'ellipsis');
      expect(
        await cut.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(true);

      const row = (await line.boundingBox())!;
      const edge = (await card.boundingBox())!;
      const word = (await card.locator('.state-word').boundingBox())!;

      expect(row.height).toBeLessThanOrEqual(31);
      expect(word.y).toBeGreaterThanOrEqual(row.y);
      expect(word.y + word.height).toBeLessThanOrEqual(row.y + row.height);
      expect(word.x + word.width).toBeLessThanOrEqual(edge.x + edge.width);
    };

    await showing(harness, [
      { ...call, title: `Write lib/${'deeply-nested-'.repeat(16)}file.ts` },
    ]);
    await oneLine('.tool-target');

    // A verb as short as a verb keeps all of itself.
    expect(
      await card
        .locator('.tool-verb')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);

    await showing(harness, [
      { ...call, title: `Check ${'every booking in the flow '.repeat(8)}` },
    ]);
    await oneLine('.tool-verb');
  });

  /**
   * Every entry the fold produces is the agent's;
   * a row the extension notes for itself carries
   * `person`.
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

    await harness.show(sidebarInit({ transcript: [applyRow] }));

    const applied = page.locator('[data-tool-call="apply-1"]');

    await expect(applied).toHaveAttribute('data-by', 'person');
    await expect(applied).toHaveCSS('border-left-width', '3px');
    await expect(applied).toHaveCSS('border-left-color', PERSON);
  });

  /**
   * A row mBoss wrote did the thing rather than ask
   * for it, which to a reader is simply done — said
   * in the same quiet word a finished call gets.
   * One that went wrong still says so.
   */
  test("says a person's row is done, in the quiet word", async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          applyRow,
          { ...applyRow, id: 'apply-2', status: 'failed' },
        ],
      }),
    );

    const done = page.locator('[data-tool-call="apply-1"] .state-word');
    const failed = page.locator('[data-tool-call="apply-2"] .state-word');

    await expect(done).toHaveText(strings.toolStatus.applied);
    await expect(failed).toHaveText(strings.toolStatus.failed);
    await expect(done).not.toHaveAttribute('data-pulse');

    for (const [word, role] of [
      [done, 'ink-muted'],
      [failed, 'fail'],
    ] as const) {
      const ink = await word.evaluate(
        (element) => getComputedStyle(element).color,
      );
      const expected = colourOf('light', role);

      expect(sameColour(ink, expected), `${ink} ≠ ${expected}`).toBe(true);
    }
  });

  /**
   * How a call is going, in one word and one tone
   * each: still moving is the one that pulses, and
   * waiting its turn is the quietest.
   */
  test('says how a call went in one word, in its own tone', async ({
    page,
  }) => {
    const harness = await openPanel(page);
    const statuses = [
      ['pending', 'ink-faint'],
      ['in_progress', 'ok'],
      ['completed', 'ink-muted'],
      ['failed', 'fail'],
    ] as const;

    await harness.show(
      sidebarInit({
        transcript: statuses.map(([status]) => ({
          at: 'tool',
          id: status,
          by: 'agent',
          kind: 'other',
          verb: 'Call',
          target: status,
          status,
          body: [],
          paths: [],
        })),
      }),
    );

    await expect(page.locator('.tool .state-word')).toHaveCount(4);

    for (const [status, role] of statuses) {
      const word = page.locator(`[data-tool-call="${status}"] .state-word`);

      await expect(word).toHaveText(strings.toolStatus[status]);
      if (status === 'in_progress') {
        await expect(word).toHaveAttribute('data-pulse', '');
      } else {
        await expect(word).not.toHaveAttribute('data-pulse');
      }

      const ink = await word.evaluate(
        (element) => getComputedStyle(element).color,
      );
      const expected = colourOf('light', role);

      const why = `${status}: ${ink} ≠ ${expected}`;

      expect(sameColour(ink, expected), why).toBe(true);
    }
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
   * codex titles every write "Editing files". The
   * host names such a call by what it did and the
   * file it did it to, and the panel draws that name
   * as mBoss's words; a title an agent wrote for a
   * call that names no file stays the agent's own.
   */
  test('never names a row by the word files', async ({ page }) => {
    const harness = await openPanel(page);
    const folded = foldUpdates(
      [],
      [
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          title: 'Editing files',
          kind: 'edit',
          status: 'completed',
          content: [
            {
              type: 'diff',
              path: '/project/lib/airtableEtl.test.ts',
              oldText: 'a\n',
              newText: 'b\n',
            },
          ],
        },
      ],
    );

    await harness.show(
      sidebarInit({
        transcript: sidebarEntries(folded).map((entry) =>
          entry.at === 'tool'
            ? {
                ...entry,
                verb: strings.toolVerbs.edit,
                target: 'lib/airtableEtl.test.ts',
              }
            : entry,
        ),
      }),
    );

    const targets = page.locator('.tool-target');

    await expect(targets).toHaveCount(1);
    expect(await targets.allTextContents()).not.toContain('files');
    await expect(targets).toHaveText('lib/airtableEtl.test.ts');
    await expect(targets).not.toHaveAttribute('data-verbatim');

    await showing(harness, [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-2',
        title: 'workflow.apply_spec dryRun',
        kind: 'other',
        status: 'completed',
      },
    ]);

    await expect(targets).toHaveText('dryRun');
    await expect(targets).toHaveAttribute('data-verbatim', '');
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
    const toggle = card.locator('[data-tool-body-toggle]');

    await expect(card.locator('.tool-body')).toHaveCount(0);
    await expect(toggle).toHaveText(filled(strings.showLines, '2'));
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(card.locator('.tool-body')).toHaveCount(2);
    await expect(card.locator('.tool-body').first()).toHaveText('line one');

    // What the call printed is the agent's own.
    await expect(card.locator('.tool-body > [data-verbatim]')).toHaveCount(2);
  });

  /** The fold is a control a keyboard works, and it
   *  says which way it is folded. */
  test('folds and unfolds from the keyboard', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [
      {
        ...call,
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: 'line one' } },
        ],
      },
    ]);

    const card = page.locator('[data-tool-call="call-1"]');
    const toggle = card.locator('[data-tool-body-toggle]');

    await expect(toggle).toHaveCount(1);

    await toggle.press('Enter');

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(card.locator('.tool-body')).toHaveCount(1);

    await toggle.press('Space');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(card.locator('.tool-body')).toHaveCount(0);
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

    await card.locator('[data-tool-body-toggle]').click();

    await expect(card.locator('.tool-body')).toHaveCount(2);
  });

  /**
   * mBoss's words around a value a run recorded are
   * mBoss's; the value is the run's, and can quote
   * anything — a whole run id included. So the value
   * is set apart from the words in front of it, and
   * only the value.
   */
  test("keeps a recorded value apart inside an evidence row's body", async ({
    page,
  }) => {
    const harness = await openPanel(page);
    const run = '0190c8f2-5b5e-7a4c-9c3e-6c8d1b2f4a10';
    const recorded =
      'Awaited 7089cd29-5b5e-4a4c-9c3e-6c8d1b2f4a10 was cancelled';

    await harness.show(
      sidebarInit({
        transcript: [
          evidenceOf(run, [
            { text: 'error · ', recorded },
            { text: 'status · done' },
          ]),
        ],
      }),
    );

    const card = page.locator(`[data-tool-call="${evidenceRowId(run)}"]`);
    const toggle = card.locator('[data-tool-body-toggle]');

    await expect(toggle).toHaveText(filled(strings.showLines, '2'));

    await toggle.click();

    const lines = card.locator('.tool-body');
    const values = card.locator('.tool-body [data-verbatim]');

    await expect(lines).toHaveCount(2);
    await expect(values).toHaveCount(1);
    await expect(values).toHaveText(recorded);
    expect(
      await lines.first().evaluate((line) => {
        const words = line.cloneNode(true) as HTMLElement;

        words
          .querySelectorAll('[data-verbatim]')
          .forEach((one) => one.remove());

        return words.textContent;
      }),
    ).toBe('error · ');
    await expect(card.locator('[data-verbatim]')).toHaveCount(1);
  });

  /**
   * The column names a run the way every other panel
   * does, by the few characters of it a person can
   * scan, and keeps the whole id on the name for
   * whoever needs it. The words mBoss sends the agent
   * still carry the whole id; this is only the
   * column's copy.
   */
  test('names an Ask-agent run by its short id', async ({ page }) => {
    const harness = await openPanel(page);
    const run = '7089cd29-5b5e-4a4c-9c3e-6c8d1b2f4a10';
    const refused = '5d1e2f3a-9c3e-4a4c-8b5e-6c8d1b2f4a10';
    const short = shortRunId(run);
    const echo =
      `Run \`${short}\` of \`refund_order\` recorded no failure; DBOS ` +
      'has it as done.';
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;

    await harness.show(
      sidebarInit({
        transcript: [
          evidenceOf(run, [{ text: 'status · done' }]),
          {
            at: 'message',
            id: 'user-0',
            from: 'user',
            text: echo,
            about: {
              workflowId: run,
              nodeId: 'refund_payment',
              block: 'Refund payment',
              shown: echo,
            },
          },
          {
            ...evidenceOf(refused, [
              { text: 'refused · refund_order at 14:03:07.412' },
            ]),
            action: undefined,
          },
        ],
      }),
    );

    const row = page.locator(`[data-tool-call="${evidenceRowId(run)}"]`);
    const named = row.locator('.tool-target [data-short-run]');

    await expect(named).toHaveCount(1);
    await expect(named).toHaveText(short);
    await expect(named).toHaveAttribute('data-short-run', run);
    await expect(named).toHaveAttribute('title', run);
    await expect(row.locator('.tool-target')).toHaveText(
      filled(strings.evidenceTarget, short),
    );
    expect(await row.locator('.tool-target').textContent()).not.toMatch(uuid);

    // The question, in the column's copy: the run by
    // its short id and in the word every panel says,
    // with the names from the code set as code.
    const asked = page.locator('[data-block="user"]');

    await expect(asked).toContainText(short);
    await expect(asked.locator('code').first()).toHaveText(short);
    expect(await asked.textContent()).not.toMatch(uuid);
    expect(await asked.textContent()).not.toContain('SUCCESS');

    await row.locator('[data-tool-body-toggle]').click();
    await expect(row.locator('.tool-body')).toHaveText(['status · done']);

    const refusal = page.locator(
      `[data-tool-call="${evidenceRowId(refused)}"]`,
    );

    await refusal.locator('[data-tool-body-toggle]').click();

    const when = refusal.locator('.tool-body');

    await expect(when).toHaveCount(1);
    await expect(when).toHaveText(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    await expect(when).not.toHaveText(/AM|PM/);
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
   * One card per file, beside the call that wrote
   * it rather than inside it, because a file is the
   * thing a person keeps or undoes. Its header names
   * what was done the way the call's row does, and
   * counts both ways: arithmetic on the two texts
   * the protocol sends. A file that did not exist
   * says so in a word as well, since three lines
   * added reads the same as three lines appended.
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

    // The call's own row comes first, and each file
    // after it.
    expect(
      await page
        .locator('[data-tool-call="call-1"]')
        .evaluate(
          (row, file) =>
            (row.compareDocumentPosition(file) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
          await rows.nth(0).elementHandle(),
        ),
    ).toBe(true);

    for (const row of [rows.nth(0), rows.nth(1)]) {
      await expect(row.locator('.file-head .file-verb')).toHaveText(
        strings.toolVerbs.edit,
      );
    }

    const created = rows.nth(0);
    const fresh = created.locator('.file-head [data-new-file]');

    await expect(fresh).toHaveCount(1);
    await expect(fresh).toHaveText(strings.newFile);
    await expect(created.locator('.added')).toHaveText('+3');
    await expect(created.locator('.removed')).toHaveText('−0');

    // The word comes before the counts it explains.
    expect(
      await fresh.evaluate(
        (word, added) =>
          (word.compareDocumentPosition(added) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
        await created.locator('.added').elementHandle(),
      ),
    ).toBe(true);

    await expect(rows.nth(1).locator('[data-new-file]')).toHaveCount(0);
    await expect(rows.nth(1).locator('.added')).toHaveText('+2');
    await expect(rows.nth(1).locator('.removed')).toHaveText('−1');
  });

  /**
   * In a narrow panel a long path gives up part of
   * its directory, never part of the filename: the
   * file is what somebody is looking for, and where
   * it sits is context. The whole path stays on the
   * card for whoever needs it.
   */
  test('keeps the filename whole and shortens the directory', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 600 });

    const harness = await openPanel(page);
    const directory = `lib/${'deeply/nested/'.repeat(8)}`;

    await harness.show(
      sidebarInit({
        transcript: [
          fileEntry({
            path: `/project/${directory}twilioChat.ts`,
            shownPath: `${directory}twilioChat.ts`,
          }),
        ],
      }),
    );

    const card = page.locator('.file');
    const dir = card.locator('.file-head .file-dir');
    const name = card.locator('.file-head .file-name');

    await expect(dir).toHaveCount(1);
    await expect(name).toHaveCount(1);
    await expect(dir).toHaveText(directory);
    await expect(name).toHaveText('twilioChat.ts');

    await expect(dir).toHaveCSS('text-overflow', 'ellipsis');
    expect(
      await dir.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await name.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);

    const absolute = `/project/${directory}twilioChat.ts`;

    await expect(card).toHaveAttribute('data-file', absolute);
    await expect(card.locator('.file-head .file-path')).toHaveAttribute(
      'title',
      absolute,
    );

    // Still one line, with the state word inside the
    // card.
    const head = (await card.locator('.file-head').boundingBox())!;
    const edge = (await card.boundingBox())!;
    const word = (await card
      .locator('.file-head [data-file-state]')
      .boundingBox())!;

    expect(head.height).toBeLessThanOrEqual(31);
    expect(word.x + word.width).toBeLessThanOrEqual(edge.x + edge.width);
  });
});

/**
 * The plan is a row of work like any other: what
 * the agent is on now, and whether it is still
 * going. The steps are there for whoever asks.
 */
test.describe('the plan', () => {
  const plan = (
    ...statuses: ('pending' | 'in_progress' | 'completed')[]
  ): SessionUpdate => ({
    sessionUpdate: 'plan',
    entries: ['Read the workflow', 'Scaffold handlers', 'Regenerate'].map(
      (content, index) => ({
        content,
        priority: 'medium',
        status: statuses[index] ?? 'pending',
      }),
    ),
  });

  test('draws the plan as a row of work, its steps behind a toggle', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await showing(harness, [plan('completed', 'in_progress', 'pending')], {
      status: 'streaming',
    });

    const row = page.locator('[data-plan]');
    const toggle = row.locator('[data-tool-body-toggle]');

    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-block', 'tool');
    await expect(row.locator('.tool-verb')).toHaveText(strings.plan);
    await expect(row.locator('.tool-target')).toHaveText('Scaffold handlers');
    await expect(row.locator('.tool-line .state-word')).toHaveText(
      strings.toolStatus.in_progress,
    );
    await expect(toggle).toHaveText(filled(strings.planSteps, '3'));
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(row.locator('.tool-body')).toHaveCount(0);

    await toggle.click();

    const steps = row.locator('.tool-body');

    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toHaveAttribute('data-status', 'completed');
    await expect(steps.nth(0)).toContainText(strings.toolStatus.completed);
    await expect(steps.nth(1)).toContainText('Scaffold handlers');
  });

  test('says a plan is done once every step is', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [plan('completed', 'completed', 'completed')]);

    const word = page.locator('[data-plan] .tool-line .state-word');

    await expect(word).toHaveText(strings.toolStatus.completed);
    await expect(word).not.toHaveAttribute('data-pulse');
  });

  /**
   * A turn can end with steps still open — stopped,
   * or simply finished without them. The row is
   * read down a column of work in flight, so a
   * pulsing word on a session that is doing nothing
   * says work is happening when none is.
   */
  test('stops saying a plan is running once the turn is over', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await showing(harness, [plan('completed', 'in_progress', 'pending')], {
      status: 'ready',
    });

    const row = page.locator('[data-plan]');
    const word = row.locator('.tool-line .state-word');

    await expect(word).toHaveText(strings.toolStatus.pending);
    await expect(word).not.toHaveAttribute('data-pulse');
    await expect(word).toHaveAttribute('data-tone', 'faint');
    await expect(row.locator('.tool-target')).toHaveText('Scaffold handlers');
  });

  test('keeps a plan running while a question waits', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [plan('completed', 'in_progress', 'pending')], {
      status: 'awaiting-permission',
    });

    const word = page.locator('[data-plan] .tool-line .state-word');

    await expect(word).toHaveText(strings.toolStatus.in_progress);
    await expect(word).toHaveAttribute('data-pulse', '');
  });

  /** A step nobody has started is not what the
   *  agent is doing. */
  test('names no step until one is under way', async ({ page }) => {
    const harness = await openPanel(page);

    await showing(harness, [plan('completed', 'pending', 'pending')], {
      status: 'streaming',
    });

    const row = page.locator('[data-plan]');

    await expect(row.locator('.tool-target')).toHaveCount(0);
    await expect(row.locator('.tool-line .state-word')).toHaveText(
      strings.toolStatus.in_progress,
    );
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
  const run = '7089cd29-5b5e-4a4c-9c3e-6c8d1b2f4a10';
  const sentence =
    'Applied. Replay #7089 from Refund payment to verify — earlier ' +
    'durable results are reused.';
  const edits = ['call-1:/project/lib/refund.ts', 'call-2:/project/lib/a.ts'];

  const nextStep = (): SidebarInit =>
    sidebarInit({
      transcript: sidebarEntries([
        {
          at: 'next',
          id: 'next-0',
          about: { workflowId: run, nodeId: 'refund_payment' },
          block: 'Refund payment',
          edits,
          sentence,
        },
      ]),
    });

  test('says what to do next, in a sentence of its own', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(nextStep());

    const next = page.locator('[data-next]');

    await expect(next).toHaveCount(1);
    await expect(next).toHaveAttribute('data-block', 'prose');
    await expect(next.locator('.next-sentence')).toHaveText(sentence);
    await expect(page.locator('[data-plan]')).toHaveCount(0);
  });

  /**
   * The cheap way to check an edit is to run the
   * block again on what the run already recorded,
   * so that is the choice with an edge. Taking the
   * turn back is the quiet one, and it asks for each
   * file the way Undo all does, so a file somebody
   * has since changed still answers for itself.
   */
  test('offers to replay the run from its block, or to undo the turn', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await harness.show(nextStep());

    const next = page.locator('[data-next]');
    const replay = next.locator('[data-replay-from]');
    const undo = next.locator('[data-undo-turn]');

    await expect(replay).toHaveCount(1);
    await expect(undo).toHaveCount(1);

    await expect(replay).toHaveText(strings.replayFromHere);
    await expect(replay).toHaveClass(/\bbtn\b/);
    await expect(replay).toHaveAttribute('data-variant', 'secondary');
    await expect(replay).toHaveAttribute('data-ink', 'brand');

    await expect(undo).toHaveText(strings.undoTurnEdits);
    await expect(undo).toHaveClass(/\bbtn\b/);
    await expect(undo).toHaveAttribute('data-variant', 'quiet');
    await expect(undo).not.toHaveAttribute('data-ink');

    await replay.click();

    expect(await harness.postedOfType('replayFrom')).toEqual([
      { type: 'replayFrom', workflowId: run, nodeId: 'refund_payment' },
    ]);

    await undo.click();

    expect(await harness.postedOfType('undoFile')).toEqual(
      edits.map((id) => ({ type: 'undoFile', id })),
    );
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

  /**
   * Where it came from, how many things failed, then
   * each one with its code in the failure's ink, and
   * one way to hand the lot back. The count is a
   * state, so it is said as one; the fix is a way on,
   * so it is a Button in the product's ink.
   */
  test('says how many things failed and offers the fix', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          {
            ...entry,
            rows: [
              ...entry.rows,
              {
                code: 'V08',
                at: 'confirm_email',
                message: 'Confirm by email names no handler.',
              },
            ],
          },
        ],
      }),
    );

    const found = page.locator('.diagnostic');

    await expect(found).toHaveCount(1);
    await expect(found).toHaveAttribute('data-block', 'diagnostic');
    await expect(found.locator('.diagnostic-source')).toHaveText('codegen');
    expect(
      await found
        .locator('.diagnostic-source')
        .evaluate((element) => getComputedStyle(element).fontFamily),
    ).toContain('Spline Sans Mono');

    const word = found.locator('.state-word');

    await expect(word).toHaveText(filled(strings.failedCount, '2'));
    await expect(word).toHaveAttribute('data-tone', 'fail');

    const code = found.locator('.diagnostic-code').first();

    await expect(code).toHaveText('V07');
    await expect(code).toHaveCSS('font-weight', '600');
    expect(
      sameColour(
        await code.evaluate((element) => getComputedStyle(element).color),
        colourOf('light', 'fail'),
      ),
    ).toBe(true);

    const rail = await found.locator('.diagnostic-head').evaluate((element) => {
      const style = getComputedStyle(element);

      return { width: style.borderLeftWidth, colour: style.borderLeftColor };
    });

    expect(rail.width).toBe('3px');
    expect(sameColour(rail.colour, colourOf('light', 'fail'))).toBe(true);

    const fix = found.locator('[data-fix]');

    await expect(fix).toHaveCount(1);
    await expect(fix).toHaveClass(/\bbtn\b/);
    await expect(fix).toHaveAttribute('data-variant', 'quiet');
    await expect(fix).toHaveAttribute('data-ink', 'brand');
    await expect(fix).toHaveText('Fix →');

    // The arrow is drawn, not read out: the control
    // is called what it does.
    await expect(fix).toHaveAccessibleName('Fix');
  });
});

/**
 * One file, as one card: a header saying what was
 * done to it and where that stands, the lines that
 * changed, and a footer with what can still be done
 * about it.
 */
test.describe('a file edit, decided or not', () => {
  const replaced: FileEditEntry['lines'] = [
    { kind: 'ctx', text: 'unchanged', oldNo: 1, newNo: 1 },
    { kind: 'del', text: 'old line', oldNo: 2 },
    { kind: 'add', text: 'new line', newNo: 2 },
  ];

  /**
   * One number per line: the line it was in the old
   * file when it was taken out, and the line it is
   * in the new one otherwise. Two columns of numbers
   * were a second way of reading the same diff.
   */
  test('draws each line with one gutter number and a sign', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({ transcript: [fileEntry({ lines: replaced })] }),
    );

    const lines = page.locator('.file .diff-line');

    await expect(lines).toHaveCount(3);
    await expect(page.locator('[data-kind="skip"]')).toHaveCount(0);

    const drawn = [
      ['ctx', '1', ''],
      ['del', '2', '−'],
      ['add', '2', '+'],
    ] as const;

    for (const [index, [kind, number, sign]] of drawn.entries()) {
      const line = lines.nth(index);

      await expect(line).toHaveAttribute('data-kind', kind);
      await expect(line.locator('.gutter')).toHaveCount(1);
      await expect(line.locator('.gutter')).toHaveText(number);
      await expect(line.locator('.sign')).toHaveText(sign);
    }

    // A line taken out and a line put in say which
    // they are to a screen reader too, not only in
    // their tint.
    await expect(lines.nth(1)).toMatchAriaSnapshot('- paragraph: 2 − old line');
    await expect(lines.nth(2)).toMatchAriaSnapshot('- paragraph: 2 + new line');
  });

  /**
   * Code is read in the columns it was written in,
   * so a long line runs on and the lines scroll
   * sideways together, and the wash under a changed
   * line runs as far as the longest one does.
   */
  test('never wraps a line of a diff', async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 600 });

    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          fileEntry({
            lines: [
              { kind: 'ctx', text: 'short', oldNo: 1, newNo: 1 },
              { kind: 'add', text: `long ${'x'.repeat(300)}`, newNo: 2 },
              { kind: 'del', text: 'gone', oldNo: 2 },
            ],
          }),
        ],
      }),
    );

    const body = page.locator('.file .diff');
    const lines = body.locator('.diff-line');

    await expect(lines).toHaveCount(3);
    await expect(body).toHaveCSS('overflow-x', 'auto');
    await expect(lines.nth(1)).toHaveCSS('white-space', 'pre');

    const boxes = await lines.evaluateAll((all) =>
      all.map((line) => {
        const box = line.getBoundingClientRect();

        return { width: box.width, height: box.height };
      }),
    );

    expect(boxes[1]?.height).toBe(boxes[0]?.height);
    expect(boxes[2]?.width).toBe(boxes[1]?.width);
    expect(
      await body.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
  });

  /**
   * The counts and the lines are machine text, and
   * the face is asked for by the hook every other
   * piece of machine text uses. A rule setting the
   * face on its own is one nobody finds when the
   * machine face changes.
   */
  test('sets its counts and its lines in the machine face by a hook', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({ transcript: [fileEntry({ lines: replaced })] }),
    );

    for (const selector of ['.file-counts', '.diff']) {
      const drawn = page.locator(`.file ${selector}`);

      await expect(drawn).toHaveCount(1);

      const read = await drawn.evaluate((element) => ({
        hooked: element.closest('[data-mono], .mono') !== null,
        face: getComputedStyle(element).fontFamily,
      }));

      expect(read.hooked, selector).toBe(true);
      expect(read.face, selector).toMatch(/^"?Spline Sans Mono/);
    }
  });

  test('counts both ways on every edit', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          fileEntry({ id: 'edited', path: '/project/lib/a.ts' }),
          fileEntry({
            id: 'created',
            path: '/project/lib/b.ts',
            isNew: true,
            added: 3,
            removed: 0,
            oldText: undefined,
          }),
        ],
      }),
    );

    const edited = page.locator('.file[data-file="/project/lib/a.ts"]');
    const created = page.locator('.file[data-file="/project/lib/b.ts"]');

    await expect(edited.locator('.file-head .added')).toHaveText('+1');
    await expect(edited.locator('.file-head .removed')).toHaveText('−1');
    await expect(created.locator('.file-head .added')).toHaveText('+3');
    await expect(created.locator('.file-head .removed')).toHaveText('−0');
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

  /** Kept or undone is settled: the header's word
   *  says which, and there is nothing left to
   *  offer. */
  test('offers nothing once a file is kept or undone', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          fileEntry({ id: 'a', path: '/project/lib/a.ts', decision: 'kept' }),
          fileEntry({ id: 'b', path: '/project/lib/b.ts', decision: 'undone' }),
        ],
      }),
    );

    await expect(page.locator('.file')).toHaveCount(2);
    await expect(page.locator('.file-foot')).toHaveCount(0);
    await expect(page.locator('.file [data-file-state]')).toHaveText([
      strings.fileStates.applied,
      strings.fileStates.undone,
    ]);
  });

  /**
   * Something else wrote the file since: nothing is
   * offered, because writing the snapshot back would
   * be a second, silent edit. The word in the header
   * says what happened; the sentence in the footer
   * says why nothing is offered.
   */
  test('offers nothing once a file changed since', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({ transcript: [fileEntry({ decision: 'changed-since' })] }),
    );

    const card = page.locator('.file');
    const note = card.locator('.file-foot [data-file-note]');

    await expect(card.locator('.file-head [data-file-state]')).toHaveText(
      strings.fileStates.changed,
    );
    await expect(note).toHaveCount(1);
    await expect(note).toHaveText(strings.changedSince);
    await expect(note).toHaveClass(/\bfield-hint\b/);
    await expect(note).toHaveAttribute('data-tone', 'warn');
    await expect(card.locator('[data-keep]')).toHaveCount(0);
    await expect(card.locator('[data-undo-file]')).toHaveCount(0);
  });

  /**
   * Who touched a file is said once, down the edge of
   * the header, as a call's row says it. Down the
   * lines as well it would be a rail beside a rail,
   * and the tints under them would be read against
   * it.
   */
  test("rails a person's edit in the brand on its header", async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          fileEntry({ id: 'a', path: '/project/lib/a.ts', lines: replaced }),
          fileEntry({
            id: 'b',
            path: '/project/lib/b.ts',
            by: 'person',
            lines: replaced,
          }),
        ],
      }),
    );

    const rails = [
      ['/project/lib/a.ts', 'agent', AGENT],
      ['/project/lib/b.ts', 'person', PERSON],
    ] as const;

    for (const [path, by, colour] of rails) {
      const card = page.locator(`.file[data-file="${path}"]`);

      await expect(card).toHaveAttribute('data-by', by);
      await expect(card.locator('.file-head')).toHaveCSS(
        'border-left-width',
        '3px',
      );
      await expect(card.locator('.file-head')).toHaveCSS(
        'border-left-color',
        colour,
      );

      // The card's own edge is a hairline, and the
      // lines carry no edge of their own.
      await expect(card).toHaveCSS('border-left-width', '1px');
      await expect(card.locator('.diff')).toHaveCSS('border-left-width', '0px');
    }
  });

  /**
   * An edit's lines arrive with the indentation they
   * all share already taken off, which the host
   * does. The panel keeps what is left exactly: two
   * lines that sat eight and ten spaces in start at
   * the edge and two spaces from it.
   */
  test("draws an edit's lines exactly as the host sent them", async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await harness.show(
      sidebarInit({
        transcript: [
          fileEntry({
            lines: [
              { kind: 'ctx', text: 'a', oldNo: 1, newNo: 1 },
              { kind: 'add', text: '  b', newNo: 2 },
            ],
          }),
        ],
      }),
    );

    const texts = page.locator('.file .diff-line [data-verbatim]');

    await expect(texts).toHaveCount(2);
    expect(await texts.allTextContents()).toEqual(['a', '  b']);

    // Drawn two characters in, not collapsed to the
    // edge.
    const starts = await texts.evaluateAll((all) =>
      all.map((element) => {
        const text = element.firstChild as Text;
        const glyph = document.createRange();
        const at = text.data.search(/\S/);

        glyph.setStart(text, at);
        glyph.setEnd(text, at + 1);

        return {
          left: glyph.getBoundingClientRect().left,
          width: glyph.getBoundingClientRect().width,
        };
      }),
    );

    const [first, second] = starts;

    expect(second!.left - first!.left).toBeCloseTo(2 * first!.width, 0);
  });

  for (const theme of THEMES_ALL) {
    /**
     * What became of an edit is one word, in the quiet
     * tone whatever it says, except when the edit
     * failed. A call still being made above it keeps
     * its own moving word.
     */
    test(`says what became of an edit in ${theme}`, async ({ page }) => {
      const harness = await mount(page, 'sidebar', theme);
      const states = [
        ['proposed', 'ink-muted'],
        ['applied', 'ink-muted'],
        ['undone', 'ink-muted'],
        ['changed', 'ink-muted'],
        ['failed', 'fail'],
      ] as const;

      // Where a voice colour is too light to read as
      // text, the ink says it.
      const toned = (role: Role): string =>
        theme === 'high-contrast-light' && role !== 'ink-muted'
          ? colourOf(theme, 'ink')
          : colourOf(theme, role);

      await harness.show(
        sidebarInit({
          transcript: [
            {
              at: 'tool',
              id: 'call-9',
              by: 'agent',
              kind: 'edit',
              verb: 'Edit',
              target: 'lib/a.ts',
              status: 'in_progress',
              body: [],
              paths: ['/project/lib/a.ts'],
            },
            ...states.map(([state]) =>
              fileEntry({
                id: state,
                path: `/project/lib/${state}.ts`,
                state,
              }),
            ),
          ],
        }),
      );

      const words = page.locator('.file-head [data-file-state]');

      await expect(words).toHaveCount(states.length);

      for (const [state, role] of states) {
        const word = page.locator(
          `.file[data-file="/project/lib/${state}.ts"] [data-file-state]`,
        );

        await expect(word).toHaveText(strings.fileStates[state]);
        await expect(word).toHaveClass(/\bstate-word\b/);

        const ink = await word.evaluate(
          (element) => getComputedStyle(element).color,
        );
        const expected = toned(role);

        expect(
          sameColour(ink, expected),
          `${state}: ${ink} ≠ ${expected}`,
        ).toBe(true);
      }

      const running = page.locator('[data-tool-call="call-9"] .state-word');
      const moving = await running.evaluate(
        (element) => getComputedStyle(element).color,
      );

      await expect(running).toHaveAttribute('data-pulse', '');
      expect(sameColour(moving, toned('ok')), moving).toBe(true);
    });

    /**
     * Keep and Undo are things that have to be there
     * and should not be read first, set in the card's
     * own footer. Keep is the one the product would
     * like pressed, so it takes the product's ink.
     */
    test(`keeps Keep and Undo in the footer in ${theme}`, async ({ page }) => {
      const harness = await mount(page, 'sidebar', theme);

      await harness.show(sidebarInit({ transcript: [fileEntry()] }));

      const foot = page.locator('.file .file-foot');
      const keep = foot.locator('[data-keep]');
      const undo = foot.locator('[data-undo-file]');

      await expect(keep).toHaveCount(1);
      await expect(undo).toHaveCount(1);

      for (const button of [keep, undo]) {
        await expect(button).toHaveClass(/\bbtn\b/);
        await expect(button).toHaveAttribute('data-variant', 'quiet');
      }

      await expect(keep).toHaveText(strings.keepEdit);
      await expect(keep).toHaveAttribute('data-ink', 'brand');
      await expect(undo).toHaveText(strings.undoEdit);
      await expect(undo).not.toHaveAttribute('data-ink');

      const drawn = async (button: Locator) =>
        button.evaluate((element) => {
          const style = getComputedStyle(element);

          return { edge: style.borderTopColor, ink: style.color };
        });

      // An edge only where a theme draws every
      // control's.
      const edge = colourOf(theme, 'control-edge');
      const brand =
        theme === 'high-contrast-light'
          ? colourOf(theme, 'ink')
          : colourOf(theme, 'brand');
      const kept = await drawn(keep);
      const undone = await drawn(undo);

      expect(sameColour(kept.edge, edge), `${kept.edge} ≠ ${edge}`).toBe(true);
      expect(sameColour(undone.edge, edge), `${undone.edge} ≠ ${edge}`).toBe(
        true,
      );
      expect(sameColour(kept.ink, brand), `${kept.ink} ≠ ${brand}`).toBe(true);
    });
  }

  /**
   * An added or removed line is a wash of its colour,
   * and the sign beside it and the counts over it
   * have to read on their grounds wherever the theme
   * is built to be read: in the dark, and in both
   * high-contrast themes. The light theme draws the
   * voice colours as they are.
   */
  for (const theme of [
    'dark',
    'high-contrast',
    'high-contrast-light',
  ] as const) {
    test(`tints added and removed lines readably in ${theme}`, async ({
      page,
    }) => {
      const harness = await mount(page, 'sidebar', theme);

      await harness.show(
        sidebarInit({ transcript: [fileEntry({ lines: replaced })] }),
      );

      const card = page.locator('.file');

      await expect(card.locator('.diff-line')).toHaveCount(3);

      const paint = (selector: string) =>
        card.locator(selector).evaluate((element) => {
          const style = getComputedStyle(element);

          return { ground: style.backgroundColor, ink: style.color };
        });

      for (const [kind, role] of [
        ['add', 'diff-add-bg'],
        ['del', 'diff-del-bg'],
      ] as const) {
        const row = await paint(`.diff-line[data-kind="${kind}"]`);
        const sign = await paint(`.diff-line[data-kind="${kind}"] .sign`);
        const wash = colourOf(theme, role);

        expect(sameColour(row.ground, wash), `${row.ground} ≠ ${wash}`).toBe(
          true,
        );

        const ratio = contrast(sign.ink, row.ground);

        expect(
          ratio,
          `${kind} sign ${sign.ink} on ${row.ground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }

      const head = await paint('.file-head');

      for (const count of ['.added', '.removed']) {
        const ink = (await paint(`.file-head ${count}`)).ink;
        const ratio = contrast(ink, head.ground);

        expect(
          ratio,
          `${count} ${ink} on ${head.ground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

/**
 * The row that closes out a run of files, drawn as
 * one more footer of the same card shape: what the
 * row is about in a hint, and the two things to do
 * to every file in it at once.
 */
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

    const row = page.locator('.files-batch');
    const count = row.locator('.field-hint');
    const keep = row.locator('[data-keep-all]');
    const undo = row.locator('[data-undo-all]');

    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-block', 'diff');
    await expect(count).toHaveText('2 files changed');

    await expect(keep).toHaveClass(/\bbtn\b/);
    await expect(keep).toHaveAttribute('data-variant', 'quiet');
    await expect(keep).toHaveAttribute('data-ink', 'brand');
    await expect(keep).toHaveText(strings.keepAllEdits);
    await expect(undo).toHaveClass(/\bbtn\b/);
    await expect(undo).toHaveAttribute('data-variant', 'quiet');
    await expect(undo).not.toHaveAttribute('data-ink');
    await expect(undo).toHaveText(strings.undoAllEdits);

    const inks = await Promise.all(
      [keep, undo].map((button) =>
        button.evaluate((element) => getComputedStyle(element).color),
      ),
    );
    const brand = colourOf('light', 'brand');
    const muted = colourOf('light', 'ink-muted');

    expect(sameColour(inks[0]!, brand), `${inks[0]} ≠ ${brand}`).toBe(true);
    expect(sameColour(inks[1]!, muted), `${inks[1]} ≠ ${muted}`).toBe(true);

    await keep.click();

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

    await expect(page.locator('.files-batch .field-hint')).toHaveText(
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

    // Every kind the protocol has, each once. Both
    // lasting answers take the outline, whether
    // they allow or refuse: that they last is what
    // sets them apart, and the agent's own labels
    // tell the two apart.
    await harness.show(
      sidebarInit({
        status: 'awaiting-permission',
        prompt: {
          ...prompt,
          options: [
            ...prompt.options,
            {
              optionId: 'no-always',
              label: 'Reject always',
              kind: 'reject_always',
            },
          ],
        },
      }),
    );

    await expect(page.locator('[data-option]')).toHaveCount(4);
    await expect(page.locator('[data-option="no-always"]')).toHaveAttribute(
      'data-always',
      'true',
    );
    await expect(page.locator('[data-option="no"]')).toHaveAttribute(
      'data-always',
      'false',
    );

    const looks = {
      yes: 'primary',
      'yes-always': 'secondary',
      no: 'quiet',
      'no-always': 'secondary',
    };

    for (const [option, variant] of Object.entries(looks)) {
      const button = page.locator(`[data-option="${option}"]`);

      await expect(button).toHaveClass(/\bbtn\b/);
      await expect(button).toHaveAttribute('data-variant', variant);
    }

    for (const option of ['yes-always', 'no-always']) {
      await expect(page.locator(`[data-option="${option}"]`)).toHaveAttribute(
        'data-ink',
        'brand',
      );
    }
  });

  /**
   * Pinned under the log rather than written into
   * it: the agent is waiting on the answer, so the
   * question stays where the answer is typed however
   * far the log has scrolled. It says what it is in
   * a label, names the call it is about in the
   * machine face, and marks lasting options by their
   * look alone.
   */
  test('asks in a block of its own under the transcript', async ({ page }) => {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ status: 'awaiting-permission', prompt }));

    const block = page.locator('.agent-foot > .permission');

    await expect(block).toHaveCount(1);
    await expect(block).toHaveAttribute('data-block', 'permission');
    await expect(page.locator('.transcript .permission')).toHaveCount(0);
    await expect(block.locator('.section-label')).toHaveText(
      strings.permission,
    );

    const tool = block.locator('.permission-tool');

    await expect(tool).toHaveText(prompt!.title);
    expect(
      await tool.evaluate((element) => getComputedStyle(element).fontFamily),
    ).toContain('Spline Sans Mono');

    await expect(page.locator('.always')).toHaveCount(0);
  });

  for (const theme of THEMES_ALL) {
    test(`grounds a question on the warning tint in ${theme}`, async ({
      page,
    }) => {
      const harness = await mount(page, 'sidebar', theme);

      await harness.show(
        sidebarInit({ status: 'awaiting-permission', prompt }),
      );

      const block = page.locator('.permission');

      await expect(block).toHaveCount(1);

      const read = await block.evaluate((element) => {
        const style = getComputedStyle(element);

        return { ground: style.backgroundColor, edge: style.borderTopColor };
      });
      const tint = colourOf(theme, 'warn-tint');
      const edge = colourOf(theme, 'control-edge');

      expect(sameColour(read.ground, tint), `${read.ground} ≠ ${tint}`).toBe(
        true,
      );
      expect(sameColour(read.edge, edge), `${read.edge} ≠ ${edge}`).toBe(true);
    });
  }

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

  /**
   * A browser can move the log a pixel of its own
   * accord as its box changes size — Chromium on
   * Linux snaps the offset to a whole pixel — and
   * that scroll is heard before the log has answered
   * the resize. It is the resize's scroll rather
   * than the reader's, so the log still follows.
   */
  test('follows a growing composer through the scroll its resize makes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 700 });

    const harness = await openPanel(page);
    await showing(harness, [said(long)]);

    const log = page.locator('.transcript');
    await expect.poll(() => gapBelow(log)).toBeLessThanOrEqual(1);
    await aFrame(page);

    // The draft grows as a keystroke grows it, and in
    // the same task the log moves a pixel, so the one
    // frame after sees the scroll and then the resize.
    await page.evaluate((draft) => {
      const field = document.querySelector('.composer textarea');
      const transcript = document.querySelector('.transcript');
      if (!(field instanceof HTMLTextAreaElement) || transcript === null) {
        throw new Error('no composer or no log');
      }

      const value = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!;
      value.set!.call(field, draft);
      field.dispatchEvent(new Event('input', { bubbles: true }));

      transcript.scrollTop += 1;
    }, 'and then\n'.repeat(6));

    await expect
      .poll(() => page.locator('.composer textarea').inputValue())
      .toBe('and then\n'.repeat(6));
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

  test('offers attach, then the agent, then Send, in one row', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    const field = page.locator('.composer textarea');
    const attach = page.locator('.composer [data-attach]');
    const agent = page.locator('.composer [data-composer-agent]');
    const send = page.locator('.composer button[type="submit"]');

    await expect(attach).toHaveCount(1);
    await expect(agent).toHaveCount(1);
    await expect(send).toHaveCount(1);

    const order = async (): Promise<string[]> =>
      await page.locator('.composer-meta').evaluate((row) =>
        [...row.querySelectorAll('button')].map((button) => {
          if (button.matches('[data-attach]')) return 'attach';
          if (button.matches('[data-composer-agent]')) return 'agent';
          if (button.matches('[data-stop]')) return 'stop';

          return button.type;
        }),
      );

    expect(await order()).toEqual(['attach', 'agent', 'submit']);

    const under = (await field.boundingBox())!;
    const first = (await attach.boundingBox())!;
    const left = (await agent.boundingBox())!;
    const right = (await send.boundingBox())!;
    const middle = (box: { y: number; height: number }): number =>
      box.y + box.height / 2;

    expect(first.y).toBeGreaterThanOrEqual(under.y + under.height);
    expect(left.y).toBeGreaterThanOrEqual(under.y + under.height);
    expect(Math.abs(middle(first) - middle(right))).toBeLessThanOrEqual(1);
    expect(Math.abs(middle(left) - middle(right))).toBeLessThanOrEqual(1);
    expect(first.x + first.width).toBeLessThan(left.x);
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

    // Stop takes Send's place and nothing moves
    // round it.
    await harness.show(sidebarInit({ status: 'streaming' }));
    await expect(page.locator('.composer [data-stop]')).toHaveCount(1);

    expect(await order()).toEqual(['attach', 'agent', 'stop']);
  });

  test('asks the extension for files to attach', async ({ page }) => {
    const harness = await openPanel(page);
    const attach = page.locator('.composer [data-attach]');

    await expect(attach).toHaveCount(1);
    await expect(attach).toHaveAccessibleName(strings.attachFiles);
    await expect(page.locator('.composer [data-attached]')).toHaveCount(0);

    await attach.click();

    expect(await harness.postedOfType('attach')).toEqual([{ type: 'attach' }]);
  });

  /**
   * What the next prompt carries is on show under
   * what is being typed, each file with its own way
   * back out, so nobody sends a file they meant to
   * take away.
   */
  test('lets one attached file go', async ({ page }) => {
    const harness = await openPanel(page);
    const a = { uri: 'file:///project/lib/a.ts', name: 'lib/a.ts' };
    const b = { uri: 'file:///project/lib/b.ts', name: 'lib/b.ts' };

    await harness.show(sidebarInit({ attached: [a, b] }));

    const names = page.locator('.composer [data-attached]');

    await expect(names).toHaveCount(1);
    await expect(names).toContainText(a.name);
    await expect(names).toContainText(b.name);

    // Under the field, over the row of controls.
    const field = (await page.locator('.composer textarea').boundingBox())!;
    const line = (await names.boundingBox())!;
    const meta = (await page.locator('.composer-meta').boundingBox())!;

    expect(line.y).toBeGreaterThanOrEqual(field.y + field.height);
    expect(line.y + line.height).toBeLessThanOrEqual(meta.y);

    const removeB = names.getByRole('button', {
      name: filled(strings.removeAttached, b.name),
    });

    await expect(
      names.getByRole('button', {
        name: filled(strings.removeAttached, a.name),
      }),
    ).toHaveCount(1);
    await expect(removeB).toHaveCount(1);

    await removeB.focus();
    await page.keyboard.press('Enter');

    expect(await harness.postedOfType('detach')).toEqual([
      { type: 'detach', uri: b.uri },
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
      const drawnEdge = colourOf(theme, 'control-edge');

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

    /**
     * The names are what the prompt will carry, read
     * before it goes, so they take the ink the row's
     * own controls do rather than a hint's fainter
     * one.
     */
    test(`draws what is attached in the controls' ink in ${theme}`, async ({
      page,
    }) => {
      const harness = await mount(page, 'sidebar', theme);

      await harness.show(
        sidebarInit({
          attached: [{ uri: 'file:///project/lib/a.ts', name: 'lib/a.ts' }],
        }),
      );

      const names = page.locator('.composer [data-attached]');
      const attach = page.locator('.composer [data-attach]');

      await expect(names).toHaveCount(1);

      const ink = await names.evaluate(
        (element) => getComputedStyle(element).color,
      );
      const muted = colourOf(theme, 'ink-muted');

      expect(sameColour(ink, muted), `${ink} ≠ ${muted}`).toBe(true);
      expect(
        await attach.evaluate((element) => getComputedStyle(element).color),
      ).toBe(ink);
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

/**
 * Why there is nothing to talk to, said as the state
 * of the whole panel: what is in the way, then what
 * to do about it. The panel offers no button of its
 * own for either — the editor trusts a folder and
 * opens one, and the picker in the head is where an
 * agent is chosen.
 */
test.describe('before there is an agent', () => {
  /** The panel in a status with no session, read
   *  as the one empty state it draws. */
  async function blocked(
    page: Page,
    status: 'untrusted' | 'no-project' | 'no-agent',
  ): Promise<{ harness: Harness; empty: Locator }> {
    const harness = await openPanel(page);

    await harness.show(sidebarInit({ status, agent: undefined }));

    const empty = page.locator('[data-agent-state]');

    await expect(empty).toHaveCount(1);
    await expect(empty).toHaveAttribute('data-agent-state', status);
    await expect(empty).toHaveClass(/\bempty-state\b/);
    await expect(empty.locator('.btn')).toHaveCount(0);
    await expect(page.locator('.composer')).toHaveCount(0);

    return { harness, empty };
  }

  test('says a folder has to be trusted first', async ({ page }) => {
    const { empty } = await blocked(page, 'untrusted');

    await expect(empty.locator('.empty-title')).toHaveText(
      strings.notTrustedTitle,
    );
    await expect(empty.locator('.empty-detail')).toHaveText(strings.notTrusted);
  });

  test('says a folder has to be open first', async ({ page }) => {
    const { empty } = await blocked(page, 'no-project');

    await expect(empty.locator('.empty-title')).toHaveText(
      strings.noFolderTitle,
    );
    await expect(empty.locator('.empty-detail')).toHaveText(strings.noProject);
  });

  test('offers to pick one when none is chosen', async ({ page }) => {
    const { harness, empty } = await blocked(page, 'no-agent');

    await expect(empty.locator('.empty-title')).toHaveText(strings.noAgent);
    await expect(empty.locator('.empty-detail')).toHaveCount(0);

    // A title is a state, not a sentence.
    expect(strings.noAgent.endsWith('.')).toBe(false);

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

    const failure = page.locator('[data-failure]');

    await expect(failure).toHaveCount(1);
    await expect(failure).toHaveClass(/\bcallout\b/);
    await expect(failure).toHaveAttribute('data-tone', 'fail');
    await expect(failure.locator('.callout-title')).toHaveText(
      'claude code speaks a different version of the protocol.',
    );
    await expect(failure.locator('.callout-body')).toHaveText(
      'It answered 2; this extension speaks 1.',
    );
    await expect(page.locator('[data-agent-state]')).toHaveCount(0);
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
