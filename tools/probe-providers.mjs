import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../server/src/ports.js';

/**
 * `npm run providers` — asks every provider in the table whether it still lets
 * a browser call it, and prints the result as the markdown that goes into
 * *docs/models-and-parameters.md*.
 *
 * The whole app depends on one fact: the browser reaches the provider directly,
 * so the provider has to answer a CORS preflight. That fact is a third party's
 * to change, and nothing in the test suite would notice — so this exists to be
 * re-run rather than trusted. It is deliberately **not** in CI: it talks to
 * twenty companies and would go red for reasons that are not ours.
 *
 * The probe is the real request the app makes: a cross-origin `POST` to
 * `/chat/completions` carrying `authorization` and `content-type`, from a page
 * on `http://localhost` at the port the packaged app runs on. The key is
 * nonsense, so every provider answers 401 or 400 and no tokens are spent. What
 * is being read is not the status: it is whether the browser let the answer
 * through at all.
 *
 * The table it reads lives in the app's TypeScript, imported straight from
 * this script: Node strips the types itself from 22.22 on, which is the floor
 * the root `engines` sets, so no flag is needed.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = pathToFileURL(resolve(ROOT, 'app/src/app/core/providers.ts')).href;

const { PROVIDERS, CUSTOM_PROVIDER_ID } = await import(TABLE);

async function main() {
  const targets = PROVIDERS.filter(
    (p) => p.id !== CUSTOM_PROVIDER_ID && !p.baseUrl.startsWith('http://localhost'),
  );

  const origin = createServer((_, response) =>
    response
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end('<!doctype html><title>probe</title>'),
  );
  await new Promise((done) => origin.listen(DEFAULT_PORT, '127.0.0.1', done));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${DEFAULT_PORT}/`);

  console.log(`Probing ${targets.length} providers from http://localhost:${DEFAULT_PORT} …\n`);
  const results = [];
  for (const preset of targets) {
    const verdict = await probe(page, preset);
    results.push({ preset, ...verdict });
    console.log(
      `  ${verdict.allowed ? 'ok  ' : 'FAIL'}  ${preset.name.padEnd(22)} ${verdict.detail}`,
    );
  }

  await browser.close();
  await new Promise((done) => origin.close(done));

  report(results);
  process.exitCode = results.every((r) => r.allowed) ? 0 : 1;
}

/**
 * One cross-origin request, from the page. A `TypeError` is the browser
 * refusing to hand the answer over — which is the only failure that matters
 * here. Any status at all means the preflight passed.
 */
async function probe(page, preset) {
  return page.evaluate(async ({ baseUrl, headers }) => {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer probe-not-a-key',
          'Content-Type': 'application/json',
          ...(headers ?? {}),
        },
        body: JSON.stringify({ model: 'probe', messages: [], max_tokens: 1 }),
      });
      return { allowed: true, detail: `answered ${response.status}` };
    } catch (e) {
      return { allowed: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }, preset);
}

/** The table as it goes into the docs, dated, so it can replace the old one. */
function report(results) {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n--- for docs/models-and-parameters.md, ${today} ---\n`);
  console.log('| Provider | URL | Answers a browser |');
  console.log('|---|---|---|');
  for (const { preset, allowed, detail } of results) {
    console.log(
      `| ${preset.name} | \`${preset.baseUrl}\` | ${allowed ? `yes (${detail})` : `**no** — ${detail}`} |`,
    );
  }
  const refused = results.filter((r) => !r.allowed);
  console.log(
    refused.length
      ? `\n${refused.length} provider(s) no longer answer a browser. They cannot stay in the list.`
      : '\nAll of them still answer a browser. The table stands.',
  );
}

await main();
