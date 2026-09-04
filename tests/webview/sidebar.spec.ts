import { expect, test, type Page } from '@playwright/test';

import type {
  DiagnosticEntry,
  FileEditEntry,
  SessionUpdate,
} from '../../src/acp/transcript.js';
import { foldUpdates } from '../../src/acp/transcript.js';
import type {
  SidebarInit,
  SidebarStrings,
} from '../../src/webview/protocol.js';

import { mount, type Harness, type ThemeKind } from './harness.js';

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

const strings: SidebarStrings = {
  heading: 'Agent',
  chooseAgent: 'Choose an agent',
  notTrusted: 'Trust this folder to run a coding agent.',
  noProject: 'Open a folder to run a coding agent in it.',
  noAgent: 'No coding agent chosen yet.',
  connecting: 'Starting the agent…',
  ready: 'Ready',
  thinking: 'Working…',
  send: 'Send',
  stop: 'Stop',
  placeholder: 'Edit the graph, scaffold a lib fn, or ask why…',
  newFile: 'new',
  permission: 'Permission needed',
  always: 'always',
  approve: 'Approve & apply',
  refine: 'Refine',
  undo: 'Undo',
  toolStatus: {
    pending: 'queued',
    in_progress: 'running',
    completed: 'done',
    failed: 'failed',
  },
  keepEdit: 'Keep',
  undoEdit: 'Undo',
  keepAllEdits: 'Keep all',
  undoAllEdits: 'Undo all',
  filesChanged: '{0} files changed',
  changedSince: 'changed since · nothing to undo',
  showLines: '{0} lines · show',
  planProgress: 'Plan · {0}/{1}',
};

const said = (body: string): SessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text: body },
});

function sidebarInit(over: Partial<SidebarInit> = {}): SidebarInit {
  return {
    type: 'init',
    view: 'sidebar',
    strings,
    agent: 'claude code',
    status: 'ready',
    transcript: [],
    prompt: undefined,
    failure: undefined,
    preview: undefined,
    ...over,
  };
}

/** The panel, showing what these updates fold
 *  into. */
async function showing(
  harness: Harness,
  updates: SessionUpdate[],
  over: Partial<SidebarInit> = {},
): Promise<void> {
  await harness.show(
    sidebarInit({ transcript: foldUpdates([], updates), ...over }),
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

/** A pending file edit, ready to be overridden for
 *  one thing at a time. */
function fileEntry(over: Partial<FileEditEntry> = {}): FileEditEntry {
  return {
    at: 'file',
    id: 'call-1:/project/lib/twilioChat.ts',
    toolCallId: 'call-1',
    by: 'agent',
    path: '/project/lib/twilioChat.ts',
    isNew: false,
    added: 1,
    removed: 1,
    lines: [],
    oldText: 'old\n',
    newText: 'new\n',
    decision: 'pending',
    ...over,
  };
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
              { kind: 'skip', text: '3' },
            ],
          }),
        ],
      }),
    );

    const lines = page.locator('.diff-line');

    await expect(lines).toHaveCount(4);

    await expect(lines.nth(1)).toHaveAttribute('data-kind', 'del');
    await expect(lines.nth(1).locator('.sign')).toHaveText('−');
    await expect(lines.nth(1).locator('.gutter').first()).toHaveText('2');

    await expect(lines.nth(2)).toHaveAttribute('data-kind', 'add');
    await expect(lines.nth(2).locator('.sign')).toHaveText('+');
    await expect(lines.nth(2).locator('.gutter').nth(1)).toHaveText('2');

    await expect(lines.nth(3)).toHaveText('⋯ 3');
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
  for (const theme of ['light', 'dark', 'high-contrast'] as const) {
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
