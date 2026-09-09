import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { desktop } from '../../core/desktop';
import { Dialogs } from '../../dialogs';
import { SettingsStore } from '../../store/settings-store';
import { ShareStore } from '../../store/share-store';
import { UpdatesStore } from '../../store/updates-store';

/**
 * Under the hood: the update check, the second door, the proxy, and the pill
 * that shows how the prompt was built.
 *
 * Three of the four reach past the app. The update check is a request to
 * GitHub, sharing opens a listener a phone can reach, and the proxy is a
 * setting in the Electron shell — so this is the panel where a switch has to
 * take effect now rather than at the next start, and where the warnings are.
 * Nothing here is about the story, which is why it is folded away.
 */
@Component({
  selector: 'li-advanced-panel',
  imports: [MatButtonModule, MatExpansionModule, MatSlideToggleModule],
  template: `
    <mat-expansion-panel class="li-panel">
      <mat-expansion-panel-header>
        <mat-panel-title>Advanced</mat-panel-title>
        <mat-panel-description>{{ summary() }}</mat-panel-description>
      </mat-expansion-panel-header>

      <p class="li-hint lead">Options for people who want to look under the hood.</p>

      <div class="stack">
        <div class="li-setting">
          <mat-slide-toggle
            [checked]="ui().checkForUpdates"
            (change)="setCheckForUpdates($event.checked)"
          >
            Check for a new version when Lamplit starts
          </mat-slide-toggle>
          <p class="li-hint">
            Once per start, the server asks GitHub which versions have been published and the top
            bar says so if one of them is newer. Switched off, it is not asked at all. Your stories
            never leave this machine either way.
          </p>
        </div>

        @if (share.available()) {
          <hr />

          <div class="li-setting">
            <mat-slide-toggle
              [checked]="share.on()"
              [disabled]="share.busy()"
              (change)="setShare($event.checked)"
            >
              Share on this network
            </mat-slide-toggle>
            <p class="li-hint">
              Open the story on your phone while it is on the same Wi-Fi. Lamplit keeps answering on
              this computer exactly as it did; sharing adds a second door, and the code below is the
              key to it. Switch it off and that door is gone.
            </p>
          </div>

          @if (share.error()) {
            <p class="warning li-warning" role="status">{{ share.error() }}</p>
          }

          @if (share.on()) {
            @if (share.addresses().length) {
              <div class="share">
                @if (share.addresses().length > 1) {
                  <!-- More than one adapter is the ordinary case on Windows,
                       and there is no way from here to tell which one the
                       phone is on. Offering all of them beats guessing. -->
                  <div class="addresses" role="group" aria-label="Addresses to share on">
                    @for (option of share.addresses(); track option) {
                      <button
                        type="button"
                        class="address li-pill"
                        [class.on]="option === shownAddress()"
                        (click)="chosenAddress.set(option)"
                      >
                        {{ option }}
                      </button>
                    }
                  </div>
                }

                <img
                  class="qr"
                  [src]="share.qrUrl(shownAddress())"
                  alt="Point your phone's camera at this to pair it with Lamplit"
                  width="176"
                  height="176"
                />

                <div class="share-side">
                  <p class="li-hint">
                    Point your phone's camera at the code. It opens Lamplit once and is remembered
                    afterwards, so this is a thing you do on a phone once.
                  </p>
                  <p class="url">
                    Afterwards the phone is at <code>{{ share.urlFor(shownAddress()) }}</code>
                  </p>
                  <button matButton [disabled]="share.busy()" (click)="newCode()">New code</button>
                </div>
              </div>
            } @else {
              <p class="warning li-warning" role="status">
                This computer has no network address at the moment, so there is nothing for a phone
                to open. Join a Wi-Fi network and switch this off and on again.
              </p>
            }

            <p class="warning li-warning">
              <strong>A phone that has scanned the code can do everything you can here</strong> —
              read and change every story, and read your API key, which Lamplit keeps as plain text.
              The traffic between them is plain HTTP across your own network and is not encrypted.
              Share on a network you trust, and use <em>New code</em> to lock out every phone that
              has ever been paired.
            </p>

            @if (modelIsHere()) {
              <p class="warning li-warning">
                Your endpoint is <code>{{ connection().baseUrl }}</code
                >, which is this computer. The story is sent to the model by the browser showing it,
                so a phone will reach Lamplit but not the model, and writing will fail there. Use an
                endpoint the phone can reach as well.
              </p>
            }

            <p class="li-hint">
              The first time you switch this on, Windows asks whether to allow Lamplit through the
              firewall. Say yes for private networks, or the phone gets nothing.
            </p>
          }
        }

        @if (isDesktop) {
          <hr />

          <div class="li-setting">
            <mat-slide-toggle
              [checked]="ui().systemProxy"
              (change)="setSystemProxy($event.checked)"
            >
              Reach the model through this computer’s proxy
            </mat-slide-toggle>
            <p class="li-hint">
              Off, Lamplit connects straight to whichever endpoint you have given it, the same as
              the zip and a browser tab do. Switch it on if your network only lets you out through a
              proxy — a work laptop, usually. Lamplit's window then takes a moment to find that
              proxy the first time it needs it, which is why it is not the default: on some networks
              that search takes twenty seconds, and nobody should wait for it just to open the app.
            </p>
          </div>
        }

        <hr />

        <div class="li-setting">
          <mat-slide-toggle
            [checked]="ui().developerMode"
            (change)="settings.patchUi({ developerMode: $event.checked })"
          >
            Developer mode — show how the prompt is built and what the app is doing
          </mat-slide-toggle>
          <p class="li-hint">
            Puts the context pill back under the composer, which is the way into what the model
            actually sees, and adds the folder your documents are in to the About sheet. It changes
            nothing about the request itself.
          </p>
        </div>
      </div>
    </mat-expansion-panel>
  `,
  styles: `
    /* The code and what to do with it, side by side, and stacked when the
       dialog is too narrow for that to leave room for either. */
    .share {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: var(--li-space-lg);
      margin: var(--li-space-xs) 0 var(--li-space-2xs);
    }

    .share-side {
      flex: 1 1 14rem;
      min-width: 0;
    }

    .qr {
      flex: none;
      display: block;
      padding: var(--li-space-xs);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-md);
      /* White behind it whatever the theme: a phone camera reads a QR code by
         its contrast, and the dark page would invert it. */
      background: #ffffff;
    }

    .addresses {
      flex-basis: 100%;
      display: flex;
      flex-wrap: wrap;
      gap: var(--li-space-xs);
    }

    /* An address is read off one screen and typed into another, so it is a
       step larger than a pill that is only glanced at. */
    .address {
      font-size: var(--li-text-sm);

      &.on {
        border-color: var(--li-edge-accent);
        color: var(--li-ink);
      }
    }

    .url {
      margin: 0 0 var(--li-space-sm);
      font-size: var(--li-text-sm);
      color: var(--li-muted);

      code {
        color: var(--li-ink);
        word-break: break-all;
      }
    }

    .warning code {
      word-break: break-all;
    }
  `,
})
export class AdvancedPanel {
  protected readonly settings = inject(SettingsStore);
  protected readonly share = inject(ShareStore);
  private readonly updates = inject(UpdatesStore);
  private readonly dialogs = inject(Dialogs);

  protected readonly ui = this.settings.ui;
  protected readonly connection = this.settings.connection;

  /** Only the desktop shell has a proxy to switch; in a tab it is the browser's. */
  protected readonly isDesktop = desktop() !== null;

  constructor() {
    // Asked for when the dialog opens rather than at startup: it is the
    // server's own state, it can have been changed from a second window, and
    // nothing outside this panel shows it.
    void this.share.load();
  }

  /**
   * Which address the code is drawn for. Empty until somebody picks one, so
   * that the first of whatever the server found is what is on screen without
   * this having to be kept in step with it.
   */
  protected readonly chosenAddress = signal('');

  protected readonly shownAddress = computed(() => {
    const addresses = this.share.addresses();
    const chosen = this.chosenAddress();
    return addresses.includes(chosen) ? chosen : (addresses[0] ?? '');
  });

  /**
   * Whether the model is on this computer. If it is, a phone cannot reach it:
   * the browser showing the story is what calls the endpoint (see
   * `model-client.ts`), so `localhost` on the phone is the phone. Proxying the
   * model through Lamplit's own server would fix it and is not this change.
   */
  protected readonly modelIsHere = computed(() => {
    const url = this.connection().baseUrl.trim();
    if (!url) return false;
    try {
      const { hostname } = new URL(url);
      return /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i.test(hostname);
    } catch {
      return false;
    }
  });

  protected readonly summary = computed(() => {
    const ui = this.ui();
    // Sharing first: it is the only thing in here that changes who can reach
    // the writing, so it is the one worth reading off a folded panel.
    if (this.share.on()) return 'shared on this network';
    if (ui.developerMode) return 'developer mode on';
    return ui.checkForUpdates ? 'checking for new versions' : 'not checking for new versions';
  });

  /**
   * Opens or closes the second listener now, not at the next start: the switch
   * is about a door, and a door that opens later is not one anybody trusts.
   */
  protected setShare(on: boolean): void {
    void this.share.set(on);
  }

  protected async newCode(): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Make a new code?',
      message:
        'Every phone that has been paired stops working straight away and has to scan the new code. Nothing you have written is touched.',
      confirm: 'Make a new code',
    });
    if (ok) void this.share.newCode();
  }

  /**
   * Switching it on asks now rather than at the next start: the label is about
   * what happens on a start, and waiting for one to find out would be silly.
   */
  protected setCheckForUpdates(on: boolean): void {
    this.settings.patchUi({ checkForUpdates: on });
    if (on) void this.updates.load();
  }

  /**
   * Takes effect on the next request rather than at the next start: the shell
   * changes the window's proxy when it is told, and there is nothing to restart.
   */
  protected setSystemProxy(on: boolean): void {
    this.settings.patchUi({ systemProxy: on });
    void desktop()
      ?.useSystemProxy(on)
      .catch(() => undefined);
  }
}
