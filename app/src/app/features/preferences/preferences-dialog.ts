import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SPEECH_RATE } from '../../core/defaults';
import { desktop } from '../../core/desktop';
import { ColourKey, ContrastMode, MotionMode, ReadingFont } from '../../core/models';
import {
  AA_CONTRAST,
  READING_FONTS,
  THEME_COLOURS,
  contrastRatio,
  shippedColour,
  wantsContrast,
} from '../../core/theming';
import { characterColour, characterColourLabel } from '../../core/character-colours';
import { PAGE_PALETTES, paletteLabel } from '../../core/page-palettes';
import { Field } from '../../shared/field';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { ShareStore } from '../../store/share-store';
import { StoryStore } from '../../store/story-store';
import { UpdatesStore } from '../../store/updates-store';
import { DialogsService } from '../../shared/dialogs.service';
import { ReadAloud } from '../../shared/read-aloud.service';

/**
 * Everything about how the story looks to you, and nothing about what is sent.
 *
 * Reading is what the top bar's menu used to hold, unchanged and open on
 * arrival. Colours and Advanced are folded away, because the first is a long
 * grid nobody needs on the way to the text size and the second is where the
 * options that come with a warning will live.
 */
@Component({
  selector: 'li-preferences-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatExpansionModule,
    MatSliderModule,
    MatSlideToggleModule,
    Field,
  ],
  template: `
    <h2 mat-dialog-title>Preferences</h2>

    <mat-dialog-content>
      <mat-accordion multi>
        <mat-expansion-panel expanded>
          <mat-expansion-panel-header>
            <mat-panel-title>Reading</mat-panel-title>
            <mat-panel-description>{{ readingSummary() }}</mat-panel-description>
          </mat-expansion-panel-header>

          <div class="stack">
            <mat-slide-toggle
              [checked]="ui().theme === 'dark'"
              (change)="settings.patchUi({ theme: $event.checked ? 'dark' : 'light' })"
            >
              Dark theme
            </mat-slide-toggle>
            <mat-slide-toggle
              [checked]="ui().bookStyleDialogue"
              (change)="settings.patchUi({ bookStyleDialogue: $event.checked })"
            >
              Dialogue on its own line
            </mat-slide-toggle>
            <mat-slide-toggle
              [checked]="ui().showTokenCounts"
              (change)="settings.patchUi({ showTokenCounts: $event.checked })"
            >
              Show token counts
            </mat-slide-toggle>
            <label class="size">
              Text size
              <mat-slider min="14" max="26" step="1" discrete>
                <input
                  matSliderThumb
                  [value]="ui().fontSize"
                  (valueChange)="settings.patchUi({ fontSize: $event })"
                />
              </mat-slider>
            </label>

            <!-- The other half of how the story is set, beside the size of it.
                 It lived under Colours, which is where the page is chosen and
                 not where the story is set. -->
            <li-field
              label="Reading font"
              class="font"
              hint="The story itself, not the app around it."
            >
              <select (change)="setFont(value($event))">
                @for (font of fonts; track font.key) {
                  <option [value]="font.key" [selected]="font.key === ui().font">
                    {{ font.label }}
                  </option>
                }
              </select>
            </li-field>

            <!-- Read aloud. The device's own voices and nothing sent anywhere,
                 so the list is whatever this machine happens to ship with —
                 which is why the choice is stored by name and a phone that has
                 never heard of it simply reads in its own. -->
            @if (speech.supported) {
              <hr />
              <div class="li-setting">
                <mat-slide-toggle
                  [checked]="ui().readAloud"
                  (change)="settings.patchUi({ readAloud: $event.checked })"
                >
                  Read replies aloud
                </mat-slide-toggle>
                <p class="li-hint">
                  Each reply is read as it finishes. Any message can be read on its own from its
                  <strong>⋯</strong> menu without this being on.
                </p>
              </div>

              <li-field
                label="Voice"
                class="font"
                hint="The voices this machine has. Nothing is sent anywhere to read."
              >
                <select (change)="settings.patchUi({ voice: value($event) })">
                  <option value="" [selected]="!ui().voice">This device's default</option>
                  @for (voice of speech.voices(); track voice.name) {
                    <option [value]="voice.name" [selected]="voice.name === ui().voice">
                      {{ voice.name }} · {{ voice.lang }}
                    </option>
                  }
                </select>
              </li-field>

              <label class="size">
                Reading speed
                <mat-slider
                  [min]="rate.min"
                  [max]="rate.max"
                  [step]="rate.step"
                  discrete
                  [displayWith]="rateLabel"
                >
                  <input
                    matSliderThumb
                    [value]="ui().speechRate"
                    (valueChange)="settings.patchUi({ speechRate: $event })"
                  />
                </mat-slider>
              </label>
            }
          </div>
        </mat-expansion-panel>

        <mat-expansion-panel>
          <mat-expansion-panel-header>
            <mat-panel-title>Accessibility</mat-panel-title>
            <mat-panel-description>{{ accessibilitySummary() }}</mat-panel-description>
          </mat-expansion-panel-header>

          <p class="li-hint lead">
            Lamplit already follows what your computer asks for, so there is nothing to do here
            unless this app should be the exception.
          </p>

          <div class="stack">
            <li-field
              label="Contrast"
              class="choice"
              hint="Draws every rule, box and divider more firmly. Nothing else moves."
            >
              <select (change)="setContrast(value($event))">
                @for (choice of contrasts; track choice.key) {
                  <option [value]="choice.key" [selected]="choice.key === ui().contrast">
                    {{ choice.label }}
                  </option>
                }
              </select>
            </li-field>
            <p class="li-hint">
              <strong>Follow my computer</strong> reads Windows' <em>Contrast themes</em>, macOS'
              <em>Increase contrast</em>, or the same setting in your browser. The stronger rules
              clear the 3:1 WCAG asks of anything marking out a control; the ones Lamplit ships sit
              at about 2:1, and your text is over the 4.5:1 AA asks either way — so
              <strong>always as it ships</strong> is a fair thing to choose.
            </p>

            <hr />

            <li-field
              label="Motion"
              class="choice"
              hint="Sheets, switches and the dots that show a reply coming."
            >
              <select (change)="setMotion(value($event))">
                @for (choice of motions; track choice.key) {
                  <option [value]="choice.key" [selected]="choice.key === ui().motion">
                    {{ choice.label }}
                  </option>
                }
              </select>
            </li-field>
            <p class="li-hint">
              There is no <em>always animate</em>, and that is deliberate: nothing here moves in
              order to tell you something, so a computer asking for stillness is never overruled
              from this panel. <strong>Always still</strong> is for a computer that has no such
              setting, or one you would rather leave alone.
            </p>
          </div>
        </mat-expansion-panel>

        <mat-expansion-panel>
          <mat-expansion-panel-header>
            <mat-panel-title>Colours</mat-panel-title>
            <mat-panel-description>{{ coloursSummary() }}</mat-panel-description>
          </mat-expansion-panel-header>

          <div class="row-head">
            <span class="row-name">Page palette</span>
            @if (customised()) {
              <span class="tag li-pill">custom</span>
            }
          </div>
          <p class="li-hint palette-lead">
            @if (editingChapter()) {
              <strong>Chapter {{ chapters.chapter().number }} has a page of its own.</strong> This
              row is editing that one and not the story's. The chapter keeps it when you come back
              to it; set it back to the page it ships with and the story's own is underneath.
            } @else {
              A preset for the swatches below: one click sets every one of them, in both themes.
              Change a colour afterwards and yours wins — that is what <em>custom</em> means, and
              Reset is the way out of it.
            }
          </p>

          <div class="palettes">
            @for (option of paletteOptions(); track option.name) {
              <button
                type="button"
                class="palette"
                [class.on]="option.name === currentPalette()"
                [title]="option.title"
                (click)="choosePalette(option.name)"
              >
                <span class="preview" [style.background]="option.page">
                  <span class="sheet" [style.background]="option.surface">
                    <span class="line" [style.background]="option.ink"></span>
                    <span class="line short" [style.background]="option.speech"></span>
                  </span>
                  <span class="dot" [style.background]="option.accent"></span>
                </span>
                <span class="palette-label li-one-line">{{ option.label }}</span>
              </button>
            }
          </div>

          <p class="li-hint editing">
            You are editing the <strong>{{ ui().theme }}</strong> theme. Switch it above and the
            other set is edited instead; each keeps its own colours.
          </p>

          <div class="swatches">
            <!-- An odd number of colours in two columns leaves one of them
                 beside an empty cell; the last one takes the row instead. -->
            @for (swatch of swatches(); track swatch.key) {
              <label
                class="swatch"
                [class.custom]="swatch.custom"
                [class.wide]="$last && $count % 2 === 1"
              >
                <input
                  type="color"
                  [value]="swatch.colour"
                  (input)="setColour(swatch.key, $event)"
                />
                <span class="text">
                  <span class="name">{{ swatch.label }}</span>
                  <span class="li-hint">{{ swatch.hint }}</span>
                </span>
              </label>
            }
          </div>

          @if (contrastWarning()) {
            <p class="warning li-warning" role="status">{{ contrastWarning() }}</p>
          }

          <div class="reset">
            <button matButton [disabled]="!customised()" (click)="reset()">
              Reset the {{ ui().theme }} colours
            </button>
          </div>

          <!-- The cast's own colours. They belong to the story rather than to
               the app, but this is where colours are changed, so this is where
               somebody comes looking for them. -->
          @if (cast().length) {
            <hr />
            <p class="li-hint editing">
              <strong>The cast of {{ stories.story().title }}.</strong> Each one has a colour from
              the palette, and the swatch beside their name in the chapter panel is the way to
              another of the ten. Below is the way out of the ten altogether — one colour, used in
              both themes, and yours to keep legible.
            </p>

            <div class="swatches">
              @for (character of cast(); track character.id) {
                <label class="swatch" [class.custom]="!!character.colourOverride">
                  <input
                    type="color"
                    [value]="character.colour"
                    (input)="setCharacterColour(character.id, $event)"
                  />
                  <span class="text">
                    <span class="name">{{ character.name || 'Unnamed character' }}</span>
                    <span class="li-hint">{{ character.label }}</span>
                  </span>
                  @if (character.colourOverride) {
                    <button
                      matButton
                      class="revert"
                      (click)="clearCharacterColour($event, character.id)"
                    >
                      Back to the palette
                    </button>
                  }
                </label>
              }
            </div>
          }
        </mat-expansion-panel>

        <mat-expansion-panel>
          <mat-expansion-panel-header>
            <mat-panel-title>Advanced</mat-panel-title>
            <mat-panel-description>{{ advancedSummary() }}</mat-panel-description>
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
                Once per start, the server asks GitHub which versions have been published and the
                top bar says so if one of them is newer. Switched off, it is not asked at all. Your
                stories never leave this machine either way.
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
                  Open the story on your phone while it is on the same Wi-Fi. Lamplit keeps
                  answering on this computer exactly as it did; sharing adds a second door, and the
                  code below is the key to it. Switch it off and that door is gone.
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
                        Point your phone's camera at the code. It opens Lamplit once and is
                        remembered afterwards, so this is a thing you do on a phone once.
                      </p>
                      <p class="url">
                        Afterwards the phone is at <code>{{ share.urlFor(shownAddress()) }}</code>
                      </p>
                      <button matButton [disabled]="share.busy()" (click)="newCode()">
                        New code
                      </button>
                    </div>
                  </div>
                } @else {
                  <p class="warning li-warning" role="status">
                    This computer has no network address at the moment, so there is nothing for a
                    phone to open. Join a Wi-Fi network and switch this off and on again.
                  </p>
                }

                <p class="warning li-warning">
                  <strong>A phone that has scanned the code can do everything you can here</strong>
                  — read and change every story, and read your API key, which Lamplit keeps as plain
                  text. The traffic between them is plain HTTP across your own network and is not
                  encrypted. Share on a network you trust, and use <em>New code</em> to lock out
                  every phone that has ever been paired.
                </p>

                @if (modelIsHere()) {
                  <p class="warning li-warning">
                    Your endpoint is <code>{{ connection().baseUrl }}</code
                    >, which is this computer. The story is sent to the model by the browser showing
                    it, so a phone will reach Lamplit but not the model, and writing will fail
                    there. Use an endpoint the phone can reach as well.
                  </p>
                }

                <p class="li-hint">
                  The first time you switch this on, Windows asks whether to allow Lamplit through
                  the firewall. Say yes for private networks, or the phone gets nothing.
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
                  Off, Lamplit connects straight to whichever endpoint you have given it, the same
                  as the zip and a browser tab do. Switch it on if your network only lets you out
                  through a proxy — a work laptop, usually. Lamplit's window then takes a moment to
                  find that proxy the first time it needs it, which is why it is not the default: on
                  some networks that search takes twenty seconds, and nobody should wait for it just
                  to open the app.
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
                actually sees, and adds the folder your documents are in to the About sheet. It
                changes nothing about the request itself.
              </p>
            </div>
          </div>
        </mat-expansion-panel>
      </mat-accordion>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      max-height: var(--li-sheet-height);
    }

    mat-panel-description {
      flex: none;
      color: var(--li-muted);
      font-size: var(--li-text-sm);
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-md);
      padding-bottom: var(--li-space-xs);
    }

    /* The sentence a section opens with, before its own stack of settings. */
    .lead {
      margin: 0 0 var(--li-space-lg);
    }

    /* A rule across a stack, at the stack's own gap either side of it: the
       divider groups the settings without adding a rhythm of its own. */
    hr {
      width: 100%;
      border: 0;
      border-top: 1px solid var(--li-border);
      margin: 0;
    }

    /* Whatever else the stack is holding — a note, a warning — takes its room
       from the gap and not from the browser's paragraph margin. */
    .stack > p {
      margin: 0;
    }

    /* A switch with a sentence for a label wraps, and its own text should not
       run back under the switch when it does. */
    mat-slide-toggle {
      align-items: flex-start;
    }

    .size {
      display: flex;
      flex-direction: column;
      font-size: var(--li-text-sm);
      color: var(--li-muted);
    }

    .font {
      width: 18rem;
      max-width: 100%;
    }

    /* The box is as wide as what it holds; the note under it is not, so that a
       sentence about the choice reads across the sheet rather than down it. */
    .choice select {
      width: 18rem;
      max-width: 100%;
    }

    .editing {
      margin: var(--li-space-lg) 0 var(--li-space-md);
    }

    .row-head {
      display: flex;
      align-items: baseline;
      gap: var(--li-space-sm);
      margin: var(--li-space-md) 0 var(--li-space-xs);
    }

    .row-name,
    .name {
      font-size: var(--li-text-md);
      color: var(--li-ink);
    }

    /* Said rather than implied: a preset with your own colours over it is not
       that preset any more, and Reset is the only way back to one. The ring is
       the accent's, which is what tells it from the pills that only report. */
    .tag {
      border-color: color-mix(in srgb, var(--li-accent) 45%, var(--li-border));
    }

    .palette-lead {
      margin: 0 0 var(--li-space-md);
    }

    /* Which chapter, and which palette: the one word in either sentence that
       the reader is looking for. */
    .editing strong,
    .palette-lead strong {
      color: var(--li-ink);
      font-weight: 600;
    }

    .palettes {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(5.2rem, 1fr));
      gap: var(--li-space-sm);
    }

    .palette {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--li-space-xs);
      padding: var(--li-space-xs);
      border: 0;
      border-radius: var(--li-radius-md);
      background: none;
      color: var(--li-muted);
      font: inherit;
      font-size: var(--li-text-xs);
      text-align: center;
      cursor: pointer;

      &.on {
        color: var(--li-ink);
      }
    }

    /* The ring goes round the page being chosen rather than round the tile
       holding it, and it is an outline, which is drawn outside the box and
       takes no room: every preview is the same size and on the same line
       whether it is the chosen one or not. As a border on the tile it read as
       a larger, lower object than the nine beside it. */
    .palette.on .preview {
      outline: 2px solid color-mix(in srgb, var(--li-accent) 70%, transparent);
      outline-offset: 2px;
    }

    /* A page in miniature: the tint behind, a sheet on it, two lines of story
       and the accent. Enough to tell ten of them apart at a glance. */
    .preview {
      position: relative;
      display: block;
      height: 2.9rem;
      padding: var(--li-space-xs);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-sm);
      overflow: hidden;
    }

    .sheet {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: var(--li-space-2xs);
      height: 100%;
      padding: 0 var(--li-space-xs);
      border-radius: var(--li-radius-sm);
    }

    .line {
      height: 2px;

      /* Half the height of the rule it rounds, which is what makes it a
         lozenge rather than a rectangle. Not on the radius scale: the scale's
         smallest step is larger than this whole element. */
      border-radius: 1px;
      opacity: 0.85;
    }

    .line.short {
      width: 60%;
    }

    .dot {
      position: absolute;
      right: var(--li-space-xs);
      bottom: var(--li-space-xs);
      width: 0.42rem;
      height: 0.42rem;
      border-radius: 50%;
    }

    /* The app's quiet row tint, on the two things here that are pressed. */
    .palette:hover,
    .swatch:hover {
      background: color-mix(in srgb, var(--li-ink) 5%, transparent);
    }

    .swatches {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
      gap: var(--li-space-xs) var(--li-space-lg);
    }

    /* Started rather than centred, and this is the whole of why: two
       swatches share a grid row, the hint under one of them wraps onto a
       second line and the other does not, and centring puts the two names ten
       pixels apart down a column that is meant to read as a column. */
    .swatch {
      display: flex;
      align-items: flex-start;
      gap: var(--li-space-md);
      padding: var(--li-space-xs) var(--li-space-sm);
      border: 1px solid transparent;
      border-radius: var(--li-radius-md);
      cursor: pointer;

      /* A changed colour says so, so that Reset is not the only way to tell. */
      &.custom {
        border-color: color-mix(in srgb, var(--li-accent) 45%, transparent);
      }

      &.wide {
        grid-column: 1 / -1;
      }
    }

    /* The native picker, with the browser's chrome around it pared back to a
       swatch: it is the only control here that is not Material's. */
    input[type='color'] {
      flex: none;
      width: 2.4rem;
      height: 2.4rem;
      padding: 0;
      /* Muted rather than the app's own border, which is the one place that
         rule does not hold. Page, Paper and Raised paper are within 1.2:1 of
         the paper a swatch is drawn on, and Rules is that border itself, so
         the ring is the whole of what says a swatch is there — and at 2:1 it
         left four of the eleven reading as empty boxes. Muted is over 5:1 on
         either paper, which is the contrast it is picked for everywhere
         else. */
      border: 1px solid var(--li-muted);
      border-radius: var(--li-radius-md);
      background: none;
      cursor: pointer;

      &::-webkit-color-swatch-wrapper {
        padding: 3px;
      }

      &::-webkit-color-swatch {
        border: none;
        border-radius: var(--li-radius-sm);
      }

      &::-moz-color-swatch {
        border: none;
        border-radius: var(--li-radius-sm);
      }
    }

    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .warning {
      margin: var(--li-space-md) 0 0;
    }

    .reset {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--li-space-md);
    }

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
        border-color: color-mix(in srgb, var(--li-accent) 60%, transparent);
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

    .revert {
      flex: none;
      font-size: var(--li-text-xs);
    }
  `,
})
export class PreferencesDialog {
  protected readonly settings = inject(SettingsStore);
  protected readonly stories = inject(StoryStore);
  protected readonly chapters = inject(ChapterStore);
  protected readonly share = inject(ShareStore);
  protected readonly speech = inject(ReadAloud);
  private readonly updates = inject(UpdatesStore);
  private readonly dialogs = inject(DialogsService);

  protected readonly ui = this.settings.ui;
  protected readonly connection = this.settings.connection;

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
  /** Only the desktop shell has a proxy to switch; in a tab it is the browser's. */
  protected readonly isDesktop = desktop() !== null;
  protected readonly fonts = READING_FONTS;

  /**
   * Whether the page is at the stronger contrast. Over a computed of the one
   * setting rather than over `ui()` itself, so that dragging a swatch does not
   * ask the machine the same question sixty times a second.
   */
  private readonly contrastMode = computed(() => this.ui().contrast);
  private readonly stronger = computed(() =>
    wantsContrast(document.documentElement, this.contrastMode()),
  );

  /**
   * What the stylesheet ships, for both themes.
   *
   * Only one thing moves these while the dialog is open, and it is on this
   * sheet: a contrast mode has a stronger set of rules, and a swatch showing
   * the other one would be offering the reader a colour the page is not drawn
   * in — and a Reset that returned somewhere the swatch had not said. So this
   * is a computed over that one question, and recomputes exactly when the
   * answer to it changes rather than on every drag of every other swatch.
   */
  private readonly shipped = computed(() => {
    const stronger = this.stronger();
    return new Map(
      THEME_COLOURS.flatMap(({ key }) =>
        (['dark', 'light'] as const).map(
          (theme) =>
            [
              `${theme}/${key}`,
              shippedColour(document.documentElement, key, theme, stronger),
            ] as const,
        ),
      ),
    );
  });

  /**
   * Whose page the row edits. A chapter with a palette of its own is the page
   * on screen, so a click here that quietly changed the story's instead would
   * look like it had done nothing at all.
   */
  protected readonly editingChapter = computed(() => !!this.chapters.chapter().palette);

  protected readonly currentPalette = computed(
    () => this.chapters.chapter().palette || this.ui().palette,
  );

  /** The presets, with the page as it ships in front of them. */
  protected readonly paletteOptions = computed(() => {
    const theme = this.ui().theme;
    const shipped = (key: ColourKey) => this.shipped().get(`${theme}/${key}`) || '#000000';
    return [
      {
        name: '',
        label: 'As it ships',
        title: 'The page Lamplit opens with.',
        page: shipped('page'),
        surface: shipped('surface'),
        ink: shipped('ink'),
        speech: shipped('speech'),
        accent: shipped('accent'),
      },
      ...PAGE_PALETTES.map((palette) => ({
        name: palette.name,
        label: palette.label,
        title: `${palette.description} ${palette.tags.join(', ')}.`,
        page: palette[theme].page,
        surface: palette[theme].surface,
        ink: palette[theme].ink,
        speech: palette[theme].speech,
        accent: palette[theme].accent,
      })),
    ];
  });

  protected choosePalette(name: string): void {
    if (this.editingChapter()) this.chapters.setPalette(this.chapters.chapter().id, name);
    else this.settings.setPalette(name);
  }

  /** Each colour as the page draws it now: the override, or the shipped one. */
  /** The open story's cast, each with the colour the input should show. */
  protected readonly cast = computed(() => {
    const theme = this.ui().theme;
    return this.stories.story().characters.map((character) => ({
      ...character,
      colour: characterColour(character, theme),
      label: characterColourLabel(character),
    }));
  });

  protected setCharacterColour(id: string, event: Event): void {
    this.stories.setCharacterColourOverride(id, (event.target as HTMLInputElement).value);
  }

  /** The label wraps the input, so a click on the button would open it too. */
  protected clearCharacterColour(event: Event, id: string): void {
    event.preventDefault();
    this.stories.setCharacterColourOverride(id, null);
  }

  protected readonly swatches = computed(() => {
    const { theme, colours } = this.ui();
    const overrides = colours[theme] ?? {};
    return THEME_COLOURS.map((spec) => ({
      ...spec,
      custom: !!overrides[spec.key],
      // Black is the last resort of a stylesheet that is not attached, which
      // outside a unit test does not happen; a colour input needs *some* hex.
      colour: overrides[spec.key] || this.shipped().get(`${theme}/${spec.key}`) || '#000000',
    }));
  });

  /** A colour set by hand: the state the palette row calls `custom`. */
  protected readonly customised = computed(() => this.swatches().some((s) => s.custom));

  /**
   * The three states, in the order a reader meets them: what they already have,
   * then the two ways of saying otherwise. The labels say *computer* and not
   * *system*, which is the word the rest of the app avoids.
   */
  protected readonly contrasts: readonly { key: ContrastMode; label: string }[] = [
    { key: 'system', label: 'Follow my computer' },
    { key: 'high', label: 'Always stronger' },
    { key: 'normal', label: 'Always as it ships' },
  ];

  /** Two, not three; `MotionMode` is where the missing one is accounted for. */
  protected readonly motions: readonly { key: MotionMode; label: string }[] = [
    { key: 'system', label: 'Follow my computer' },
    { key: 'reduced', label: 'Always still' },
  ];

  protected setContrast(mode: string): void {
    this.settings.patchUi({ contrast: mode as ContrastMode });
  }

  protected setMotion(mode: string): void {
    this.settings.patchUi({ motion: mode as MotionMode });
  }

  /**
   * What the folded panel says. Nothing about the machine's own answer, which
   * this cannot see through the media query and which is not a setting anybody
   * made here — the summary is what this panel has been told to do.
   */
  protected readonly accessibilitySummary = computed(() => {
    const ui = this.ui();
    const said: string[] = [];
    if (ui.contrast === 'high') said.push('stronger contrast');
    if (ui.contrast === 'normal') said.push('contrast as it ships');
    if (ui.motion === 'reduced') said.push('nothing moves');
    return said.length ? said.join(', ') : 'following your computer';
  });

  protected readonly advancedSummary = computed(() => {
    const ui = this.ui();
    // Sharing first: it is the only thing in here that changes who can reach
    // the writing, so it is the one worth reading off a folded panel.
    if (this.share.on()) return 'shared on this network';
    if (ui.developerMode) return 'developer mode on';
    return ui.checkForUpdates ? 'checking for new versions' : 'not checking for new versions';
  });

  protected readonly rate = SPEECH_RATE;

  /** `1.15x`, and `1x` rather than `1.00x` for the pace the voice ships with. */
  protected readonly rateLabel = (value: number) => `${Number(value.toFixed(2))}x`;

  protected readonly readingSummary = computed(() => {
    const ui = this.ui();
    // The face only when it is not the one the app ships in, which is the same
    // test `applyUi` makes before it writes the property at all.
    const font = READING_FONTS.find((f) => f.key === ui.font);
    const face = font && font !== READING_FONTS[0] ? `, ${font.label.toLowerCase()}` : '';
    const aloud = ui.readAloud ? ', read aloud' : '';
    return `${ui.theme} theme, ${ui.fontSize}px${face}${aloud}`;
  });

  protected readonly coloursSummary = computed(() => {
    const changed = this.swatches().filter((s) => s.custom).length;
    if (changed) return `${changed} changed in ${this.ui().theme}`;
    return this.currentPalette()
      ? paletteLabel(this.currentPalette()).toLowerCase()
      : 'as it ships';
  });

  /**
   * Text on paper, which is the pair a reader loses the story over. A warning
   * and not a block: someone deliberately setting a low-contrast palette is
   * allowed to, they just should not do it by accident.
   */
  protected readonly contrastWarning = computed(() => {
    const swatches = this.swatches();
    const ink = swatches.find((s) => s.key === 'ink')?.colour ?? '';
    const paper = swatches.find((s) => s.key === 'surface')?.colour ?? '';
    const ratio = contrastRatio(ink, paper);
    if (Number.isNaN(ratio) || ratio >= AA_CONTRAST) return '';
    return (
      `Text on paper is ${ratio.toFixed(1)}:1, under the ${AA_CONTRAST}:1 that WCAG AA asks of ` +
      `body text. Nothing stops you — but this is the one pair the whole story is read in.`
    );
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

  protected setColour(key: ColourKey, event: Event): void {
    const colour = (event.target as HTMLInputElement).value;
    this.settings.setColour(this.ui().theme, key, colour);
  }

  protected value(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  /** A select hands back a string; these three are the whole of what it can be. */
  protected setFont(font: string): void {
    this.settings.patchUi({ font: font as ReadingFont });
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

  protected async reset(): Promise<void> {
    const theme = this.ui().theme;
    const ok = await this.dialogs.confirm({
      title: `Put the ${theme} colours back?`,
      message: `Every colour you have changed in the ${theme} theme returns to the one underneath — the palette you picked, or what Lamplit ships. The other theme keeps yours.`,
      confirm: 'Reset',
    });
    if (ok) this.settings.resetColours(theme);
  }
}
