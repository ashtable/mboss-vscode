import type { Page } from '@playwright/test';

import type { ToolEntry } from '../../../src/acp/transcript.js';
import { storedValue } from '../../../src/runs/rows.js';
import { liveStep } from '../../../src/test-support/runs.js';
import type { WebviewName } from '../../../src/webview/entry.js';
import { shortRunId } from '../../../src/webview/ids.js';

import {
  NO_PARTITION_KEY,
  PARTITIONED,
  RECORDED_AT,
  THREW_IN_LIB,
  blockInit,
  blockSubject,
  canvasInit,
  following,
  inspectorInit,
  openQuickAdd,
  queueSubject,
  recording,
  runOf,
  triggerSubject,
} from './canvas.js';
import { galleryInit } from './gallery.js';
import { APP_DOWN, BY_STATE, MANUAL, SCHEDULE, runsInit } from './list.js';
import {
  GRAPH,
  RUN_LINEAGE,
  TRACE,
  UNATTRIBUTED,
  runLevel,
  seeInit,
  seeRun,
} from './runs.js';
import {
  evidenceOf,
  fileEntry,
  sidebarEntries,
  sidebarInit,
} from './sidebar.js';

/**
 * Every view, drawing the things most likely to
 * break a rule every view has to keep: a run by
 * each kind of id, a run that failed, a step that
 * threw, a value still in its serializer's
 * wrapping, a step that returned nothing, and what
 * mBoss read for the agent quoting a whole id.
 *
 * Built from the same fixtures each view's own spec
 * draws, so a scene is a page somebody could
 * actually be looking at.
 */
export type Scene = {
  /** What is on the page, as a phrase. */
  readonly name: string;
  readonly view: WebviewName;
  readonly width: number;
  readonly init: () => unknown;

  /** A gesture that has to happen after every
   *  mount, such as holding a wire to open the
   *  quick add. */
  readonly after?: (page: Page) => Promise<void>;

  /** What the scene was built to draw, as the
   *  hooks it is found by. A rule read over a hook
   *  the page does not have holds of nothing, so
   *  each of these is counted before it is read. */
  readonly draws: readonly string[];
};

/** A run's whole id, and one that refused, as the
 *  ids mBoss quotes to the agent. The first is also
 *  the run the run tab and the canvas follow, so a
 *  view printing it whole is caught there too. */
const RUN = '7089cd29-5b5e-4a4c-9c3e-6c8d1b2f4a10';
const REFUSED = '5d1e2f3a-9c3e-4a4c-8b5e-6c8d1b2f4a10';

/** A value as DBOS stores it, still wrapped. */
export const ENVELOPE = JSON.stringify({
  json: { extracted: 15 },
  __dbos_serializer: 'superjson',
});

/** What DBOS stores for a step that returned
 *  nothing at all. */
export const VOID = JSON.stringify({
  json: null,
  meta: { values: ['undefined'] },
  __dbos_serializer: 'superjson',
});

/** A call the agent is still making: the one row in
 *  the panel that moves. */
const READING: ToolEntry = {
  at: 'tool',
  id: 'call-2',
  by: 'agent',
  kind: 'read',
  verb: 'Read',
  target: 'lib/twilioChat.ts',
  status: 'in_progress',
  body: [],
  paths: ['/project/lib/twilioChat.ts'],
};

/** What mBoss sends the agent about a run, and the
 *  copy of it the column shows instead. */
const ASKED =
  `Run \`${shortRunId(RUN)}\` of \`refund_order\` recorded no failure; ` +
  'DBOS has it as done.';

/** A step of the canonical fixture that returned
 *  this, timed to the millisecond. */
function returned(output: string) {
  return liveStep({
    name: 'find_slot',
    nodeId: 'find_slot',
    functionId: 3,
    startedAt: RECORDED_AT,
    completedAt: RECORDED_AT + 48,
    output,
  });
}

/** The Inspector on what a run recorded for the
 *  canonical fixture's `find_slot`. */
function evidenceOfStep(step: ReturnType<typeof returned>) {
  return blockInit(
    following(blockSubject('find_slot', {}, 'evidence'), recording([step])),
  );
}

/**
 * Opens every folded body in the agent's column:
 * what an evidence row read is not in the page
 * until somebody asks for it.
 *
 * The pointer is then taken off the panel. Left on
 * the last toggle it holds that toggle in its hover
 * ground, and in this browser every transition on
 * the page stays at its first frame for as long as
 * it rests there, so a theme switch never lands.
 */
async function openBodies(page: Page): Promise<void> {
  const toggles = page.locator('[data-tool-body-toggle]');

  for (const toggle of await toggles.all()) await toggle.click();

  await page.locator('.tool-body [data-verbatim]').first().waitFor();
  await page.mouse.move(0, 0);
}

/** Every field a form offers, by the row it sits
 *  in. */
export const FIELDS = '[data-property] :is(input, select, textarea)';

export const SCENES: readonly Scene[] = [
  {
    name: 'the canvas following a failed run',
    view: 'canvas',
    width: 1280,
    init: () =>
      canvasInit({
        run: {
          ...runOf(
            [
              ['parse_request', 'done'],
              ['find_slot', 'failed'],
            ],
            'failed',
          ),
          workflowId: RUN,
        },
        selected: 'find_slot',
      }),
    draws: ['[data-run="done"]', '[data-run="failed"]', '[data-short-run]'],
  },
  {
    name: 'the canvas offering blocks for a held wire',
    view: 'canvas',
    width: 1280,
    init: () => canvasInit(),
    after: openQuickAdd,
    draws: ['[data-quick-add-kind]'],
  },
  {
    name: 'the agent at work',
    view: 'sidebar',
    width: 300,
    init: () =>
      sidebarInit({
        status: 'streaming',
        transcript: sidebarEntries([
          {
            at: 'message',
            id: 'user-0',
            from: 'user',
            text: `Why did ${RUN} say SUCCESS at 3 PM?`,
          },
          {
            at: 'message',
            id: 'agent-0',
            from: 'agent',
            text: 'Run `npm install` first.',
          },
          fileEntry({
            lines: [
              { kind: 'del', text: 'old line', oldNo: 2 },
              { kind: 'add', text: 'new line', newNo: 2 },
            ],
          }),
          READING,
          evidenceOf(RUN, [
            { text: 'error · ', recorded: `Awaited ${RUN} was cancelled` },
            { text: 'status · done' },
          ]),
          {
            ...evidenceOf(REFUSED, [
              {
                text: 'detail · ',
                recorded: `refused while ${REFUSED} held the lock`,
              },
            ]),
            action: undefined,
          },
          {
            at: 'message',
            id: 'user-1',
            from: 'user',
            text: ASKED,
            about: {
              workflowId: RUN,
              nodeId: 'refund_payment',
              block: 'Refund payment',
              shown: ASKED,
            },
          },
        ]),
      }),
    after: openBodies,
    draws: [
      '.said-typed[data-verbatim]',
      '.tool-body [data-verbatim]',
      '[data-short-run]',
      '.diff-line[data-kind="add"]',
      '.btn[data-variant="stop"]',
      '.state-word[data-tone="ok"]',
      '[data-agent-head]',
      '.agent-foot',
      '.composer',
      '.btn[data-variant="quiet"]',
    ],
  },
  {
    name: 'the runs list',
    view: 'runs',
    width: 300,
    init: () =>
      runsInit({
        selected: BY_STATE.failed.workflowId,
        testRun: {
          workflows: [MANUAL, SCHEDULE],
          selected: MANUAL.name,
          input: '{ "n": 1 }',
          hint: undefined,
          problem: undefined,
        },
      }),
    draws: [
      '[data-short-run]',
      'li[data-run]',
      '.runs-head',
      '[data-zone="stack"]',
      '.runs-foot',
      'li[data-run]:has(> [aria-current="true"])',
      'li[data-run]:not(:has(> [aria-current="true"]))',
      '.field-input',
      FIELDS,
    ],
  },
  {
    name: 'the runs panel with the app down',
    view: 'runs',
    width: 300,
    init: () => APP_DOWN,
    draws: [
      '[data-service]',
      '.runs-head',
      '.runs-foot',
      'li[data-run]:has(> [aria-current="true"])',
    ],
  },
  {
    name: "a run's trace",
    view: 'see',
    width: 1280,
    init: () =>
      seeInit(
        seeRun({
          workflowId: RUN,
          short: shortRunId(RUN),
          graph: GRAPH,
          trace: [
            ...TRACE,
            {
              ...TRACE[0]!,
              functionId: 6,
              name: 'parse_request.r2',
              detail: {
                derived: undefined,
                plain: undefined,
                verbatim: storedValue(ENVELOPE).shown,
              },
            },
            {
              ...TRACE[0]!,
              functionId: 7,
              name: 'parse_request.r3',
              detail: {
                derived: undefined,
                plain: 'Parse request',
                verbatim: undefined,
              },
            },
          ],
          unattributed: UNATTRIBUTED,
        }),
        'trace',
      ),
    draws: ['[data-trace]', '[data-short-run]'],
  },
  {
    name: "a run's graph",
    view: 'see',
    width: 1280,
    init: () =>
      seeInit(
        seeRun({
          workflowId: RUN,
          short: shortRunId(RUN),
          graph: GRAPH,
          trace: TRACE,
          selected: { nodeId: 'find_slot', functionId: 1 },
        }),
        'graph',
      ),
    draws: ['[data-pane="graph"] .react-flow__node'],
  },
  {
    name: 'a queue block being set up',
    view: 'inspector',
    width: 300,
    init: () => blockInit(queueSubject(PARTITIONED, [NO_PARTITION_KEY])),
    draws: [FIELDS, '.field-input'],
  },
  {
    name: 'a manual trigger with an input waiting',
    view: 'inspector',
    width: 300,
    init: () =>
      blockInit(triggerSubject({ mode: 'manual' }, { text: '{ "n": 1 }' })),
    draws: [FIELDS, '[data-recorded]', '.field-input'],
  },
  {
    name: 'what a failed step recorded',
    view: 'inspector',
    width: 300,
    init: () =>
      blockInit(
        following(
          blockSubject('find_slot', {}, 'evidence'),
          recording([THREW_IN_LIB]),
        ),
      ),
    draws: ['.callout', '[data-time="fine"]'],
  },
  {
    name: 'what a step returned, still wrapped',
    view: 'inspector',
    width: 300,
    init: () => evidenceOfStep(returned(ENVELOPE)),
    draws: ['.inline-chip'],
  },
  {
    name: 'a step that returned nothing',
    view: 'inspector',
    width: 300,
    init: () => evidenceOfStep(returned(VOID)),
    draws: ['[data-inspector]'],
  },
  {
    name: 'a whole run',
    view: 'inspector',
    width: 300,
    init: () =>
      inspectorInit({ at: 'run', run: runLevel({ lineage: RUN_LINEAGE }) }),
    draws: ['[data-ledger]', '[data-short-run]'],
  },
  {
    name: 'the patterns to start from',
    view: 'gallery',
    width: 1280,
    init: () => galleryInit(),
    draws: ['[data-pattern]'],
  },
];
