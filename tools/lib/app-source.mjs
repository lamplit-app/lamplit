/**
 * Importing the app's TypeScript from a script that is not the app.
 *
 * `tools/probe-providers.mjs` reads the provider table straight out of
 * *app/src/app/core/providers.ts*, because thirty rows copied into a tool are
 * thirty rows to keep in step. Node runs TypeScript on its own from 22.18 on,
 * so the types are not what stands in the way — the specifiers are. Every
 * relative import in the app is written without an extension, `from
 * './project'`, three hundred and seventy-odd times, which is what the bundler
 * wants and what Node's resolver refuses. Loading the table died on the first such
 * import (#79), and had done since the day `providers.ts` gained one.
 *
 * So: a hook that puts the extension back, and does nothing else. It is
 * deliberately narrow — a relative specifier, with no extension of its own,
 * from a file inside `app/src` — so that nothing the calling script imports
 * for itself, Playwright and its hundreds of modules included, is resolved by
 * anything but Node's own rules.
 *
 * Appending `.ts` is the whole answer rather than most of it: every relative
 * specifier under `app/src` names a sibling `.ts` file. There are no directory
 * imports and no barrels, and `import type` is erased before it is ever
 * resolved.
 */

import { registerHooks } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The app's sources, as the prefix every URL under them starts with. */
export const APP_SRC = pathToFileURL(resolve(ROOT, 'app/src') + '/').href;

/**
 * What to hand Node in place of `specifier`. Anything that is not an
 * extensionless relative import from inside the app comes back untouched, so
 * that the answer for every other module is Node's own.
 */
export function appSpecifier(specifier, parentURL) {
  const fromTheApp = parentURL?.startsWith(APP_SRC) ?? false;
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  return fromTheApp && relative && !extname(specifier) ? `${specifier}.ts` : specifier;
}

let hooked = false;

/**
 * Loads one module out of `app/src`, by its path from there — the app's own
 * source, not a build of it, so what the caller reads is what ships.
 *
 * The hook is registered on the first call and left in place: registering is
 * process-wide, and `registerHooks` has no undo worth the trouble of one.
 */
export async function importFromApp(pathFromAppSrc) {
  if (!hooked) {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(appSpecifier(specifier, context.parentURL), context);
        // Say what a `.ts` file is. Left to guess, Node reads *app/package.json*
        // for a `type` that is not there, warns that it had to reparse, and
        // says so on every run of a script whose output is a markdown table.
        return resolved.url.endsWith('.ts')
          ? { ...resolved, format: 'module-typescript' }
          : resolved;
      },
    });
    hooked = true;
  }
  return import(pathToFileURL(resolve(ROOT, 'app/src', pathFromAppSrc)).href);
}
