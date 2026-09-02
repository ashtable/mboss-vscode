import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  newProject,
  offerVendorRefresh,
  type ProjectHost,
} from './newProject.js';
import { buildExtension } from '../build.js';
import { makeProject } from '../test-support/project.js';
import { CORE_ROOT } from '../test-support/repo.js';
import {
  FAKE_SKILL,
  cleanRoots,
  fakeVendor,
  scratchDir,
} from '../test-support/vendor.js';
import { refreshVendor, shippedVendor, vendorState } from '../vendor/index.js';

/**
 * Creating a project, as a person does it.
 *
 * The command is the thin part: ask where, ask
 * what to call it, hand both to core's scaffold
 * with the bundle this extension ships, put the
 * skill where the agent will find it. What is worth
 * testing is that each of those happened, that the
 * ways it can be abandoned leave nothing behind,
 * and that a refusal reaches the person as a
 * sentence rather than as an unhandled rejection in
 * a log nobody opens.
 */

afterAll(cleanRoots);

/** An editor that records what it was asked. */
function recorder(
  answers: {
    folder?: string;
    name?: string;
    trusted?: boolean;
    folders?: string[];
    accept?: boolean;
  } = {},
): ProjectHost & {
  shown: string[];
  errors: string[];
  asked: string[];
  opened: { dir: string; newWindow: boolean }[];
  progress: string[];
} {
  const shown: string[] = [];
  const errors: string[] = [];
  const asked: string[] = [];
  const opened: { dir: string; newWindow: boolean }[] = [];
  const progress: string[] = [];

  return {
    shown,
    errors,
    asked,
    opened,
    progress,
    isTrusted: () => answers.trusted ?? true,
    folders: () => answers.folders ?? [],
    pickFolder: async () => answers.folder,
    askName: async (prompt) => {
      if (answers.name === undefined) return undefined;

      const refusal = prompt.validate(answers.name);
      return refusal === undefined ? answers.name : undefined;
    },
    withProgress: async (title, work) => {
      progress.push(title);
      return await work();
    },
    confirm: async (prompt) => {
      asked.push(prompt.message);
      return answers.accept ?? true;
    },
    info: (message) => void shown.push(message),
    error: (message) => void errors.push(message),
    openProject: async (dir, options) =>
      void opened.push({ dir, newWindow: options.newWindow }),
  };
}

/**
 * The tree as core's own golden spells one: a
 * sorted listing, a directory with nothing in it
 * marked by a trailing slash.
 *
 * Modes are left out. Core's suite owns which files
 * are written at 0600 and 0755, and reading them
 * back off disk would make this spec fail on a
 * machine with an unusual umask for a reason that
 * has nothing to do with creating a project.
 */
function listing(root: string, prefix = ''): string[] {
  const entries = readdirSync(root).sort();

  if (entries.length === 0) return [`${prefix.slice(0, -1)}/`];

  return entries.flatMap((name) => {
    const path = join(root, name);

    return statSync(path).isDirectory()
      ? listing(path, `${prefix}${name}/`)
      : [`${prefix}${name}`];
  });
}

/** What core says a project is, before vendoring. */
function goldenListing(): string[] {
  const golden = readFileSync(
    join(CORE_ROOT, 'fixtures', 'golden', 'scaffold', 'tree.txt'),
    'utf8',
  );

  return golden
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/ \(\d{4}\)$/, ''));
}

/** And what vendoring adds to it. */
function expectedListing(): string[] {
  const skill = FAKE_SKILL.map((file) => file.path);
  const filled = new Set([
    '.mboss/mcp/README.md',
    '.mboss/skills/mboss/',
    '.claude/skills/mboss/',
  ]);

  return [
    ...goldenListing().filter((line) => !filled.has(line)),
    '.mboss/mcp/VERSION',
    '.mboss/mcp/server.js',
    ...skill.map((path) => `.mboss/skills/mboss/${path}`),
    ...skill.map((path) => `.claude/skills/mboss/${path}`),
  ].sort();
}

describe('creating a project', () => {
  /** Runs the command through and answers where it
   *  put the project. */
  const created = async (): Promise<string> => {
    const parent = scratchDir('mboss-new-');

    await newProject(
      recorder({ folder: parent, name: 'demo' }),
      fakeVendor(),
    )();

    return join(parent, 'demo');
  };

  it('writes the whole project, with the control plane in it', async () => {
    const parent = scratchDir('mboss-new-');
    const host = recorder({ folder: parent, name: 'demo' });

    await newProject(host, fakeVendor())();

    expect(listing(join(parent, 'demo')).sort()).toEqual(expectedListing());
    expect(host.errors).toEqual([]);
  });

  /**
   * The key is `mboss` everywhere — it is what the
   * skill's own tool names and the server's own
   * name agree on, and a project that renamed it
   * would give an agent tools it could not call.
   */
  it('leaves the agent a server to connect to', async () => {
    const config = JSON.parse(
      readFileSync(join(await created(), '.mcp.json'), 'utf8'),
    ) as { mcpServers: Record<string, { command: string; args: string[] }> };

    expect(Object.keys(config.mcpServers)).toEqual(['mboss']);
    expect(config.mcpServers['mboss']?.command).toBe('node');
    expect(config.mcpServers['mboss']?.args.join(' ')).toContain(
      '.mboss/mcp/server.js',
    );
  });

  it('stamps the bundle with the version it shipped', async () => {
    expect(
      readFileSync(join(await created(), '.mboss', 'mcp', 'VERSION'), 'utf8'),
    ).toBe('test-v0.0.0+abc1234\n');
  });

  it('reports how long the work takes while it does it', async () => {
    const host = recorder({ folder: scratchDir('mboss-new-'), name: 'demo' });

    await newProject(host, fakeVendor())();

    expect(host.progress).toHaveLength(1);
    expect(host.progress[0]?.length).toBeGreaterThan(0);
  });

  /**
   * A window with a folder in it already has
   * somebody's work open, and replacing it is not
   * what "new project" meant.
   */
  it('opens the new project beside the one already open', async () => {
    const parent = scratchDir('mboss-new-');
    const host = recorder({
      folder: parent,
      name: 'demo',
      folders: ['/somewhere/else'],
    });

    await newProject(host, fakeVendor())();

    expect(host.opened).toEqual([
      { dir: join(parent, 'demo'), newWindow: true },
    ]);
  });

  it('opens it in this window when there is nothing in it', async () => {
    const parent = scratchDir('mboss-new-');
    const host = recorder({ folder: parent, name: 'demo' });

    await newProject(host, fakeVendor())();

    expect(host.opened).toEqual([
      { dir: join(parent, 'demo'), newWindow: false },
    ]);
  });
});

describe('a project that is not created', () => {
  it('leaves nothing behind when the folder pick is abandoned', async () => {
    const host = recorder({ name: 'demo' });

    await newProject(host, fakeVendor())();

    expect(host.opened).toEqual([]);
    expect(host.errors).toEqual([]);
    expect(host.progress).toEqual([]);
  });

  it('leaves nothing behind when the name is abandoned', async () => {
    const parent = scratchDir('mboss-new-');
    const host = recorder({ folder: parent });

    await newProject(host, fakeVendor())();

    expect(readdirSync(parent)).toEqual([]);
    expect(host.opened).toEqual([]);
  });

  /**
   * Creating a project writes an executable control
   * plane into a folder, which is the decision
   * workspace trust exists to make. Saying so is the
   * point: a command that greys out tells nobody
   * why.
   */
  it('says why it will not run in a folder nobody trusts', async () => {
    const parent = scratchDir('mboss-new-');
    const host = recorder({ folder: parent, name: 'demo', trusted: false });

    await newProject(host, fakeVendor())();

    expect(readdirSync(parent)).toEqual([]);
    expect(host.shown).toHaveLength(1);
    expect(host.shown[0]?.length).toBeGreaterThan(0);
  });

  /**
   * Core refuses to scaffold over somebody's
   * project, and its refusal names what it found.
   * That has to arrive as a notification — an
   * unhandled rejection is a line in a log nobody
   * opens.
   */
  it('surfaces a refusal rather than throwing it', async () => {
    const parent = scratchDir('mboss-new-');
    mkdirSync(join(parent, 'demo'), { recursive: true });
    writeFileSync(join(parent, 'demo', 'package.json'), '{}\n', 'utf8');

    const host = recorder({ folder: parent, name: 'demo' });
    await expect(newProject(host, fakeVendor())()).resolves.toBeUndefined();

    expect(host.errors).toHaveLength(1);
    expect(host.errors[0]).toContain('package.json');
    expect(host.opened).toEqual([]);
  });

  /**
   * The name is a directory, an npm package name, a
   * compose project name and the application name
   * every run is recorded against, so it is core's
   * schema that decides — checked as they type
   * rather than after the fact.
   */
  it('refuses a name core would not accept', async () => {
    const parent = scratchDir('mboss-new-');
    const host = recorder({ folder: parent, name: 'My Project' });

    await newProject(host, fakeVendor())();

    expect(readdirSync(parent)).toEqual([]);
  });
});

/**
 * Keeping a project that already exists current.
 *
 * The thing that changes here is the extension, so
 * the offer belongs to the moment the window comes
 * up — and it has to be a question rather than an
 * action, because saying yes rewrites files inside
 * somebody's repository.
 */
describe('offering to refresh what a project vendored', () => {
  /** A project with an older pair vendored into it. */
  const behind = async (): Promise<string> => {
    const project = await makeProject();

    await refreshVendor(project, fakeVendor('v0+old'));

    return project;
  };

  it('says nothing about a project that is already current', async () => {
    const project = await makeProject();
    await refreshVendor(project, fakeVendor());
    const host = recorder();

    await offerVendorRefresh(host, fakeVendor(), [project]);

    expect(host.asked).toEqual([]);
  });

  it('asks before rewriting anything, and then does', async () => {
    const project = await behind();
    const host = recorder();

    await offerVendorRefresh(host, fakeVendor(), [project]);

    expect(host.asked).toHaveLength(1);
    expect(vendorState(project, fakeVendor())).toBe('current');
  });

  it('leaves the project alone when the answer is no', async () => {
    const project = await behind();
    const host = recorder({ accept: false });

    await offerVendorRefresh(host, fakeVendor(), [project]);

    expect(vendorState(project, fakeVendor())).toBe('outdated');
  });

  /**
   * A project scaffolded before any extension was
   * installed has no server at all — which is the
   * case core's own note in the empty slot tells its
   * owner to fix by installing one and reopening.
   */
  it('offers for a project that was never vendored into', async () => {
    const project = await makeProject();
    const host = recorder();

    await offerVendorRefresh(host, fakeVendor(), [project]);

    expect(host.asked).toHaveLength(1);
    expect(vendorState(project, fakeVendor())).toBe('current');
  });

  it('asks nothing in a window nobody trusts', async () => {
    const host = recorder({ trusted: false });

    await offerVendorRefresh(host, fakeVendor(), [await behind()]);

    expect(host.asked).toEqual([]);
  });

  /**
   * This runs while the extension is coming up. A
   * package built without its assets is broken, but
   * the canvas would still have drawn — so the
   * failure has to be a sentence rather than an
   * extension that does not activate.
   */
  it('says so rather than throwing when the assets are missing', async () => {
    const host = recorder();
    const broken = shippedVendor(scratchDir('mboss-empty-'));

    await expect(
      offerVendorRefresh(host, broken, [await makeProject()]),
    ).resolves.toBeUndefined();

    expect(host.errors).toHaveLength(1);
    expect(host.asked).toEqual([]);
  });

  it('asks once for however many projects are behind', async () => {
    const host = recorder();
    const projects = [await behind(), await behind()];

    await offerVendorRefresh(host, fakeVendor(), projects);

    expect(host.asked).toHaveLength(1);
    for (const project of projects) {
      expect(vendorState(project, fakeVendor())).toBe('current');
    }
  });
});

/**
 * The half no unit test can reach: does the code
 * that reads core's scaffold templates still find
 * them after bundling?
 *
 * Core reads its runtime tree off disk with
 * `import.meta.dirname`, which in a CommonJS bundle
 * is wherever that bundle sits. Every spec above
 * runs from the source tree, where the templates
 * are in their original place and the question
 * never arises. So this one takes the extension
 * that actually ships, puts it somewhere with
 * nothing else in it, and creates a project through
 * the registered command — which is the only
 * arrangement in which a missing asset copy is
 * visible before an installed extension fails in
 * front of a user.
 */
describe('the shipped extension, creating a project', () => {
  let created: string[];

  beforeAll(async () => {
    const root = scratchDir('mboss-shipped-');
    await buildExtension(join(root, 'dist'));

    const parent = join(root, 'projects');
    mkdirSync(parent, { recursive: true });

    const driver = join(root, 'create.cjs');
    writeFileSync(driver, DRIVER(parent), 'utf8');
    const said = execFileSync(process.execPath, [driver], {
      cwd: root,
      encoding: 'utf8',
    });

    // The driver says so when the command's promise
    // settles, so a run that ended early cannot
    // look like a run that finished.
    expect(said.trim()).toBe('created');

    created = listing(join(parent, 'shipped')).sort();
  });

  it('reads the templates that shipped beside it', () => {
    expect(
      created.filter((path) => path.startsWith('src/app/')).length,
    ).toBeGreaterThan(0);
    expect(created).toContain('src/workflows/index.ts');
  });

  it('copies out the control plane it shipped', () => {
    expect(created).toContain('.mboss/mcp/server.js');
    expect(created).toContain('.mboss/mcp/VERSION');
    expect(created).toContain('.mboss/skills/mboss/SKILL.md');
    expect(created).toContain('.claude/skills/mboss/SKILL.md');
  });
});

/**
 * A stand-in extension host: enough of the editor
 * for the extension to activate, and enough of its
 * dialogs to answer the two questions the command
 * asks.
 */
const DRIVER = (parent: string): string =>
  [
    "const Module = require('node:module');",
    'const load = Module._load;',
    'const noop = () => ({ dispose() {} });',
    'const handlers = new Map();',
    'const vscode = {',
    '  l10n: { t: (message, ...args) =>',
    '    String(message).replace(/\\{(\\d+)\\}/g, (whole, i) =>',
    '      args[Number(i)] === undefined ? whole : String(args[Number(i)])) },',
    '  StatusBarAlignment: { Left: 1, Right: 2 },',
    '  ProgressLocation: { Notification: 15 },',
    '  Uri: {',
    '    file: (path) => ({ scheme: "file", path, fsPath: path }),',
    '    joinPath: (base, ...parts) => ({',
    '      path: [base.path, ...parts].join("/"),',
    '    }),',
    '  },',
    '  commands: {',
    '    registerCommand: (id, handler) => {',
    '      handlers.set(id, handler);',
    '      return { dispose() {} };',
    '    },',
    '    executeCommand: async () => {},',
    '  },',
    '  window: {',
    '    createStatusBarItem: () => ({ show() {}, dispose() {} }),',
    '    registerCustomEditorProvider: noop,',
    '    registerWebviewViewProvider: noop,',
    '    showInformationMessage: async () => undefined,',
    // The command reports a refusal rather than
    // throwing one, so this is where a project that
    // was not created has to become a failed run.
    '    showErrorMessage: async (message) => {',
    '      console.error(message);',
    '      process.exit(1);',
    '    },',
    '    showOpenDialog: async () =>',
    `      [vscode.Uri.file(${JSON.stringify(parent)})],`,
    '    showInputBox: async () => "shipped",',
    '    withProgress: async (_options, work) => await work({ report() {} }),',
    '  },',
    '  workspace: {',
    '    workspaceFolders: undefined,',
    '    isTrusted: true,',
    '    onDidGrantWorkspaceTrust: noop,',
    '    onDidChangeConfiguration: noop,',
    '    onDidChangeWorkspaceFolders: noop,',
    '    onDidSaveTextDocument: noop,',
    '    onDidChangeTextDocument: noop,',
    '    getConfiguration: () => ({ get: () => undefined }),',
    '    createFileSystemWatcher: () => ({',
    '      onDidCreate() {}, onDidChange() {}, onDidDelete() {}, dispose() {},',
    '    }),',
    '  },',
    '  languages: {',
    '    createDiagnosticCollection: () => ({',
    '      clear() {}, set() {}, dispose() {},',
    '    }),',
    '  },',
    '  RelativePattern: class {},',
    '  Diagnostic: class {},',
    '  DiagnosticSeverity: { Error: 0, Warning: 1 },',
    '  Position: class {},',
    '  Range: class {},',
    '  WorkspaceEdit: class {},',
    '};',
    'Module._load = function (request, parentModule, isMain) {',
    "  if (request === 'vscode') return vscode;",
    '  return load.call(this, request, parentModule, isMain);',
    '};',
    "const extension = require('./dist/extension.cjs');",
    'extension.activate({',
    '  subscriptions: [],',
    '  extensionUri: vscode.Uri.file(process.cwd()),',
    '  workspaceState: { get: () => undefined, update: async () => {} },',
    '});',
    "handlers.get('mboss.newProject')().then(",
    "  () => console.log('created'),",
    '  (error) => {',
    '    console.error(error);',
    '    process.exit(1);',
    '  },',
    ');',
  ].join('\n');
