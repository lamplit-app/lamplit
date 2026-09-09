import { parseArgs } from 'node:util';

/**
 * What the desktop build decides, worked out in one place so that a
 * `node:test` can read it. `tools/desktop.mjs` is a script with effects at the
 * top of it and cannot be imported to be asked.
 */

/**
 * The three flags, through `node:util`'s reader rather than a loop of `if`s —
 * which is what every parser in this repository now uses, so that `--dist=1`,
 * `--` and a misspelt flag all behave the same wherever they are typed.
 *
 * Throws rather than exiting, so the script says it in its own voice and a
 * test can ask what a pair of contradictory flags does.
 *
 * @param {string[]} argv
 * @returns {{mode: 'run' | 'stage' | 'dist', publish: boolean}}
 */
export function parseArguments(argv) {
  let flags;
  try {
    ({ values: flags } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        dist: { type: 'boolean', default: false },
        'stage-only': { type: 'boolean', default: false },
        publish: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    throw new Error(
      `${String(error.message).split('. ')[0]}. Expected --dist, --stage-only or --publish.`,
      { cause: error },
    );
  }
  if (flags.dist && flags['stage-only']) {
    throw new Error('--dist and --stage-only ask for opposite things');
  }
  const mode = flags.dist ? 'dist' : flags['stage-only'] ? 'stage' : 'run';
  if (flags.publish && mode !== 'dist') {
    throw new Error('--publish only means something with --dist');
  }
  return { mode, publish: flags.publish };
}

/**
 * `--config.extraMetadata.version` is what makes the installers, `latest.yml`,
 * `app.getVersion()` and the release tag electron-publish looks for say the
 * version that was actually tagged.
 *
 * Without it electron-builder reads `electron/package.json`, which `npm version`
 * never touches: every release after the first would be built as 0.1.0, uploaded
 * to the already-published v0.1.0 release (or, finding it published, to nothing
 * at all, with an exit code of zero), and would tell every installed copy that
 * the newest version is the one it already has.
 */
export function builderArgs({ version, publish }) {
  return [
    'electron-builder',
    '--config',
    'electron-builder.yml',
    `--config.extraMetadata.version=${version}`,
    '--publish',
    publish ? 'always' : 'never',
  ];
}
