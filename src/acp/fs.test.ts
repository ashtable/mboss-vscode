import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';
import { editorFs } from '../../test/doubles/vscode.js';

import { editorFiles, readTextFile } from './fs.js';

/**
 * The agent's reads and writes, through the
 * editor.
 *
 * Every one of them goes through `workspace.fs`
 * rather than Node's own filesystem, and that is a
 * deliberate choice with two consequences: an
 * agent's edit shows up in the window the user is
 * looking at instead of underneath it, and a read
 * of a file somebody is part-way through editing
 * returns what is on their screen rather than what
 * was last saved.
 */

const PATH = '/project/lib/twilioChat.ts';

beforeEach(() => editorFs.reset());

describe('writing', () => {
  it('puts the text where the editor keeps files', async () => {
    await editorFiles().write(PATH, 'export const a = 1;\n');

    expect(editorFs.files.get(PATH)).toBe('export const a = 1;\n');
  });

  it('replaces what was there', async () => {
    editorFs.files.set(PATH, 'old\n');

    await editorFiles().write(PATH, 'new\n');

    expect(editorFs.files.get(PATH)).toBe('new\n');
  });
});

describe('removing', () => {
  it('takes the file out of the editor', async () => {
    editorFs.files.set(PATH, 'gone soon\n');

    await editorFiles().remove(PATH);

    expect(editorFs.files.has(PATH)).toBe(false);
  });
});

describe('reading', () => {
  it('returns the file', async () => {
    editorFs.files.set(PATH, 'one\ntwo\n');

    expect(await editorFiles().read(PATH)).toBe('one\ntwo\n');
  });

  /**
   * The agent gets what the person is looking at.
   * Answering from disk while an unsaved buffer
   * sits over it hands the agent a version of the
   * file that no longer exists anywhere, and it
   * then edits from that.
   */
  it('prefers an open document over what was saved', async () => {
    editorFs.files.set(PATH, 'saved\n');
    editorFs.open.set(PATH, 'typed but not saved\n');

    expect(await editorFiles().read(PATH)).toBe('typed but not saved\n');
  });

  it('says so when there is nothing there', async () => {
    await expect(editorFiles().read(PATH)).rejects.toThrow(PATH);
  });
});

describe('reading part of a file', () => {
  const files = {
    read: async () => 'one\ntwo\nthree\nfour\n',
    write: async () => {},
  };

  it('returns the whole file when no window is asked for', async () => {
    expect(await readTextFile(files, { path: PATH })).toBe(
      'one\ntwo\nthree\nfour\n',
    );
  });

  /** Lines are numbered from one, the way an
   *  editor numbers them. */
  it('starts at the line it was given', async () => {
    expect(await readTextFile(files, { path: PATH, line: 3 })).toBe(
      'three\nfour\n',
    );
  });

  it('stops after the number of lines it was given', async () => {
    expect(await readTextFile(files, { path: PATH, limit: 2 })).toBe(
      'one\ntwo\n',
    );
  });

  it('takes a window out of the middle', async () => {
    expect(await readTextFile(files, { path: PATH, line: 2, limit: 2 })).toBe(
      'two\nthree\n',
    );
  });

  /**
   * Newlines are kept where they were rather than
   * re-joined, so a slice of the whole file is the
   * file, byte for byte, trailing newline or no
   * trailing newline.
   */
  it('gives back exactly what it was given', async () => {
    const noNewlineAtEnd = {
      read: async () => 'one\ntwo',
      write: async () => {},
    };

    expect(await readTextFile(noNewlineAtEnd, { path: PATH })).toBe('one\ntwo');
    expect(await readTextFile(noNewlineAtEnd, { path: PATH, line: 2 })).toBe(
      'two',
    );
  });

  it('returns nothing when the window is past the end', async () => {
    expect(await readTextFile(files, { path: PATH, line: 99 })).toBe('');
  });
});

describe('the module’s reach', () => {
  /**
   * The whole point of the decision above is that
   * an agent's edit is an editor edit. One
   * `node:fs` import anywhere in this directory
   * takes that back, silently, for whichever
   * operation reached for it.
   */
  it('never touches the filesystem directly', () => {
    const here = join(import.meta.dirname);
    const offenders = readdirSync(here)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) =>
        /from '(node:fs|fs)(\/promises)?'/.test(
          readFileSync(join(here, name), 'utf8'),
        ),
      );

    expect(offenders).toEqual([]);
  });
});
