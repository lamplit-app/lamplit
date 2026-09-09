import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REPOSITORY, WEBSITE, menuTemplate } from '../../electron/menu.mjs';

/**
 * The menu bar. A template rather than a `Menu`, which is what makes this file
 * possible: nothing in `menu.mjs` imports Electron, so what the bar says can
 * be read here instead of clicked in a window nobody is watching.
 */

function template(clicks = {}) {
  return menuTemplate({
    version: '0.1.0 (build 42 · a1b2c3d)',
    openDataFolder: clicks.openDataFolder ?? (() => {}),
    openExternal: clicks.openExternal ?? (() => {}),
  });
}

const labels = (menu) => menu.map((item) => item.label);
const submenu = (menu, label) => menu.find((item) => item.label === label).submenu;
const roles = (items) => items.map((item) => item.role).filter(Boolean);

describe('the menu bar', () => {
  it('is the four menus, in the order a window puts them', () => {
    assert.deepEqual(labels(template()), ['File', 'Edit', 'View', 'Help']);
  });

  it('keeps the six edit roles, without which copy and paste do not work on macOS', () => {
    // Not decoration: on macOS the keyboard shortcuts are wired to these
    // roles, and a window without them cannot paste into the composer at all.
    assert.deepEqual(roles(submenu(template(), 'Edit')), [
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'selectAll',
    ]);
  });

  it('offers the one thing the shell does that the web app cannot', () => {
    let opened = 0;
    const menu = template({ openDataFolder: () => (opened += 1) });
    const item = submenu(menu, 'File').find((entry) => entry.label === 'Open data folder');
    item.click();
    assert.equal(opened, 1);
  });

  it('shows the version line the server made, and does not let anyone click it', () => {
    const help = submenu(template(), 'Help');
    const version = help.find((item) => String(item.label).startsWith('Version'));
    assert.equal(version.label, 'Version 0.1.0 (build 42 · a1b2c3d)');
    // The same line the About sheet shows, from the same stamp — and a label,
    // not an action.
    assert.equal(version.enabled, false);
    assert.equal(version.click, undefined);
  });

  it('sends the two Help links to the browser, not to the window', () => {
    // A window that navigated to the website would be a window with no way
    // back to the app; `main.mjs` hands `openExternal` in for exactly that.
    const went = [];
    const help = submenu(template({ openExternal: (url) => went.push(url) }), 'Help');
    for (const item of help) item.click?.();
    assert.deepEqual(went, [WEBSITE, `${REPOSITORY}/issues`]);
  });

  it('names the two addresses once, where a release can check them', () => {
    assert.match(WEBSITE, /^https:\/\/lamplit-app\.github\.io\//);
    assert.match(REPOSITORY, /^https:\/\/github\.com\/lamplit-app\/lamplit$/);
  });

  it('has a quit item, because a window is not the only way out', () => {
    assert.ok(roles(submenu(template(), 'File')).includes('quit'));
  });
});
