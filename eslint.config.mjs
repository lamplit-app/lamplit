import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import angular from 'angular-eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * One config for the whole repository, from the root, so that `npm run lint`
 * is one command and CI runs the same one.
 *
 * The app gets the type-aware rule sets: it is the part of the tree with a
 * type checker to lean on, and the part where a wrong `?.` or an unawaited
 * promise costs a reader a story. Everything written in plain JavaScript —
 * the server, the shell, the tools — gets ESLint's own recommended set and
 * nothing more; the end-to-end specs are TypeScript that Playwright compiles
 * without a tsconfig, so they get the untyped TypeScript set.
 *
 * Rules turned off below each say why. A rule that fights a deliberate choice
 * of this codebase is not a rule this codebase wants.
 */
export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    'app/.angular/',
    'build/',
    '.cache/',
    'backups/',
    'data/',
    'docs/',
    '**/test-results/',
    '**/playwright-report/',
  ]),

  // -- The Angular app ----------------------------------------------------------
  {
    files: ['app/src/**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      ...angular.configs.tsRecommended,
    ],
    languageOptions: {
      parserOptions: {
        // app/tsconfig.json is a solution file (references, no files of its
        // own); the project service follows the references to the app and
        // spec configs, so every source file finds its program.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Templates are inline, so the template rules below run on them from here.
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        // `app-root` is the one the CLI made; everything else is the product's.
        { type: 'element', prefix: ['li', 'app'], style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'li', style: 'camelCase' },
      ],
      // A count or a flag in a template literal reads as what it is; only an
      // object or an array would print as nonsense, and those stay forbidden.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      // `(e) => this.x.set(e)` is how every event handler in the app is
      // written; adding braces to say "and return nothing" would add nothing.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // `||` on a string is usually the point: an empty title falls back to
      // the default exactly as a missing one does. The rule cannot tell the
      // deliberate `||` from the careless one, so it is not asked to.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      // With noUncheckedIndexedAccess on, `list[list.length - 1]!` after a
      // length check is how the code states an invariant it has just proven.
      // A wrong `!` throws on the line that carries it, which is the right
      // place to find out.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `read<T>(key)` puts the one cast a document needs at the one place it
      // leaves storage. The rule would rather it returned `unknown` and every
      // caller cast for itself, which is the same cast in more places.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      // The stores take an override away by copying the object and deleting
      // the key, so that an absent key means "the default" in the JSON file
      // as well as in memory. That is the point, not an accident.
      '@typescript-eslint/no-dynamic-delete': 'off',
      // A component that is nothing but a template is a class with nothing in
      // it, and that is the shape to want: `li-preferences-dialog` is the
      // sheet, the four panels and the close button, and every field it used
      // to hold went to the panel that reads it. Angular needs the class
      // either way, and the decorator is what says the class is not the point.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      // `const { promptOrder: _shipped, ...rest } = story` is how a field is
      // dropped from a document; the named-and-unused half is the point.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['app/src/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },

  // -- The layers of the app, as rules ------------------------------------------
  //
  // The import graph was already this shape and nothing held it there: five
  // folders, each importing only inwards, kept true by everyone who has ever
  // added a file remembering to. `shared/` had drifted the furthest — it held
  // the sheet openers, which type-import two feature dialogs, so `shared/`
  // depended on `features/` and formed a cycle with one of them, survivable
  // only because the other half of it was a dynamic import.
  //
  // Every rule below is one sentence about who may know about whom, and every
  // one of them is a rule the code already obeys. They are here so that the
  // next file to break one says so on the way in rather than a year later.
  //
  // `@typescript-eslint`'s version of the rule rather than ESLint's own,
  // because a `import type { X }` is exactly how the drift got in and the base
  // rule cannot see one.
  {
    // `core/`: the app with no app in it — the model client, the SSE reader,
    // the prompt builder, the palettes, the formatting. Nothing above it, and
    // no framework in it either, save Angular's DI and signals: three files
    // reach for `@angular/core` and no file reaches for anything else Angular
    // publishes, which is the exception written down. `layout.ts` is a service
    // over `matchMedia` and stays here — the four questions it answers are
    // asked by components, stores and the stylesheet alike, and the reason it
    // is a service at all is that it has a `DestroyRef` to hold.
    files: ['app/src/app/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/store/**', '**/shared/**', '**/chrome/**', '**/features/**'],
              message: 'core/ is the layer everything else is built on; it imports none of them.',
            },
            {
              group: ['**/workspace', '**/dialogs'],
              message: 'core/ knows nothing about the app that is built on it.',
            },
            {
              group: ['@angular/**', '!@angular/core', '!@angular/core/**'],
              message:
                'core/ takes DI and signals from @angular/core and nothing else from Angular.',
            },
          ],
        },
      ],
    },
  },
  {
    // `store/`: the documents and the rules about them. Reads `core/`, and is
    // read by everything that draws.
    files: ['app/src/app/store/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/shared/**',
                '**/chrome/**',
                '**/features/**',
                '**/workspace',
                '**/dialogs',
              ],
              message: 'A store holds documents; it does not know what is drawn from them.',
            },
          ],
        },
      ],
    },
  },
  {
    // `shared/`: pieces with no story in them — a field, an editor, a notice,
    // the phone-sheet gestures. A widget that injects a store is not one of
    // these and belongs in `chrome/`, which is what the rule says.
    files: ['app/src/app/shared/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/store/**',
                '**/chrome/**',
                '**/features/**',
                '**/workspace',
                '**/dialogs',
              ],
              message: 'shared/ is widgets. Anything that reaches a store belongs in chrome/.',
            },
          ],
        },
      ],
    },
  },
  {
    // `chrome/`: this app's own furniture — the top bar, the notices, the save
    // indicator, the reading voice. Store-aware, and still never a feature.
    files: ['app/src/app/chrome/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/**', '**/workspace'],
              message: 'chrome/ is around the features, not inside them; open a sheet instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // A feature never imports another. What two of them share goes to
    // `shared/`, `chrome/` or a store, and what one of them opens goes through
    // `Dialogs`, which is the whole reason that service exists.
    //
    // `../*/**` is a sibling feature and nothing else: a reach further out —
    // `../../core/`, `../../shared/`, `../../dialogs` — starts with `../../`
    // and is put back by the second half.
    files: ['app/src/app/features/*/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*/**', '!../../**'],
              message:
                'A feature never imports another. Share through shared/, chrome/ or a store, and open through Dialogs.',
            },
          ],
        },
      ],
    },
  },

  // -- Node, in plain JavaScript ------------------------------------------------
  {
    files: ['server/**/*.js', 'electron/**/*.mjs', 'tools/**/*.mjs', 'e2e/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  {
    // This file. Without a block that matches it, `eslint .` walks past the one
    // file that decides what everything else is linted with — an unused import
    // or a stray `console.log` in here went unreported while every file it
    // configures was checked for both.
    files: ['*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  {
    // The preload is CommonJS because a sandboxed preload cannot be a module;
    // preload.cjs says so at the top.
    files: ['electron/**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },

  // -- The end-to-end specs -----------------------------------------------------
  {
    files: ['e2e/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // A Playwright fixture starts when a test destructures it, whether or
      // not the body then reads it: `({ page, server })` is what starts the
      // server. `async ({}, use)` is the fixture that needs nothing itself.
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
      // The specs read documents off the disk and request bodies off the
      // wire, both JSON whose shape the app owns. Typing them here would be a
      // second copy of the app's models to keep in step; `any` says what a
      // spec means, which is "whatever the app wrote".
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Formatting is Prettier's job; this turns off every rule that would argue.
  prettier,
]);
