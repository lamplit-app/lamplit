import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Which build this is, and which one ran here last.
 *
 * `version.json` is written next to the built app by `tools/package.mjs`, so a
 * packaged copy can say more than a version number: the commit it was built
 * from, the CI run that made it, and when. Run from the repository there is no
 * such file, and the answers are worked out here instead — the version from
 * package.json, the SHA from git, `local` for the build.
 *
 * `channel` is deliberately *not* in the file. The zip and the installers are
 * built from the same staged folder on purpose — the same server, the same app,
 * the same dependencies — so a channel written at build time would be a lie in
 * one of them. Whoever starts the server is what knows: the Electron shell says
 * `desktop`, a packaged folder is a `zip`, and the repository is `dev`.
 */

/** Next to the built app, so it is served with it and travels with it. */
export const STAMP_FILE = 'version.json';
/** In the data folder, because that is the thing that survives an upgrade. */
export const RUN_FILE = 'lastRun.json';

const UNKNOWN = {
  version: '0.0.0',
  commit: '',
  builtAt: '',
  build: 'local',
};

/**
 * @typedef {object} BuildInfo
 * @property {string} version   from package.json
 * @property {string} commit    short SHA, or '' when there is no git to ask
 * @property {string} builtAt   ISO date, or '' for a build that never happened
 * @property {string} build     the CI run number, or 'local'
 * @property {string} channel   'desktop' | 'zip' | 'dev'
 */

/**
 * @param {{root: string, publicDir?: string, channel?: string}} where
 * @returns {BuildInfo}
 */
export function readBuildInfo({ root, publicDir, channel } = {}) {
  const stamped = publicDir ? readJson(join(publicDir, STAMP_FILE)) : null;
  if (stamped?.version) {
    return {
      version: String(stamped.version),
      commit: String(stamped.commit ?? ''),
      builtAt: String(stamped.builtAt ?? ''),
      build: String(stamped.build ?? 'local'),
      channel: channel ?? 'zip',
    };
  }
  return {
    ...UNKNOWN,
    version: readVersion(root),
    commit: gitCommit(root),
    channel: channel ?? 'dev',
  };
}

/**
 * The fields `tools/package.mjs` stamps into a build. Kept here so that what
 * writes the file and what reads it cannot drift apart.
 *
 * @param {{version: string, root: string}} what
 * @returns {{version: string, commit: string, builtAt: string, build: string}}
 */
export function buildStamp({ version, root }) {
  return {
    version,
    commit: gitCommit(root),
    builtAt: new Date().toISOString(),
    // Set on every GitHub Actions run, so a CI build is stamped without the
    // workflow having to say anything; a build by hand is honest about it.
    build: process.env['GITHUB_RUN_NUMBER'] ?? 'local',
  };
}

/**
 * Writes down the version that is running, and says which one ran before it.
 *
 * The answer survives a restart: only a *different* version replaces it, so an
 * upgrade stays reported until the app has said it showed the notice. Nothing
 * here throws — a data folder that cannot be written is the caller's problem
 * and not worth failing a start-up over.
 *
 * @param {string} dataDir
 * @param {string} version
 * @returns {Promise<{previousVersion: string | null, upgraded: boolean}>}
 */
export async function recordRun(dataDir, version) {
  const file = join(dataDir, RUN_FILE);
  // This runs before the store has made the folder: a first start has to be
  // able to write down what it is, or the next one would call itself upgraded.
  await mkdir(dataDir, { recursive: true }).catch(() => {});
  const last = await readFile(file, 'utf8').then(parse, () => null);
  const changed = !!last?.version && last.version !== version;
  const previousVersion = changed ? last.version : (last?.previousVersion ?? null);

  const record = { version, previousVersion, at: new Date().toISOString() };
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8').catch(() => {});

  return { previousVersion, upgraded: changed };
}

/**
 * `0.1.0 (build 42 · a1b2c3d)`, or just the version when nothing stamped it.
 *
 * One line, because two places say it out loud and they must not disagree: the
 * server prints it at every start, and the desktop shell puts it in the Help
 * menu beside the same line the About sheet shows.
 *
 * @param {{version: string, build?: string, commit?: string}} build
 * @returns {string}
 */
export function versionLine({ version, build: number, commit }) {
  const detail = [number === 'local' ? '' : `build ${number}`, commit].filter(Boolean).join(' · ');
  return detail ? `${version} (${detail})` : version;
}

// -- the pieces --------------------------------------------------------------

/** package.json, from the packaged root or the repository's. */
function readVersion(root) {
  if (!root) return UNKNOWN.version;
  for (const candidate of [join(root, 'package.json'), join(root, 'server', 'package.json')]) {
    const manifest = readJson(candidate);
    if (manifest?.version) return String(manifest.version);
  }
  return UNKNOWN.version;
}

/**
 * The working tree's commit, short, with a `+` when there is anything
 * uncommitted — a build made from a dirty tree is not the commit it names.
 * Silent when there is no git, no repository, or no git in PATH, which is every
 * packaged copy.
 */
function gitCommit(root) {
  if (!root || !existsSync(join(root, '.git'))) return '';
  const sha = git(root, ['rev-parse', '--short', 'HEAD']);
  if (!sha) return '';
  return git(root, ['status', '--porcelain']) ? `${sha}+` : sha;
}

function git(root, args) {
  try {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 2000 });
    return result.status === 0 ? result.stdout.trim() : '';
  } catch {
    return '';
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
