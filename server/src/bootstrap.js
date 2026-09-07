import { createServer } from 'node:http';
import { createApp } from './app.js';
import { backupOnStartup } from './backup.js';
import { DEFAULT_PORT, listenWalking } from './ports.js';
import { createSharing, localAddresses } from './share.js';
import { createUpdateChecker } from './updates.js';
import { readBuildInfo, recordRun, versionLine } from './version.js';

/**
 * Starting Lamplit, once, for both of the things that start it.
 *
 * There are two front doors — `start.bat` running `index.js`, and the Electron
 * shell — and behind them there is one app. Everything between "a folder of
 * documents" and "a URL to open it at" is here rather than in each of them:
 * which build this is, what ran here last, the update checker, sharing, the
 * Express app, the store, the listener, the daily backup. The shell used to
 * re-implement the sequence through six imports of this folder's private
 * modules, and the two orders had already drifted apart.
 *
 * What is *not* here is everything the two doors legitimately disagree about:
 * where the documents live, which port to ask for, and what to say out loud
 * once it is up. A console the reader is watching and a window with a menu bar
 * are different answers to that last one, and neither belongs in here.
 *
 * This is also the only module either door needs to import. Anything the
 * caller still wants by name — the default port, the machine's addresses, the
 * version line — comes back out through here.
 */

export { DEFAULT_PORT, localAddresses, versionLine };

/**
 * @typedef {object} Started
 * @property {import('./version.js').BuildInfo} build   which build this is
 * @property {string | null} previousVersion            the version that ran here last
 * @property {boolean} upgraded                         whether that was a different one
 * @property {object} updates                           the update checker the API serves
 * @property {object} sharing                           the second listener, whoever owns it
 * @property {{share: boolean, error: string}} shared   whether it opened, and why not
 * @property {import('express').Express} app
 * @property {object} store
 * @property {import('node:http').Server} server        listening already
 * @property {string} url                               where to point a window or a browser
 * @property {Promise<string | null>} backup            the archive taken, or null; never rejects
 */

/**
 * @param {object} options
 * @param {string} options.root        the folder the app was unzipped or cloned into
 * @param {string} options.dataDir     the documents
 * @param {string} options.backupsDir  where the daily archive goes
 * @param {string} options.publicDir   the built app, or somewhere it is not
 * @param {string} [options.channel]   'desktop' | 'zip' | 'dev'; see version.js
 * @param {string} [options.host]      what to bind; '0.0.0.0' is every interface
 * @param {number} [options.port]      what to ask for; 0 takes whatever is free
 * @param {boolean} [options.devCors]  whether another page on this machine may call the API
 * @returns {Promise<Started>}
 */
export async function bootstrap({
  root,
  dataDir,
  backupsDir,
  publicDir,
  channel,
  host = '127.0.0.1',
  port = DEFAULT_PORT,
  devCors = false,
  // The three switches both doors read the same way, so they are read once.
  // Nothing is asked of GitHub until the app calls /api/updates, and the app
  // only calls it when the reader has left the check on; this is the same
  // switch from the environment, for a copy started by a script.
  updateCheck = process.env['LAMPLIT_UPDATE_CHECK'] !== '0',
  backup = process.env['LAMPLIT_BACKUP'] !== '0',
  sharePort = Number(process.env['LAMPLIT_SHARE_PORT'] ?? DEFAULT_PORT),
  // Every interface, which is the point of sharing. Narrower is for a machine
  // with a reason to offer one adapter, and for this project's own e2e suite.
  shareHost = process.env['LAMPLIT_SHARE_HOST'],
}) {
  // Which build this is: the stamp next to the built app in a packaged copy,
  // package.json and git when running from the repository.
  const build = readBuildInfo({ root, publicDir, channel });

  // What ran here last. A data folder written by an older version is the only
  // signal that an upgrade happened, and the app shows one notice for it.
  const { previousVersion, upgraded } = await recordRun(dataDir, build.version);

  const updates = createUpdateChecker({ version: build.version, enabled: updateCheck });

  // Made before the app because the app registers the routes that read it, and
  // handed the app straight after because it is the app it puts behind the
  // lock. Off until somebody turns it on, or until `server.json` says it is.
  const sharing = createSharing({
    dataDir,
    port: sharePort,
    ...(shareHost ? { host: shareHost } : {}),
  });

  const app = createApp({
    dataDir,
    publicDir,
    build,
    previousVersion,
    updates,
    // A host it was told to bind to is a name it should answer to as well.
    hosts: host === '0.0.0.0' ? [] : [host],
    devCors,
    sharing,
  });
  const store = app.locals['store'];
  sharing.serve(app);

  await store.init();
  const shared = await sharing.init();

  const server = await listenWalking(createServer(app), port, host);

  return {
    build,
    previousVersion,
    upgraded,
    updates,
    sharing,
    shared,
    app,
    store,
    server,
    url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}/`,
    // Not awaited: a zip of the documents takes as long as the documents are
    // big, and nothing about the app waits for it. The failure is said out
    // loud here because both doors said the same thing about it; what to do
    // with the archive's name is the caller's, and it is handed one.
    backup: backup
      ? backupOnStartup(dataDir, backupsDir).catch((error) => {
          console.warn(`backup failed: ${error.message}`);
          return null;
        })
      : Promise.resolve(null),
  };
}
