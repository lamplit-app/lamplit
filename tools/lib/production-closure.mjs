import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { readJson } from './script.mjs';

/**
 * Every package the server needs at runtime, resolved the way Node resolves
 * them rather than by asking npm — this works offline and copies exactly the
 * versions that were tested.
 *
 * What comes back is a map of where each package has to sit under the staged
 * folder to where it is now, so that the copy resolves the same way the
 * repository does. npm puts most packages at the top, `<root>/node_modules/x`,
 * but not all of them: when another workspace pins an incompatible version of
 * something the server also uses, the server's copy goes to
 * `<root>/server/node_modules/x` instead, and one placed at the top of the
 * stage would be the wrong version or, for a package no other workspace wants,
 * missing altogether. Hence the relative place rather than the name.
 *
 * A package nested inside one that is already being copied — a dependency
 * pinned to its own version of something — travels inside its parent's folder
 * and is not listed separately.
 *
 * This lives here rather than in tools/package.mjs so that tools/test can run
 * it over a tree it made itself; the mistake it exists to prevent is silent at
 * build time and fatal on the reader's machine.
 */
export function productionClosure({ root, from }) {
  /** Absolute package folder → the name it was required as. */
  const found = new Map();
  const visited = new Set();

  const visit = (dir) => {
    if (visited.has(dir)) return;
    visited.add(dir);
    const manifest = readJson(join(dir, 'package.json'));
    const required = Object.keys(manifest.dependencies ?? {});
    const optional = Object.keys(manifest.optionalDependencies ?? {});
    for (const dependency of [...required, ...optional]) {
      const target = resolvePackage(dependency, dir);
      if (!target) {
        if (optional.includes(dependency)) continue;
        throw new Error(
          `${manifest.name} needs ${dependency}, which is not installed. Run npm install.`,
        );
      }
      if (!found.has(target)) found.set(target, dependency);
      visit(target);
    }
  };

  visit(from);

  const folders = [...found.keys()];
  const staged = new Map();
  for (const [dir, name] of found) {
    if (folders.some((other) => dir.startsWith(other + sep))) continue;
    staged.set(placeUnder(root, dir, name), dir);
  }
  return new Map([...staged].sort(([a], [b]) => a.localeCompare(b)));
}

/** node_modules lookup: this folder's, then every folder above it. */
export function resolvePackage(dependency, from) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', ...dependency.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Where a package resolved at `dir` has to be written for the stage to resolve
 * it the same way: the place it holds in the repository, kept.
 *
 * The exception is a package resolved above the repository altogether — the
 * repository itself unpacked inside someone else's node_modules — which has no
 * place under the root to keep. The top of the stage is visible from
 * everywhere inside it, so that is where it goes.
 */
function placeUnder(root, dir, name) {
  const within = relative(root, dir);
  if (!within || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) {
    return `node_modules/${name}`;
  }
  return within.split(sep).join('/');
}
