/**
 * Whether this start may ask GitHub, and nothing else.
 *
 * Everything the answer is made of needs a packaged build to see at all — an
 * installed app, a stick, an environment, a preference in someone's profile —
 * so the answer itself is a function of four plain values with nothing
 * imported above it, which a test can simply ask.
 *
 * The shell's own updater is the half of the update check that downloads about
 * a hundred megabytes and changes the version on disk, so "not now" has to
 * reach it too, by whichever of the four says so.
 *
 * @param {object} conditions
 * @param {boolean} conditions.isPackaged an installed build, rather than the repository.
 * @param {boolean} conditions.portable the one .exe on a stick.
 * @param {Record<string, string | undefined>} [conditions.env] the process environment.
 * @param {boolean} [conditions.setting] Preferences → Advanced, as the app reports it.
 */
export function shouldCheck({ isPackaged, portable, env = {}, setting }) {
  // A copy running from the repository upgrades with `git pull`, and there is
  // no installer for electron-updater to find in the first place.
  if (!isPackaged) return false;

  // The portable build installs nothing and is not installed: it is one .exe
  // on a stick, beside the stories. electron-updater does not know that and
  // would download the installer and run it on quit, leaving an installed
  // Lamplit with an empty profile while the stick stayed as it was. The pill
  // from /api/updates still tells a portable reader there is a new version.
  if (portable) return false;

  // The same switch the server's own checker reads, so one line in the
  // environment answers for both halves of the same question.
  if (env['LAMPLIT_UPDATE_CHECK'] === '0') return false;

  // Preferences → Advanced. Off means the request does not happen, rather than
  // happening and being ignored, which is what the app promises in as many
  // words. Unsaid is the app's own default, which is on.
  return setting !== false;
}

/**
 * Checked once, when the page says it may, against the same GitHub release the
 * installer came from. Best effort by design: a machine that is offline, or a
 * build that was never published, must not produce a dialog about it.
 *
 * The four conditions are `shouldCheck` above, which is where they are worth
 * reading; this is the half that downloads a hundred megabytes, so it is
 * behind them and does nothing at all when any one of them says not now.
 *
 * `import` rather than a top-level one: electron-updater is a dependency of
 * the packaged shell only, and a repository checkout that never asks must not
 * fail to start for want of it.
 *
 * @param {Parameters<typeof shouldCheck>[0]} conditions
 * @param {(message: string) => void} [log]
 */
export async function checkForUpdates(conditions, log = (message) => console.warn(message)) {
  if (!shouldCheck(conditions)) return false;
  try {
    // Through the default export, not a named one. `electron-updater` is
    // CommonJS and hangs `autoUpdater` off `exports` with a
    // `Object.defineProperty` getter (out/main.js), which is exactly the shape
    // cjs-module-lexer cannot see — so `import('electron-updater')` publishes
    // no such named export and destructuring one gives `undefined`. It threw
    // on the next line, was caught below, and every launch of an installed
    // copy logged "Cannot set properties of undefined" instead of checking.
    // `default` is the whole `module.exports`, where the getter still works.
    const { default: updater } = await import('electron-updater');
    const autoUpdater = updater.autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.on('error', (error) => log(`update check failed: ${error.message}`));
    await autoUpdater.checkForUpdatesAndNotify();
    return true;
  } catch (error) {
    log(`update check failed: ${error.message}`);
    return false;
  }
}
