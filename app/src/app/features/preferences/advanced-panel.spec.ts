import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvancedPanel } from './advanced-panel';
import { SettingsStore } from '../../store/settings-store';
import { ShareStore } from '../../store/share-store';
import { KEYS } from '../../store/documents';
import { STORAGE_BACKEND } from '../../store/storage';
import { InMemoryStorage } from '../../store/testing/in-memory-storage';

describe('AdvancedPanel', () => {
  let storage: InMemoryStorage;
  let fixture: ReturnType<typeof TestBed.createComponent<AdvancedPanel>>;

  const settings = () => TestBed.inject(SettingsStore);
  const host = () => fixture.nativeElement as HTMLElement;

  function open(ui: Record<string, unknown> = {}): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
      ui: { theme: 'light', ...ui },
    });
    fixture = TestBed.createComponent(AdvancedPanel);
    fixture.detectChanges();
  }

  /** A named slide toggle, as the reader would reach it. */
  function toggle(label: string): HTMLElement | null {
    const row = [...host().querySelectorAll<HTMLElement>('mat-slide-toggle')].find((candidate) =>
      candidate.textContent.includes(label),
    );
    return row?.querySelector<HTMLElement>('button[role="switch"], input[type="checkbox"]') ?? null;
  }

  /** What the folded panel says about itself. */
  function summary(): string {
    return host().querySelector('mat-panel-description')?.textContent.trim() ?? '';
  }

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
  });

  /**
   * The switch that changes who can reach the writing.
   *
   * Everything it shows comes from the server — the app is deliberately never
   * told the pairing token, so there is nothing here to check about it beyond
   * the fact that the picture of it is asked for. What is worth checking is
   * that the sheet says nothing at all where there is nothing to say, and that
   * the two things a person could be caught out by are on screen when sharing
   * is on: what a paired phone can read, and a model a phone cannot reach.
   */
  describe('sharing on this network', () => {
    const LABEL = 'Share on this network';

    /** The server's three answers, from a state the test can change. */
    function serving(state: { share: boolean; port: number; addresses: string[] } | null): void {
      let held = state;
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init?: RequestInit) => {
          if (held === null) {
            return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
          }
          if (init?.method === 'PUT') {
            const asked = JSON.parse(init.body as string) as { share?: boolean };
            if (typeof asked.share === 'boolean') held = { ...held, share: asked.share };
          }
          return Promise.resolve(
            new Response(JSON.stringify(held), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }),
      );
    }

    /**
     * The panel, with the server's answer already in hand. Loaded through the
     * store rather than waited for after the component asks, so the first
     * render is the one the assertions are about.
     */
    async function openSharing(
      state: { share: boolean; port: number; addresses: string[] } | null,
      ui: Record<string, unknown> = {},
    ): Promise<void> {
      serving(state);
      await TestBed.inject(ShareStore).load();
      open(ui);
    }

    function warnings(): string {
      return [...host().querySelectorAll('.warning')].map((one) => one.textContent).join(' ');
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('is not on the sheet where the server has no sharing to report', async () => {
      await openSharing(null);
      expect(toggle(LABEL)).toBeNull();
    });

    it('is on the sheet, off, with nothing to pair yet', async () => {
      await openSharing({ share: false, port: 0, addresses: [] });

      expect(toggle(LABEL)).not.toBeNull();
      expect(toggle(LABEL)?.getAttribute('aria-checked')).toBe('false');
      expect(host().querySelector('.qr')).toBeNull();
      expect(warnings()).not.toContain('everything you can here');
    });

    it('shows the code, the address and the warning once it is on', async () => {
      await openSharing({ share: true, port: 4177, addresses: ['192.168.1.5'] });

      const qr = host().querySelector<HTMLImageElement>('.qr');
      expect(qr?.getAttribute('src')).toContain('/api/server/share/qr?address=192.168.1.5');
      expect(host().textContent).toContain('http://192.168.1.5:4177/');
      // The two facts somebody could be caught out by, both said out loud.
      expect(warnings()).toContain('everything you can here');
      expect(host().textContent).toContain('firewall');
    });

    it('offers every address the machine has, because only the phone knows which', async () => {
      await openSharing({ share: true, port: 4177, addresses: ['192.168.1.5', '172.28.0.1'] });

      const addresses = [...host().querySelectorAll('.address')].map((one) =>
        one.textContent.trim(),
      );
      expect(addresses).toEqual(['192.168.1.5', '172.28.0.1']);
      // The first until somebody says otherwise, and then the one they said.
      expect(host().querySelector('.qr')?.getAttribute('src')).toContain('192.168.1.5');
      host().querySelectorAll<HTMLButtonElement>('.address')[1].click();
      fixture.detectChanges();
      expect(host().querySelector('.qr')?.getAttribute('src')).toContain('172.28.0.1');
    });

    it('says so when the model is on this computer and the phone cannot reach it', async () => {
      await openSharing({ share: true, port: 4177, addresses: ['192.168.1.5'] });
      expect(warnings()).not.toContain('which is this computer');

      settings().patchConnection({ baseUrl: 'http://localhost:11434/v1' });
      fixture.detectChanges();
      expect(warnings()).toContain('which is this computer');
    });

    it('is the first thing the folded panel says about itself', async () => {
      await openSharing({ share: true, port: 4177, addresses: ['192.168.1.5'] });
      expect(summary()).toBe('shared on this network');
    });
  });

  /**
   * The window always starts without a proxy, because finding one is allowed to
   * take twenty seconds and on the way in that is twenty seconds of nothing on
   * screen. This switch is how someone whose network only lets them out through
   * a proxy asks for it back — so it has to reach the shell when it is clicked
   * rather than at the next start, and it has to be absent where there is no
   * shell to reach.
   */
  describe('reaching the model through the machine’s proxy', () => {
    const LABEL = 'Reach the model through this computer’s proxy';
    let useSystemProxy: ReturnType<typeof vi.fn>;

    function inTheDesktopApp(): void {
      useSystemProxy = vi.fn().mockResolvedValue(undefined);
      (globalThis as { lamplit?: unknown }).lamplit = {
        openDataFolder: vi.fn(),
        checkForUpdates: vi.fn(),
        useSystemProxy,
      };
    }

    afterEach(() => {
      delete (globalThis as { lamplit?: unknown }).lamplit;
    });

    it('is not on the sheet at all in a browser tab, where the proxy is the browser’s', () => {
      open();
      expect(toggle(LABEL)).toBeNull();
    });

    it('is on the sheet in the desktop app, and off until it is asked for', () => {
      inTheDesktopApp();
      open();

      expect(toggle(LABEL)).not.toBeNull();
      expect(settings().ui().systemProxy).toBe(false);
    });

    it('tells the shell when it is clicked, rather than at the next start', () => {
      inTheDesktopApp();
      open();
      toggle(LABEL)!.click();
      fixture.detectChanges();

      expect(settings().ui().systemProxy).toBe(true);
      expect(useSystemProxy).toHaveBeenCalledWith(true);
    });

    it('gives it up again the same way', () => {
      inTheDesktopApp();
      open({ systemProxy: true });
      toggle(LABEL)!.click();
      fixture.detectChanges();

      expect(settings().ui().systemProxy).toBe(false);
      expect(useSystemProxy).toHaveBeenCalledWith(false);
    });
  });
});
