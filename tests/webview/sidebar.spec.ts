import { expect, test, type Page } from '@playwright/test';

import { foldUpdates, type SessionUpdate } from '../../src/acp/transcript.js';
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
  plan: 'Plan',
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

test.describe('a tool call', () => {
  const call: SessionUpdate = {
    sessionUpdate: 'tool_call',
    toolCallId: 'call-1',
    title: 'Write lib/twilioChat.ts',
    kind: 'edit',
    status: 'pending',
  };

  test('is a card that can be folded away, marked with its kind', async ({
    page,
  }) => {
    const harness = await openPanel(page);

    await showing(harness, [call]);

    const card = page.locator('[data-tool-call="call-1"]');

    await expect(card).toHaveAttribute('data-kind', 'edit');
    await expect(card).toHaveAttribute('data-status', 'pending');
    await expect(card.locator('summary')).toContainText(
      'Write lib/twilioChat.ts',
    );
    await expect(card.locator('.tool-mark')).not.toBeEmpty();
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

    const rows = page.locator('.file-row');

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
  test('is a checklist, one line per step', async ({ page }) => {
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

    const steps = page.locator('[data-entry="plan"] .step');

    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toHaveAttribute('data-status', 'completed');
    await expect(steps.nth(1)).toContainText('Scaffold handlers');
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
