import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  REPO_ROOT,
  fileExists,
  packageManifest,
  packageNls,
} from './test-support/repo.js';

/**
 * The contribution manifest, checked as data.
 *
 * VS Code reads `package.json` before any of this
 * repo's code runs, and most of what it can get
 * wrong there fails silently: a view missing its
 * type renders an empty placeholder, an
 * unresolved `%key%` shows the key itself, an
 * undeclared trust posture disables the extension
 * with a notice nobody reading the source would
 * expect. Every assertion below stands for one of
 * those silent failures.
 */

type Command = {
  command: string;
  title: string;
  category?: string;
  icon?: string;
};
type View = { type?: string; id: string; name: string; when?: string };
type Menu = { command: string; when?: string; group?: string };
type CustomEditor = {
  viewType: string;
  displayName: string;
  priority?: string;
  selector: { filenamePattern: string }[];
};

const manifest = packageManifest();
const nls = packageNls();

function contributes(): Record<string, unknown> {
  return manifest.contributes as Record<string, unknown>;
}

/** What a `%key%` placeholder actually shows. */
function resolved(placeholder: string): string | undefined {
  const key = /^%([^%]+)%$/.exec(placeholder)?.[1];
  return key === undefined ? undefined : nls[key];
}

describe('commands', () => {
  const commands = contributes().commands as Command[];
  const menus = contributes().menus as Record<string, Menu[]>;

  /** A command that belongs to one view's title bar
   *  rather than to the palette. */
  const isSideBar = (id: string): boolean =>
    id.startsWith('_') && id.endsWith('#sideBar');

  const palette = commands.filter((entry) => !isSideBar(entry.command));

  it('offers exactly the five the design names', () => {
    expect(palette.map((entry) => entry.command)).toEqual([
      'mboss.newProject',
      'mboss.openRuns',
      'mboss.generateCode',
      'mboss.openAgentSidebar',
      'mboss.chooseCodingAgent',
    ]);
  });

  it('localizes every title', () => {
    for (const entry of commands) {
      expect(entry.title).toMatch(/^%[^%]+%$/);
    }
  });

  /**
   * A command that only means something on one
   * view's title bar is named so that nobody
   * mistakes it for part of the public surface,
   * carries an icon because that is all anyone will
   * ever see of it, and is hidden from the palette
   * on purpose — a palette entry for "refresh the
   * run list" would run with no run list on screen.
   */
  describe('the side-bar commands', () => {
    const hidden = new Set(
      (menus['commandPalette'] ?? [])
        .filter((entry) => entry.when === 'false')
        .map((entry) => entry.command),
    );
    const titled = new Set((menus['view/title'] ?? []).map((e) => e.command));

    it('are named apart from the ones a user can run', () => {
      for (const entry of commands) {
        if (palette.includes(entry)) continue;

        expect(isSideBar(entry.command)).toBe(true);
      }
    });

    it('carry an icon, sit on a view, and stay out of the palette', () => {
      for (const entry of commands) {
        if (palette.includes(entry)) continue;

        expect(entry.icon).toBeTypeOf('string');
        expect(hidden.has(entry.command)).toBe(true);
        expect(titled.has(entry.command)).toBe(true);
      }
    });

    /**
     * A `view/title` entry with no `when` puts the
     * icon on every view in the window, including
     * other extensions'.
     */
    it('say which view they belong to', () => {
      for (const entry of menus['view/title'] ?? []) {
        expect(entry.when).toMatch(/^view == mboss\./);
        expect(entry.group).toBeTypeOf('string');
      }
    });
  });

  /**
   * The palette groups by category, so a command
   * whose category resolved to something else
   * would sit on its own away from its siblings.
   */
  it('files every command under one category', () => {
    for (const entry of commands) {
      expect(resolved(entry.category ?? '')).toBe('mBoss');
    }
  });

  /**
   * The one place the ellipsis is pinned. It is a
   * single U+2026, not three periods: that is what
   * VS Code's own titles use for a command that
   * opens further UI, and an extension asserting
   * one spelling in two repositories has to agree
   * with itself.
   */
  it('shows the titles a user reads in the palette', () => {
    expect(palette.map((entry) => resolved(entry.title))).toEqual([
      'New Project',
      'Open Runs',
      'Generate Code',
      'Open Agent Sidebar',
      'Choose Coding Agent…',
    ]);
  });
});

describe('the activity bar container', () => {
  const containers = contributes().viewsContainers as {
    activitybar: { id: string; title: string; icon: string }[];
  };

  it('is one container the views hang off', () => {
    expect(containers.activitybar.map((entry) => entry.id)).toEqual(['mboss']);
  });

  /**
   * An icon is the one thing a container may not
   * do without, and a path that resolves to
   * nothing is not caught until the extension is
   * loaded.
   */
  it('points at an icon that is on disk', () => {
    for (const entry of containers.activitybar) {
      expect(fileExists(join(REPO_ROOT, entry.icon))).toBe(true);
    }
  });
});

describe('views', () => {
  const views = (contributes().views as Record<string, View[]>).mboss ?? [];

  /**
   * Without this, `resolveWebviewView` never
   * fires. The view renders as an empty
   * placeholder and nothing is logged anywhere —
   * the single most-reported silent failure in
   * this class of extension. Later tasks add views
   * to this container; none of them may skip it.
   */
  it('declares every view a webview', () => {
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      expect(view.type).toBe('webview');
    }
  });

  it('localizes every view name', () => {
    for (const view of views) {
      expect(resolved(view.name)).toBeTypeOf('string');
    }
  });

  /**
   * A webview cannot host a webview view, so
   * "selecting a node swaps the canvas's right
   * panel" is built as two views that take each
   * other's place. Both need a clause and the two
   * have to be opposites: give them both the same
   * one and the container is empty half the time,
   * leave one off and they stack.
   */
  it('swaps the agent and the Inspector on one fact', () => {
    expect(views.map((view) => view.id)).toEqual([
      'mboss.agentSidebar',
      'mboss.nodeInspector',
      'mboss.runs',
    ]);

    expect(views.map((view) => view.when)).toEqual([
      '!mboss.nodeSelected',
      'mboss.nodeSelected',
      undefined,
    ]);
  });

  /**
   * The run list is a third panel beside whichever
   * of the two is showing, not a fourth thing in
   * the swap: a run history is worth reading while
   * a block is selected, and a `when` clause here
   * would hide it for that reason alone.
   */
  it('leaves the run list showing whatever else is', () => {
    expect(
      views.find((view) => view.id === 'mboss.runs')?.when,
    ).toBeUndefined();
  });
});

describe('the workflow canvas editor', () => {
  const editors = contributes().customEditors as CustomEditor[];

  it('claims workflow documents and says how strongly', () => {
    expect(editors).toHaveLength(1);
    expect(editors[0]?.priority).toBe('default');
  });

  /**
   * `**` plus `*.json` would open the canvas over
   * every JSON file in the workspace, including
   * `package.json`. The pattern has to name both
   * the directory a workflow lives in and the
   * compound extension it carries.
   */
  it('claims only workflow documents under a project', () => {
    for (const { filenamePattern } of editors[0]?.selector ?? []) {
      expect(filenamePattern).toContain('.mboss/workflows/');
      expect(filenamePattern.endsWith('.workflow.json')).toBe(true);
    }
  });
});

describe('the agent settings', () => {
  const configuration = contributes().configuration as {
    title: string;
    properties: Record<
      string,
      { type: string; scope?: string; description: string }
    >;
  };

  /**
   * These three ids are a published contract. An
   * end-to-end suite writes them into a workspace
   * to point this extension at a stand-in agent,
   * with no test hook anywhere in the extension —
   * so renaming one breaks a repository that
   * cannot see this file.
   */
  it('contributes the three ids anything driving this extension writes', () => {
    expect(Object.keys(configuration.properties)).toEqual([
      'mboss.agent.id',
      'mboss.agent.command',
      'mboss.agent.args',
    ]);
  });

  /**
   * A command and a list of arguments, not one
   * string to be split later: which agent runs
   * here is a fact about this project, and an
   * argument with a space in it has to survive
   * being written down.
   */
  it('takes the arguments as a list, per folder', () => {
    expect(configuration.properties['mboss.agent.command']?.type).toBe(
      'string',
    );
    expect(configuration.properties['mboss.agent.args']?.type).toBe('array');

    for (const property of Object.values(configuration.properties)) {
      expect(property.scope).toBe('resource');
    }
  });

  it('localizes every description', () => {
    expect(resolved(configuration.title)).toBe('mBoss');

    for (const property of Object.values(configuration.properties)) {
      expect(resolved(property.description)).toBeTypeOf('string');
    }
  });
});

describe('workspace trust', () => {
  const capabilities = manifest.capabilities as {
    untrustedWorkspaces?: { supported?: unknown; description?: string };
  };

  /**
   * An extension that declares nothing is treated
   * as unsupported and disabled with a notice, so
   * saying nothing is a posture chosen by
   * accident. This asserts the choice was made,
   * whichever way it went.
   */
  it('declares a posture rather than defaulting into one', () => {
    const trust = capabilities.untrustedWorkspaces;

    expect(trust).toBeDefined();
    expect([true, false, 'limited']).toContain(trust?.supported);
  });

  /** VS Code shows this to the user; a missing one
   *  reads as an unexplained restriction. */
  it('explains any restriction it imposes', () => {
    const trust = capabilities.untrustedWorkspaces;

    if (trust?.supported !== true) {
      expect(resolved(trust?.description ?? '')).toBeTypeOf('string');
    }
  });
});

describe('activation', () => {
  /**
   * Commands, views and custom editors declared in
   * the manifest activate the extension on their
   * own, so an empty list is a complete answer.
   * `"*"` is not: it wakes the extension in every
   * window whether or not there is anything for it
   * to do.
   */
  it('leaves activation to the contributions', () => {
    expect(manifest.activationEvents).toEqual([]);
  });
});

describe('the API version', () => {
  /**
   * `engines.vscode` is what a user's editor
   * checks before installing; `@types/vscode` is
   * what the compiler checks the source against. A
   * gap between them compiles here and fails
   * there.
   */
  it('type-checks against the API version it asks for', () => {
    const devDependencies = manifest.devDependencies as Record<string, string>;
    const engines = manifest.engines as Record<string, string>;

    expect(engines.vscode).toBe(devDependencies['@types/vscode']);
  });
});
