/**
 * Whether a newer Lamplit has been published, asked once per run.
 *
 * The server asks rather than the browser, for two reasons. The browser talks
 * to exactly one host it was told about — the model endpoint — and it should
 * stay that way; and the desktop shell, which already updates itself through
 * electron-updater, gets the same answer from the same place rather than a
 * second opinion. The request carries nothing but what any HTTP request
 * carries: a URL, a user agent, and an IP.
 *
 * One request per run, memoised on the promise, so ten browser tabs cost one
 * call. Failure is not retried: it is one line in the log, an empty answer to
 * the app, and the next start tries again.
 */

import { isNewer } from '../../wire/contract.mjs';
import { defaultLog } from './log.js';

const RELEASES_URL = 'https://api.github.com/repos/lamplit-app/lamplit/releases';
const TIMEOUT = 5000;
/** GitHub refuses a request without one, and this says who is asking. */
const USER_AGENT = 'lamplit-update-check';

/**
 * The three shapes this file builds are `wire/contract.mjs`'s: the app reads
 * them off the same file, so a field added to a release is added once.
 *
 * @typedef {import('../../wire/contract.mjs').Release} Release
 * @typedef {import('../../wire/contract.mjs').UpdateReport} UpdateReport
 */

/**
 * @param {{
 *   version: string,
 *   enabled?: boolean,
 *   url?: string,
 *   fetchImpl?: typeof fetch,
 *   log?: (message: string) => void,
 * }} options
 */
export function createUpdateChecker({
  version,
  enabled = true,
  url = RELEASES_URL,
  fetchImpl = fetch,
  log = defaultLog,
} = {}) {
  /** @type {Promise<UpdateReport> | null} */
  let asked = null;

  const empty = (checked) => ({
    ok: true,
    enabled,
    checked,
    version,
    latest: null,
    newer: [],
    releases: [],
  });

  async function ask() {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': USER_AGENT,
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!response.ok) {
        log(`update check: GitHub answered ${response.status}`);
        return empty(true);
      }
      const body = await response.json();
      const releases = published(body);
      return {
        ...empty(true),
        latest: releases[0] ?? null,
        newer: releases.filter((release) => isNewer(release.version, version)),
        releases,
      };
    } catch (error) {
      // Offline, blocked, slow, or rate-limited: all the same to the app.
      log(`update check: ${error.message}`);
      return empty(true);
    }
  }

  return {
    enabled,
    /** @returns {Promise<UpdateReport>} */
    check() {
      if (!enabled) return Promise.resolve(empty(false));
      asked ??= ask();
      return asked;
    },
  };
}

/** Drafts and pre-releases are not something to point anyone at. */
function published(body) {
  if (!Array.isArray(body)) return [];
  return body
    .filter((raw) => raw && !raw.draft && !raw.prerelease && raw.tag_name)
    .map(toRelease)
    .filter((release) => release.version)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function toRelease(raw) {
  const tag = String(raw.tag_name ?? '');
  return {
    tag,
    version: tag.replace(/^v/i, ''),
    name: String(raw.name || tag),
    publishedAt: String(raw.published_at ?? ''),
    body: String(raw.body ?? ''),
    url: String(raw.html_url ?? ''),
    assets: (Array.isArray(raw.assets) ? raw.assets : [])
      .filter((asset) => asset?.browser_download_url)
      .map((asset) => ({
        name: String(asset.name ?? ''),
        url: String(asset.browser_download_url),
        size: Number(asset.size ?? 0),
      })),
  };
}

export { RELEASES_URL, isNewer };
