import type { Page } from '@playwright/test';
import {
  captureRequests,
  composer,
  fillProse,
  openPanel,
  openPreferences,
  pageColour,
  seedDeveloperMode,
  seedUi,
  send,
  systemOf,
  waitForTurn,
} from './helpers';
import { expect, test } from './fixtures';

/** A hex as the browser reports it back. */
function rgb(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/**
 * The colours are a stylesheet the reader is allowed to edit, so the assertions
 * here are made against the computed style rather than a screenshot: what
 * matters is that the page is *drawn* in the colour, and that it is still the
 * colour after a reload, which is the only place the setting could have been.
 *
 * These start from 0.1.0's settings file — `seedConnectedSettings` writes the
 * four reading fields and nothing else — so the upgrade path is checked on
 * every run of the suite rather than once in a spec of its own.
 */
test.describe('preferences', () => {
  test.beforeEach(async ({ app }) => {
    await app.seed();
  });

  /** The native picker is not clickable, so the value is set the way a browser would. */
  function paint(page: Page, colour: string): Promise<void> {
    return page
      .getByLabel(/^Page/)
      .first()
      .evaluate((input: HTMLInputElement, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, colour);
  }

  test('opens on Reading, holding what the Reading menu held', async ({ page, server, app }) => {
    await app.visit();
    await openPreferences(page);

    // The first section is open on arrival, with all of its settings — the
    // font among them, because how the story is set is one question and the
    // size of it was answered here while the face was answered under Colours.
    await expect(page.getByRole('switch', { name: 'Dark theme' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Dialogue on its own line' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Show token counts' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Text size' })).toBeVisible();
    await expect(page.getByLabel('Reading font')).toBeVisible();

    await page.getByRole('switch', { name: 'Show token counts' }).click();
    await expect
      .poll(async () => {
        const settings = await server.document('settings');
        return (settings?.['ui'] as Record<string, unknown>)?.['showTokenCounts'];
      })
      .toBe(false);
  });

  test('a colour is on the page at once, and on disk after a reload', async ({
    page,
    server,
    app,
  }) => {
    await app.visit();
    const shipped = await pageColour(page);

    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();
    await paint(page, '#123456');

    // Immediately, with the dialog still open over it.
    await expect.poll(() => pageColour(page)).toBe(rgb('#123456'));
    expect(shipped).not.toBe(rgb('#123456'));

    await expect
      .poll(async () => {
        const settings = await server.document('settings');
        const ui = settings?.['ui'] as { colours?: Record<string, Record<string, string>> };
        return ui?.colours?.['dark']?.['page'];
      })
      .toBe('#123456');

    // The browser keeps nothing of its own, so this is the file coming back.
    await page.reload();
    await expect.poll(() => pageColour(page)).toBe(rgb('#123456'));
  });

  test('each theme keeps its own set, and reset returns the shipped one', async ({ page, app }) => {
    await app.visit();
    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();

    await paint(page, '#123456');
    await page.getByRole('switch', { name: 'Dark theme' }).click();

    // Switching the theme switched the palette with it: light is untouched.
    await expect.poll(() => pageColour(page)).not.toBe(rgb('#123456'));
    const shippedLight = await pageColour(page);
    await paint(page, '#fedcba');
    await expect.poll(() => pageColour(page)).toBe(rgb('#fedcba'));

    await page.getByRole('button', { name: 'Reset the light colours' }).click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();

    // Exactly the shipped colour, because the override is gone rather than
    // replaced by a copy of it.
    await expect.poll(() => pageColour(page)).toBe(shippedLight);

    // And the dark set survived the reset of the light one.
    await page.getByRole('switch', { name: 'Dark theme' }).click();
    await expect.poll(() => pageColour(page)).toBe(rgb('#123456'));
  });

  /**
   * A colour swatch is the one control in the app whose fill is not the app's
   * to choose: three of these are within 1.2:1 of the paper they sit on, and a
   * fourth is that paper's own hairline. So the ring round them is measured
   * rather than looked at — 3:1 is what WCAG 1.4.11 asks of the boundary that
   * identifies a control, and under it a swatch the colour of the surface is
   * an empty box.
   */
  test('every swatch is a box you can see, in both themes', async ({ page, app }) => {
    await app.visit();
    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();

    const worstRing = () =>
      page.evaluate(() => {
        // A custom property holds the `light-dark()` pair it was written as, so
        // it has to be resolved the way the drawn colour was.
        const resolve = (value: string) => {
          const probe = document.createElement('span');
          probe.style.color = value;
          document.body.append(probe);
          const colour = getComputedStyle(probe).color;
          probe.remove();
          return colour;
        };
        const channels = (colour: string) =>
          [...colour.matchAll(/[\d.]+/g)].slice(0, 3).map((m) => Number(m[0]));
        const luminance = (colour: string) => {
          const [r, g, b] = channels(colour).map((c) => {
            const channel = c / 255;
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const contrast = (a: string, b: string) => {
          const one = luminance(a);
          const two = luminance(b);
          return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
        };

        const paper = resolve('var(--li-surface)');
        const rings = [...document.querySelectorAll('.swatch input')].map(
          (input) => getComputedStyle(input).borderTopColor,
        );
        return {
          count: rings.length,
          worst: Math.min(...rings.map((ring) => contrast(ring, paper))),
        };
      });

    const dark = await worstRing();
    expect(dark.count).toBe(11);
    expect(dark.worst).toBeGreaterThanOrEqual(3);

    await page.getByRole('switch', { name: 'Dark theme' }).click();
    const light = await worstRing();
    expect(light.worst).toBeGreaterThanOrEqual(3);
  });

  test('the swatches line up, and the odd one out takes a row', async ({ page, app }) => {
    await app.visit();
    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();

    const grid = await page.evaluate(() => {
      const swatches = [...document.querySelectorAll('.swatches')][0]!.children;
      return [...swatches].map((swatch) => ({
        left: Math.round(swatch.getBoundingClientRect().x),
        width: Math.round(swatch.getBoundingClientRect().width),
        // What a reader lines a column up by: the name, not the box round it.
        name: Math.round(swatch.querySelector('.name')!.getBoundingClientRect().y),
      }));
    });

    // Two columns, so the names come in pairs — and each pair is one line.
    const columns = new Set(grid.map((swatch) => swatch.left));
    expect(columns.size).toBe(2);
    for (let i = 0; i + 1 < grid.length - 1; i += 2) {
      expect(grid[i].name).toBe(grid[i + 1].name);
    }

    // Eleven in two columns leaves one; it has the row rather than a hole.
    const last = grid[grid.length - 1];
    expect(grid.length % 2).toBe(1);
    expect(last.width).toBeGreaterThan(grid[0].width * 1.8);
  });

  test('the chosen page is the same size as the pages beside it', async ({ page, app }) => {
    await app.visit();
    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();

    const previews = await page.locator('.palette .preview').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return [Math.round(box.y), Math.round(box.width), Math.round(box.height)].join('/');
      }),
    );
    const chosen = await page.locator('.palette.on').count();

    // One is selected, and the ring it wears is an outline: it takes no room,
    // so its page is the same box on the same line as the ten beside it.
    expect(chosen).toBe(1);
    expect(new Set(previews.slice(0, 6)).size).toBe(1);
  });

  test('the reading font changes the story and leaves the app alone', async ({ page, app }) => {
    await app.visit();
    // The reading face is only visible on prose, so there has to be some.
    await send(page, 'Two lines, please.');
    await waitForTurn(page);

    await openPreferences(page);
    await page.getByLabel('Reading font').selectOption('mono');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeHidden();

    const faceOf = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily);

    await expect.poll(() => faceOf('.story-prose')).toMatch(/Cascadia|Consolas|monospace/i);
    // The wordmark is app furniture and stays in the serif it always was.
    await expect.poll(() => faceOf('li-top-bar .wordmark')).toMatch(/Iowan|Palatino|serif/i);
  });

  test('the controls are the app’s own, and a stack draws the gap it declares', async ({
    page,
    app,
  }) => {
    await app.visit();

    // A text button has no fill and no border, so its state layer is the whole
    // of what hovering it draws. Material shapes that layer `corner-full`,
    // which put a violet pill round a word in the top bar.
    const layerShape = await page.getByRole('button', { name: 'Preferences' }).evaluate((el) => {
      const layer = el.querySelector('.mat-mdc-button-persistent-ripple')!;
      return getComputedStyle(layer, '::before').borderRadius;
    });
    expect(layerShape).not.toMatch(/9999px|50%/);

    await openPreferences(page);
    await expect(page.locator('.mdc-dialog--opening')).toHaveCount(0);
    await page.getByRole('button', { name: 'Advanced' }).first().click();
    // The panel unfolds, and anything measured while it is unfolding is
    // measured against geometry that is about to change.
    await page.waitForTimeout(600);

    const measured = await page.evaluate(() => {
      // A custom property's declared value is the `light-dark()` pair it was
      // written as, so the only way to compare it with a drawn colour is to
      // let the browser resolve it the same way it resolved that one.
      const resolve = (value: string) => {
        const probe = document.createElement('span');
        probe.style.color = value;
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      };

      const toggle = document.querySelector('mat-slide-toggle')!;
      const gapsOf = (box: Element) => {
        const rows = [...box.children].map((el) => el.getBoundingClientRect());
        return rows
          .slice(1)
          .map((r, i) => Math.round(r.top - rows[i].bottom))
          .filter((gap) => gap >= 0);
      };

      return {
        border: resolve('var(--li-border)'),
        accent: resolve('var(--li-accent)'),
        track: getComputedStyle(toggle.querySelector('.mdc-switch__track')!, '::after')
          .backgroundColor,
        knob: getComputedStyle(toggle.querySelector('.mdc-switch__handle')!, '::after')
          .backgroundColor,
        ticks: document.querySelectorAll('.mdc-switch__icons').length,
        stacks: [...document.querySelectorAll('.stack')].map((box) => ({
          declared: Math.round(parseFloat(getComputedStyle(box).rowGap)),
          drawn: gapsOf(box),
        })),
        settings: [...document.querySelectorAll('.li-setting')].map((box) => ({
          declared: Math.round(parseFloat(getComputedStyle(box).rowGap)),
          drawn: gapsOf(box),
        })),
      };
    });

    // The switch, the other way round from the one Material ships: the app's
    // hairline for a track and the app's accent for the knob.
    expect(measured.track).toBe(measured.border);
    expect(measured.knob).toBe(measured.accent);
    expect(measured.ticks).toBe(0);

    // And the rhythm is the one that is written down. Both of these were out
    // by the browser's paragraph margin on top of the flex gap.
    expect(measured.stacks.length).toBeGreaterThan(0);
    expect(measured.settings.length).toBeGreaterThan(0);
    for (const box of [...measured.stacks, ...measured.settings]) {
      expect(box.drawn.length).toBeGreaterThan(0);
      for (const gap of box.drawn) expect(Math.abs(gap - box.declared)).toBeLessThanOrEqual(1);
    }
  });

  test('the story is written at the size it is read at', async ({ page, server, app }) => {
    // Not the default, because the default is also what the stylesheet ships:
    // a size that only works when nobody has chosen one is not the setting.
    await seedUi(server, { fontSize: 23 });
    await app.visit();
    await send(page, 'Two lines, please.');
    await waitForTurn(page);

    const sizeOf = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize);

    await expect.poll(() => sizeOf('.story-prose')).toBe('23px');

    // The two boxes the story itself is written into, in a sheet over the page
    // and in the panel beside it. Both were 16px against a page of 23.
    await page.getByRole('button', { name: 'Edit scene' }).click();
    await expect(page.locator('.mdc-dialog--opening')).toHaveCount(0);
    expect(await sizeOf('textarea.scene')).toBe('23px');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await openPanel(page);
    expect(await sizeOf('li-chapter-panel [data-section="scene"] textarea')).toBe('23px');

    // The app around it is not the story and does not follow it.
    expect(await sizeOf('li-top-bar .wordmark')).not.toBe('23px');
  });
});
/**
 * Developer mode is the line between what the story needs and what a person
 * debugging it needs. The one thing it must never do is change the request, so
 * that is checked here rather than left to reasoning about the template.
 */
test.describe('developer mode', () => {
  test.beforeEach(async ({ app }) => {
    await app.seed();
  });

  const pill = (page: Page) =>
    page.locator('li-composer').getByRole('button', { name: /^context/ });

  test('is off on a fresh install, and switching it on is the way to the prompt', async ({
    page,
    server,
    app,
  }) => {
    await app.visit();

    // Neither door: the pill is gone and the toolbar button it replaced is too.
    await expect(pill(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'What the model sees' })).toHaveCount(0);

    await openPreferences(page);
    const preferences = page.getByRole('dialog');
    await preferences.getByRole('button', { name: 'Advanced' }).click();
    await preferences.getByRole('switch', { name: /^Developer mode/ }).click();
    await preferences.getByRole('button', { name: 'Done' }).click();
    await expect(preferences).toBeHidden();

    await expect(pill(page)).toBeVisible();
    await pill(page).click();
    await expect(page.getByRole('heading', { name: 'What the model sees' })).toBeVisible();

    // And it is a setting, not a session: the file says so, and a reload agrees.
    await expect
      .poll(async () => {
        const settings = await server.document('settings');
        return (settings?.['ui'] as Record<string, unknown>)?.['developerMode'];
      })
      .toBe(true);
    await page.reload();
    await expect(pill(page)).toBeVisible();
  });

  test('changes nothing about what the model is sent', async ({ page, server, app }) => {
    await app.visit();
    const off = await captureRequests(page);
    await send(page, 'I knock twice and wait.');
    await waitForTurn(page);

    await seedDeveloperMode(server);
    await page.reload();
    await expect(pill(page)).toBeVisible();
    const on = await captureRequests(page);
    await fillProse(composer(page), 'I knock twice and wait.');
    await pill(page).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await waitForTurn(page);

    // The same system prompt, and the same user line under it. Looking at the
    // request is not the same as being in it.
    expect(systemOf(on[on.length - 1])).toBe(systemOf(off[off.length - 1]));
  });

  test('adds the folder the documents are in to About', async ({ page, server, app }) => {
    await app.visit();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /^About Lamplit/ }).click();
    const about = page.getByRole('dialog');
    // The build line is a bug report's, not a developer's, and stays either way.
    await expect(about.locator('.build')).not.toBeEmpty();
    await expect(about.locator('.path')).toHaveCount(0);
    await about.getByRole('button', { name: 'Close' }).click();

    await seedDeveloperMode(server);
    await page.reload();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /^About Lamplit/ }).click();
    await expect(page.getByRole('dialog').locator('.path')).toContainText(server.dataDir);
  });
});
