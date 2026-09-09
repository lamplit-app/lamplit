/**
 * How the shell says it could not start.
 *
 * A packaged app has no console anyone is watching, and a launcher that
 * appears to do nothing is the worst way to say something went wrong. From the
 * repository the console is exactly where somebody is looking, so a box there
 * would be in the way of the stack trace that answers the question.
 *
 * Both of those are decisions rather than plumbing, so `dialog` and `exit`
 * come in as arguments and a test can ask which one this was.
 *
 * @param {object} what
 * @param {unknown} what.error
 * @param {boolean} what.isPackaged
 * @param {import('electron').Dialog} what.dialog
 * @param {(code: number) => unknown} what.exit
 * @param {import('electron').BrowserWindow | null} [what.window]
 * @param {(message: string) => void} [what.log]
 */
export function saySoAndStop({
  error,
  isPackaged,
  dialog,
  exit,
  window = null,
  log = console.error,
}) {
  log(`Lamplit could not start: ${error?.stack ?? error?.message ?? String(error)}`);
  if (isPackaged) {
    const said = String(error?.message ?? error);
    // Parented to the window when there is one — which, since the window now
    // opens before anything that can fail, there almost always is. A box with
    // no parent is a box that can end up behind the very window it is about.
    if (window && !window.isDestroyed()) {
      dialog.showMessageBoxSync(window, {
        type: 'error',
        title: 'Lamplit could not start',
        message: 'Lamplit could not start',
        detail: said,
      });
    } else {
      dialog.showErrorBox('Lamplit could not start', said);
    }
  }
  exit(1);
}
