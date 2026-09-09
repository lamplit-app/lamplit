/**
 * The menu bar, as a template.
 *
 * A template and not a `Menu`, so that nothing here imports Electron and a
 * test can read what the bar says: which items are on it, in which order, and
 * that the version line is the one the server made rather than a second
 * rendering of the same stamp. `main.mjs` hands the result to
 * `Menu.buildFromTemplate`, which is the one line that needs Electron.
 */

export const WEBSITE = 'https://lamplit-app.github.io/lamplit/';
export const REPOSITORY = 'https://github.com/lamplit-app/lamplit';

/**
 * @param {object} what
 * @param {string} what.version         the line the server made of the stamp, ready to show
 * @param {() => unknown} what.openDataFolder
 * @param {(url: string) => unknown} what.openExternal
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
export function menuTemplate({ version, openDataFolder, openExternal }) {
  return [
    {
      label: 'File',
      submenu: [
        { label: 'Open data folder', click: openDataFolder },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    // Without these six, copy and paste do not work on macOS at all.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Lamplit on the web', click: () => openExternal(WEBSITE) },
        { label: 'Report a problem', click: () => openExternal(`${REPOSITORY}/issues`) },
        { type: 'separator' },
        // The same line the About sheet shows, from the same stamp.
        { label: `Version ${version}`, enabled: false },
      ],
    },
  ];
}
