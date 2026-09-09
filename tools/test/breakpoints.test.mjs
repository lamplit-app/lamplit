import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

/**
 * The two widths the app has to answer in TypeScript as well as in CSS, and
 * the three files that have to agree about them.
 *
 * `breakpoints.scss` declares them; `styles.scss` publishes each as a custom
 * property on `<html>`; `core/layout.ts` reads them back off `<html>` and
 * builds a media query out of what it finds. That chain is how a threshold
 * gets written once — but `layout.ts` also carries a fallback for each, and a
 * fallback is a second copy of the number.
 *
 * Nothing exercises it. In a browser the custom property resolves and the
 * fallback is never reached; in a jsdom spec there is no `matchMedia` at all,
 * so the query the fallback went into is thrown away unread. A fallback that
 * had drifted from the Sass would pass every check the app has and be wrong
 * only on the day the stylesheet failed to load.
 *
 * Read as text rather than compiled: a `$name: 48rem;` declaration is one line
 * of it, and reading it needs nothing. `sass` exists in the tree only as
 * `@angular/build`'s own dependency, inside the app workspace, and a check
 * that is one regexp is not worth a fifth thing to install.
 */
describe('the widths the stylesheet and the app both have to know', () => {
  const breakpoints = read('app', 'src', 'breakpoints.scss');
  const styles = read('app', 'src', 'styles.scss');
  const layout = read('app', 'src', 'app', 'core', 'layout.ts');

  /** `$phone-width: 48rem;`, wherever in the file it is declared. */
  const declared = (name) => {
    const match = new RegExp(`^\\$${name}:\\s*([^;]+);`, 'm').exec(breakpoints);
    assert.ok(match, `breakpoints.scss declares $${name}`);
    return match[1].trim();
  };

  /** The fallback in `width('--li-phone-width', '48rem')`. */
  const fallback = (property) => {
    const match = new RegExp(`width\\('${property}',\\s*'([^']+)'\\)`).exec(layout);
    assert.ok(match, `layout.ts reads ${property}`);
    return match[1];
  };

  for (const [name, property] of [
    ['phone-width', '--li-phone-width'],
    ['panel-push-width', '--li-panel-push-width'],
  ]) {
    describe(`$${name}`, () => {
      it('is published from the Sass variable rather than typed out again', () => {
        assert.match(
          styles,
          new RegExp(`${property}:\\s*#\\{bp\\.\\$${name}\\};`),
          `styles.scss publishes ${property} from $${name}`,
        );
      });

      it('is what layout.ts falls back to when the property will not resolve', () => {
        assert.equal(
          fallback(property),
          declared(name),
          `layout.ts's fallback for ${property} is $${name}`,
        );
      });
    });
  }
});
