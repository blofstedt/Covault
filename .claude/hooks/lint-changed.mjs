#!/usr/bin/env node

/**
 * Collect Write/Edit targets per Claude session and lint them in one Stop batch.
 * UserPromptSubmit resets the turn. Separate marker files preserve parallel edits.
 * State survives Stop continuations; unchanged successful files are not rerun.
 * Shell-created edits and interrupted turns still need the normal repository gate.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const isLintableFile = (file) => /\.(?:ts|tsx|js|mjs|cjs)$/.test(file);

const LINT_TIMEOUT_MS = 120_000;
const MAX_FIX_ATTEMPTS = 3;
const defaultStateDirectory = resolve(tmpdir(), 'covault-turn-lint');

const repositoryPath = (file, projectDirectory) => {
  if (typeof file !== 'string' || !file.trim()) {
    return undefined;
  }

  const absoluteFile = resolve(projectDirectory, file);
  const repositoryRelative = relative(projectDirectory, absoluteFile);
  if (
    !repositoryRelative ||
    repositoryRelative === '..' ||
    repositoryRelative.startsWith(`..${sep}`) ||
    isAbsolute(repositoryRelative)
  ) {
    return undefined;
  }

  return repositoryRelative.split(sep).join('/');
};

const turnStatePaths = ({ projectDirectory, sessionId, stateDirectory }) => {
  if (typeof sessionId !== 'string' || !sessionId) {
    return undefined;
  }

  const stateKey = createHash('sha256')
    .update(`${projectDirectory}\0${sessionId}`)
    .digest('hex');
  const turnDirectory = resolve(stateDirectory, stateKey);

  return {
    resultFile: resolve(turnDirectory, 'last-result.json'),
    touchedDirectory: resolve(turnDirectory, 'touched'),
    turnDirectory,
  };
};

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

const writeTurnState = (statePaths, file, value) => {
  mkdirSync(statePaths.turnDirectory, { recursive: true });
  writeFileSync(file, JSON.stringify(value));
};

const fileHash = (file) => {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return undefined;
  }
};

export const clearTurnState = ({
  projectDirectory,
  sessionId,
  stateDirectory = defaultStateDirectory,
}) => {
  const statePaths = turnStatePaths({
    projectDirectory,
    sessionId,
    stateDirectory,
  });
  if (statePaths) {
    rmSync(statePaths.turnDirectory, { force: true, recursive: true });
  }
};

const readTouchedFiles = (statePaths) => {
  try {
    return readdirSync(statePaths.touchedDirectory)
      .map((marker) => readJson(resolve(statePaths.touchedDirectory, marker)))
      .filter((file) => typeof file === 'string');
  } catch {
    return [];
  }
};

export const recordTurnFile = ({
  file,
  projectDirectory,
  sessionId,
  stateDirectory = defaultStateDirectory,
}) => {
  const repositoryRelative = repositoryPath(file, projectDirectory);
  const statePaths = turnStatePaths({
    projectDirectory,
    sessionId,
    stateDirectory,
  });
  if (
    !repositoryRelative ||
    !isLintableFile(repositoryRelative) ||
    !statePaths
  ) {
    return [];
  }

  // PostToolUse fires concurrently for parallel tool calls. One exclusive
  // marker per path avoids the lost updates of a shared read/modify/write file.
  // https://code.claude.com/docs/en/hooks
  mkdirSync(statePaths.touchedDirectory, { recursive: true });
  const marker = createHash('sha256').update(repositoryRelative).digest('hex');
  try {
    writeFileSync(
      resolve(statePaths.touchedDirectory, `${marker}.json`),
      JSON.stringify(repositoryRelative),
      { flag: 'wx' },
    );
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }

  return [repositoryRelative];
};

export const collectTurnFiles = ({
  projectDirectory,
  sessionId,
  stateDirectory = defaultStateDirectory,
}) => {
  const statePaths = turnStatePaths({
    projectDirectory,
    sessionId,
    stateDirectory,
  });
  if (!statePaths) {
    return [];
  }

  // Markers may reference files deleted later in the turn.
  return [...new Set(readTouchedFiles(statePaths))]
    .filter((file) => existsSync(resolve(projectDirectory, file)))
    .sort();
};

const turnFingerprint = (files, projectDirectory) => {
  const fingerprint = createHash('sha256');
  files.forEach((file) => {
    fingerprint.update(file);
    fingerprint.update('\0');
    fingerprint.update(fileHash(resolve(projectDirectory, file)) || 'missing');
    fingerprint.update('\0');
  });
  return fingerprint.digest('hex');
};

export const runTurnLintHook = ({
  environment = process.env,
  input,
  spawn = spawnSync,
  stateDirectory = defaultStateDirectory,
  writeError = (message) => process.stderr.write(message),
  writeOutput = (message) => process.stdout.write(message),
}) => {
  const projectDirectory = resolve(
    environment.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(),
  );
  const sessionId = input.session_id;
  const stateOptions = { projectDirectory, sessionId, stateDirectory };

  if (input.hook_event_name === 'UserPromptSubmit') {
    // Anthropic documents that Stop is skipped on user interrupt. Resetting at
    // the next prompt prevents an abandoned turn's paths leaking into this one.
    // https://code.claude.com/docs/en/hooks#stop
    clearTurnState(stateOptions);
    return 0;
  }

  if (input.hook_event_name === 'PostToolUse') {
    recordTurnFile({
      ...stateOptions,
      file: input.tool_input?.file_path,
    });
    return 0;
  }

  if (input.hook_event_name !== 'Stop') {
    return 0;
  }

  const statePaths = turnStatePaths(stateOptions);
  const files = collectTurnFiles(stateOptions);
  if (!statePaths || files.length === 0) {
    return 0;
  }

  // The pre-run fingerprint is only ever compared against a recorded result.
  const lastResult = readJson(statePaths.resultFile);
  const fingerprint = lastResult
    ? turnFingerprint(files, projectDirectory)
    : undefined;

  // Content that already passed this turn needs no rerun; any write since
  // then (for example from a background task) changes the fingerprint.
  if (lastResult?.ok && lastResult.fingerprint === fingerprint) {
    return 0;
  }

  const attempts = lastResult?.ok ? 0 : (lastResult?.attempts ?? 0);

  const result = spawn(
    resolve(projectDirectory, 'node_modules/.bin/eslint'),
    ['--fix', '--max-warnings=0', '--no-warn-ignored', '--', ...files],
    {
      cwd: projectDirectory,
      encoding: 'utf8',
      timeout: LINT_TIMEOUT_MS,
    },
  );
  // Recomputed after --fix so a next Stop with no further edits matches.
  const fixedFingerprint = turnFingerprint(files, projectDirectory);

  if (result.status === 0) {
    // Turn state outlives a successful batch: a later Stop in the same turn
    // (for example a background-task continuation) must still see this
    // turn's files. UserPromptSubmit owns cleanup.
    writeTurnState(statePaths, statePaths.resultFile, {
      fingerprint: fixedFingerprint,
      ok: true,
    });
    return 0;
  }

  // Anthropic documents stop_hook_active for recursion guarding. An unchanged
  // retry reruns the batch once — a full ESLint pass, but it lets an
  // environment repair succeed — and only a retry that fails again is
  // abandoned, capped so oscillating edits cannot loop indefinitely.
  // https://code.claude.com/docs/en/hooks#stop
  if (
    input.stop_hook_active &&
    lastResult &&
    !lastResult.ok &&
    (lastResult.fingerprint === fingerprint || attempts >= MAX_FIX_ATTEMPTS)
  ) {
    writeOutput(
      JSON.stringify({
        systemMessage: `Turn lint stopped retrying; files still need linting: ${files.join(', ')}`,
      }),
    );
    return 0;
  }

  writeTurnState(statePaths, statePaths.resultFile, {
    attempts: attempts + 1,
    fingerprint: fixedFingerprint,
    ok: false,
  });
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join('\n');
  writeError(`ESLint could not fix files touched this turn:\n${output}`);
  return 2;
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let input;

  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
    process.exitCode = runTurnLintHook({ input });
  } catch (error) {
    process.stderr.write(`Turn lint hook failed: ${error.message}\n`);
    // Bookkeeping must never block a user's next prompt. A Stop exception
    // blocks once so Claude can repair the hook, then yields on the retry
    // rather than blocking every stop while the hook itself is broken.
    process.exitCode =
      input?.hook_event_name === 'Stop' && !input?.stop_hook_active ? 2 : 0;
  }
}
