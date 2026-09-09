import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtApp } from '../server/src/cli.js';
import { builderArgs, parseArguments } from './lib/desktop-build.mjs';
import { rootVersion, script } from './lib/script.mjs';

/**
 * The desktop build, in three modes.
 *
 *   npm run desktop            build the app if needed, then open the window
 *   npm run desktop:stage      stage the folder the installers wrap, and stop
 *   npm run desktop:dist       stage, then build installers for this OS
 *
 * `--publish` on the last of those uploads them to the draft release for the
 * tag being built, which is the only thing the release workflow does that a
 * person running it here would not.
 *
 * Staging goes through `tools/package.mjs`, which is the one place that decides
 * what ships. The Electron shell is put around the result rather than beside
 * it: `electron/electron-builder.yml` copies that folder in whole, so the
 * desktop app and the zip are demonstrably the same server, the same built app
 * and the same dependencies.
 *
 * Development skips the staging altogether — `electron/main.mjs` reads the
 * repository directly when it is not packaged, so a change to the app needs
 * `npm run build` and a reload, not a rebuild of anything here.
 */

const { step, fail, run } = script('desktop');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON_DIR = join(ROOT, 'electron');
const STAGE_DIR = join(ROOT, 'build', 'desktop-stage');

const options = readOptions(process.argv.slice(2));

if (options.mode === 'run') {
  if (!existsSync(join(builtApp(ROOT), 'index.html'))) {
    step('the app has not been built yet');
    run('npm', ['run', 'build', '-w', 'app'], { cwd: ROOT });
  }
  step('opening the window (the repository, not a packaged build)');
  run('npx', ['electron', '.'], { cwd: ELECTRON_DIR });
} else {
  step(`staging into ${STAGE_DIR}`);
  // `process.execPath` and no shell — which `run` works out from the command
  // itself: cmd.exe would split the path to node.exe, and the path to this
  // repository, on any space either of them contains.
  run(process.execPath, [join(ROOT, 'tools', 'package.mjs'), '--stage', STAGE_DIR, '--no-zip'], {
    cwd: ROOT,
  });

  if (options.mode === 'dist') {
    const version = rootVersion(ROOT);
    step(
      options.publish
        ? `building installers for ${version} and publishing them`
        : `building installers for ${version}`,
    );
    run('npx', builderArgs({ version, publish: options.publish }), { cwd: ELECTRON_DIR });
    step('done');
    console.log(`   installers  ${join(ROOT, 'build', 'desktop')}`);
  } else {
    step('done');
    console.log(`   staged      ${STAGE_DIR}`);
  }
}

/** A throw from the option reader is one line here, not a stack. */
function readOptions(argv) {
  try {
    return parseArguments(argv);
  } catch (error) {
    fail(error.message);
  }
}
