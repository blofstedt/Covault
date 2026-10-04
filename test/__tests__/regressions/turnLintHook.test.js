import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';

const { dirname, join, resolve } = path;
const project = resolve(import.meta.dirname, '../../..');
const hook = join(project, '.claude/hooks/lint-changed.mjs');
const execute = promisify(execFile);
const scratch = [];

const write = (root, file, content) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
};

const eventInput = (root, event, extra = {}) => ({
  cwd: root,
  hook_event_name: event,
  session_id: 'first-session',
  ...extra,
});

const send = (root, event, extra = {}) => spawnSync(process.execPath, [hook], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  input: JSON.stringify(eventInput(root, event, extra)),
});

const edit = (root, file, sessionId = 'first-session') => send(root, 'PostToolUse', {
  session_id: sessionId,
  tool_name: 'Edit',
  tool_input: { file_path: resolve(root, file) },
});

const repository = (files = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'turn-lint-test-'));
  scratch.push(root);
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  for (const tool of ['eslint', 'prettier']) {
    symlinkSync(join(project, 'node_modules/.bin', tool), join(root, 'node_modules/.bin', tool));
  }
  write(root, 'eslint.config.mjs', `export default [{
    files: ['**/*.js', '**/*.mjs'],
    rules: { semi: ['error', 'always'], 'no-unused-vars': 'error' },
  }];\n`);
  for (const [file, content] of Object.entries(files)) {
    write(root, file, content);
  }
  send(root, 'UserPromptSubmit');
  return root;
};

const read = (root, file) => readFileSync(join(root, file), 'utf8');
const git = (root, ...args) => execFileSync('git', [
  '-c', 'user.name=Hook test',
  '-c', 'user.email=hook@example.invalid',
  '-c', 'commit.gpgsign=false',
  '-c', 'core.hooksPath=/dev/null',
  ...args,
], { cwd: root, encoding: 'utf8' });

const initializeGit = (root) => {
  git(root, 'init', '--quiet');
  git(root, 'add', '*.js');
  git(root, 'commit', '--quiet', '-m', 'Initial fixture');
};

afterEach(() => {
  for (const root of scratch.splice(0)) {
    for (const session_id of ['first-session', 'second-session']) {
      send(root, 'UserPromptSubmit', { session_id });
    }
    rmSync(root, { force: true, recursive: true });
  }
});

describe('Claude turn lint', () => {
  test('fixes several recorded files and leaves unrelated dirty files alone', () => {
    const root = repository({
      'first.js': 'export const first = 1\n',
      'second.js': 'export const second = 2\n',
      'unrelated.js': 'export const unrelated = 3\n',
    });
    edit(root, 'first.js');
    edit(root, 'second.js');
    edit(root, 'first.js');
    expect(send(root, 'Stop').status).toBe(0);
    expect(read(root, 'first.js')).toBe('export const first = 1;\n');
    expect(read(root, 'second.js')).toBe('export const second = 2;\n');
    expect(read(root, 'unrelated.js')).toBe('export const unrelated = 3\n');
  });

  test('keeps different sessions separate in the same checkout', () => {
    const root = repository({ 'first.js': 'export const first = 1\n', 'second.js': 'export const second = 2\n' });
    edit(root, 'first.js');
    edit(root, 'second.js', 'second-session');
    send(root, 'UserPromptSubmit');
    edit(root, 'first.js');
    expect(send(root, 'Stop').status).toBe(0);
    expect(read(root, 'first.js')).toBe('export const first = 1;\n');
    expect(read(root, 'second.js')).toBe('export const second = 2\n');
    expect(send(root, 'Stop', { session_id: 'second-session' }).status).toBe(0);
    expect(read(root, 'second.js')).toBe('export const second = 2;\n');
  });

  test('a new prompt discards the interrupted turn', () => {
    const root = repository({ 'old.js': 'export const old = 1\n', 'current.js': 'export const current = 2\n' });
    edit(root, 'old.js');
    send(root, 'UserPromptSubmit');
    edit(root, 'current.js');
    expect(send(root, 'Stop').status).toBe(0);
    expect(read(root, 'current.js')).toBe('export const current = 2;\n');
    expect(read(root, 'old.js')).toBe('export const old = 1\n');
  });

  test('parallel edit notifications preserve both files', async () => {
    const root = repository({ 'first.js': 'export const first = 1\n', 'second.js': 'export const second = 2\n' });
    await Promise.all(['first.js', 'second.js'].map(async (file) => {
      const input = JSON.stringify(eventInput(root, 'PostToolUse', {
        tool_name: 'Write', tool_input: { file_path: resolve(root, file) },
      }));
      const child = execute(process.execPath, [hook], {
        cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      });
      // execFile's promise exposes the actual child, so each process gets stdin.
      child.child.stdin.end(input);
      await child;
    }));
    expect(send(root, 'Stop').status).toBe(0);
    expect(read(root, 'first.js')).toBe('export const first = 1;\n');
    expect(read(root, 'second.js')).toBe('export const second = 2;\n');
  });

  test('still fixes files committed earlier in the turn', () => {
    const root = repository({ 'first.js': 'export const first = 1;\n' });
    initializeGit(root);
    write(root, 'first.js', 'export const first = 2\n');
    edit(root, 'first.js');
    git(root, 'add', 'first.js');
    git(root, 'commit', '--quiet', '-m', 'Edited during the turn');
    expect(send(root, 'Stop').status).toBe(0);
    expect(read(root, 'first.js')).toBe('export const first = 2;\n');
    expect(git(root, 'show', 'HEAD:first.js')).toBe('export const first = 2\n');
  });

  test('does not add unstaged changes to a partially staged file', () => {
    const root = repository({ 'first.js': 'export const first = 1;\n' });
    initializeGit(root);
    write(root, 'first.js', 'export const first = 2;\n');
    git(root, 'add', 'first.js');
    write(root, 'first.js', 'export const first = 2\nexport const unstaged = 3\n');
    edit(root, 'first.js');
    expect(send(root, 'Stop').status).toBe(0);
    expect(read(root, 'first.js')).toBe('export const first = 2;\nexport const unstaged = 3;\n');
    expect(git(root, 'show', ':first.js')).toBe('export const first = 2;\n');
  });

  test('a Stop continuation checks files changed after a successful batch', () => {
    const root = repository({ 'first.js': 'export const first = 1\n' });
    edit(root, 'first.js');
    expect(send(root, 'Stop').status).toBe(0);
    expect(read(root, 'first.js')).toBe('export const first = 1;\n');
    // Without another edit notification, a background write still changes the fingerprint.
    write(root, 'first.js', 'export const first = 2\n');
    expect(send(root, 'Stop', { stop_hook_active: true }).status).toBe(0);
    expect(read(root, 'first.js')).toBe('export const first = 2;\n');
  });

  test('reports unfixable errors, retries once, and recovers after a repair', () => {
    const root = repository({ 'broken.js': 'const unused = 1;\n' });
    edit(root, 'broken.js');
    const first = send(root, 'Stop');
    expect(first.status).toBe(2);
    expect(first.stderr).toContain('no-unused-vars');
    const retry = send(root, 'Stop', { stop_hook_active: true });
    expect(retry.status).toBe(0);
    expect(JSON.parse(retry.stdout).systemMessage).toBe('Turn lint stopped retrying; files still need linting: broken.js');
    write(root, 'broken.js', 'export const repaired = 2\n');
    expect(send(root, 'Stop', { stop_hook_active: true }).status).toBe(0);
    expect(read(root, 'broken.js')).toBe('export const repaired = 2;\n');
  });

  test('skips an unchanged successful batch but checks new content', () => {
    const root = repository({ 'first.js': 'export const first = 1\n' });
    edit(root, 'first.js');
    expect(send(root, 'Stop').status).toBe(0);
    expect(read(root, 'first.js')).toBe('export const first = 1;\n');
    rmSync(join(root, 'node_modules/.bin/eslint'));
    expect(send(root, 'Stop', { stop_hook_active: true }).status).toBe(0);
    write(root, 'first.js', 'export const first = 2\n');
    const missingTool = send(root, 'Stop', { stop_hook_active: true });
    expect(missingTool.status).toBe(2);
    expect(missingTool.stderr).toContain('ENOENT');
  });

  test('ignores deleted and outside paths without losing a valid edit', () => {
    const root = repository({ 'kept.js': 'export const kept = 1\n', 'deleted.js': 'export const deleted = 2\n' });
    const outside = repository({ 'outside.js': 'export const outside = 3\n' });
    edit(root, 'kept.js');
    edit(root, 'deleted.js');
    edit(root, join(outside, 'outside.js'));
    rmSync(join(root, 'deleted.js'));
    expect(send(root, 'Stop').status).toBe(0);
    expect(read(root, 'kept.js')).toBe('export const kept = 1;\n');
    expect(read(outside, 'outside.js')).toBe('export const outside = 3\n');
  });

});
