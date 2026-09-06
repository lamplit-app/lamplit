import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Layout } from '../core/layout';
import { chapterTitle } from '../core/prompt-builder';
import { SettingsStore } from '../store/settings-store';
import { ChapterStore } from '../store/chapter-store';
import { StoryStore } from '../store/story-store';
import { UpdatesStore } from '../store/updates-store';
import { DialogsService } from './dialogs.service';
import { ReadAloud } from './read-aloud.service';
import { SaveStatusIndicator } from './save-status';

/**
 * The one bar that is always there: which story and chapter are open, which
 * model is answering, and the way into everything that opens over the page.
 *
 * Two halves, and each half says one thing. Left is where you are: the wordmark
 * and story · chapter. Right is two clusters — the state of things, drawn as
 * statuses and each one the way into what it reports (the save dot, the update
 * pill, the model and its dot), and then the story itself, which is Story,
 * World, Chapters and ⋯ for what is left.
 *
 * The named buttons are three because three of them are about what is being
 * written. Parameters is how the model is asked to write and belongs to the
 * model, which carries it; Preferences is the app being set up rather than the
 * story being written and is behind ⋯ with About, where the rest of the app is.
 *
 * On a phone the bar is three things and no more — the wordmark, the save dot
 * and one menu — because the bar is the only furniture on a screen whose whole
 * purpose is the story under it. What the menu drops there is not arbitrary:
 * Preferences, the model and About are the app being set up rather than the
 * story being written, and they were set up on the computer that is serving
 * this page. The four that stay — Story, World, Chapters, and the chapter panel
 * — are the story itself.
 */
@Component({
  selector: 'li-top-bar',
  imports: [MatButtonModule, MatMenuModule, MatTooltipModule, SaveStatusIndicator],
  template: `
    <header class="bar">
      <div class="identity">
        <span class="wordmark">Lamplit</span>
        <!-- The one thing in the bar that says where you are. On a phone there
             is no room for it to say it, so it says what this is instead and
             the menu it opens does the rest. -->
        <button matButton class="here li-truncates" [matMenuTriggerFor]="storiesMenu">
          @if (layout.phone()) {
            <span class="mark">Lamplit</span>
          } @else {
            <span class="label">
              <span class="story">{{ stories.story().title }}</span
              >&ngsp;·&ngsp;<span class="chapter">{{ chapterLabel() }}</span>
            </span>
          }
        </button>
        <mat-menu #storiesMenu="matMenu">
          <!-- The bar has no room to say where you are, so the tap that offers
               the other stories says it first. -->
          @if (layout.phone()) {
            <div class="where" role="presentation">
              <span class="story">{{ stories.story().title }}</span>
              <span class="chapter">{{ chapterLabel() }}</span>
            </div>
            <hr />
          }
          @for (story of stories.stories(); track story.id) {
            <button mat-menu-item (click)="stories.select(story.id)">
              {{ story.id === stories.story().id ? '• ' : '' }}{{ story.title }}
            </button>
          }
          <hr />
          <button mat-menu-item (click)="dialogs.newStory()">New story…</button>
          <button mat-menu-item (click)="rename()">Rename…</button>
          <button mat-menu-item (click)="stories.duplicate(stories.story().id)">Duplicate</button>
          <button mat-menu-item (click)="remove()">Delete story…</button>
        </mat-menu>
      </div>

      <div class="actions">
        <li-save-status />

        @if (!layout.phone()) {
          <!-- Quiet on purpose: a newer Lamplit exists, and that is all. No
               modal, no banner, nothing over the page being written. -->
          @if (updates.available(); as release) {
            <button
              class="li-pill available"
              type="button"
              (click)="dialogs.openWhatsNew()"
              matTooltip="Read what changed in it"
            >
              {{ release.version }} available
            </button>
          }

          <button
            matButton
            class="model li-truncates"
            [class.unset]="!settings.isConnected()"
            (click)="dialogs.openModel()"
            [matTooltip]="modelTooltip()"
          >
            <span class="dot" [class.live]="settings.isConnected()"></span>
            {{ modelLabel() }}
          </button>

          <button matButton (click)="dialogs.openStory()">Story</button>
          <button matButton (click)="dialogs.openWorld()">World</button>
          <button matButton (click)="dialogs.openChapters()">Chapters</button>
        }

        <button matButton [matMenuTriggerFor]="more" aria-label="More actions">⋯</button>
        <mat-menu #more="matMenu">
          <!-- The four names the phone's bar has nowhere to put. Everything
               under them is about this chapter and is offered at every width. -->
          @if (layout.phone()) {
            <button mat-menu-item (click)="dialogs.openStory()">Story…</button>
            <button mat-menu-item (click)="dialogs.openWorld()">World…</button>
            <button mat-menu-item (click)="dialogs.openChapters()">Chapters…</button>
            <button mat-menu-item (click)="settings.setSidebarOpen(true)">Chapter panel</button>
            <!-- The one setting the phone does keep, because it is about
                 listening to this story rather than about the app: a phone
                 propped up across the room reads each reply as it lands. -->
            @if (speech.supported) {
              <button mat-menu-item (click)="speech.toggleAutomatic()">
                {{ speech.automatic() ? '✓ ' : '' }}Read replies aloud
              </button>
            }
            <hr />
          }
          <button mat-menu-item (click)="dialogs.newChapter()">New chapter…</button>
          <button mat-menu-item (click)="dialogs.openScene(chapters.chapter().id)">
            Edit this scene…
          </button>
          <button mat-menu-item [disabled]="chapters.isEmpty()" (click)="clear()">
            Clear this chapter
          </button>
          @if (!layout.phone()) {
            <hr />
            <!-- The app being set up, rather than the story being written. It
                 was a word on the bar beside the three about the story; it is a
                 click further away now, and takes the key every editor gives
                 its settings to make that back. -->
            <button mat-menu-item (click)="dialogs.openPreferences()">
              <span class="item">Preferences…<span class="shortcut">Ctrl+,</span></span>
            </button>
            <hr />
            <button mat-menu-item (click)="dialogs.openAbout()">About Lamplit…</button>
          }
        </mat-menu>
      </div>
    </header>
  `,
  styles: `
    @use '../../breakpoints' as bp;

    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--li-space-lg);
      height: 3.25rem;
      padding: 0 var(--li-space-md) 0 var(--li-space-lg);
      border-bottom: 1px solid var(--li-border);
      background: color-mix(in srgb, var(--li-surface) 82%, transparent);
      backdrop-filter: blur(10px);
    }

    /* Under a notch, or beside one in landscape: the bar is the top of the
       page, so it is the thing that pays for reaching into it. */
    @include bp.phone {
      .bar {
        height: calc(3rem + env(safe-area-inset-top));
        padding: env(safe-area-inset-top) calc(var(--li-space-xs) + env(safe-area-inset-right)) 0
          calc(var(--li-space-sm) + env(safe-area-inset-left));
      }
    }

    .identity {
      display: flex;
      align-items: center;
      gap: var(--li-space-sm);
      min-width: 0;
      overflow: hidden;
    }

    /* The wordmark, whether it is standing on its own or being carried by the
       button — which is what the phone layout does with it. */
    .wordmark,
    .mark {
      flex: none;
      font-family: var(--li-serif);
      font-size: var(--li-text-lg);
      letter-spacing: 0.01em;
      white-space: nowrap;
      color: var(--li-ink);
    }

    /* Material centres a button's label, which would spill it over the
       wordmark: one flex child, started at the left edge, clipped here.

       And Material gives every button a flex-shrink of nought, which is half
       of why a long title used to stop mid-word: the button kept its full width
       whatever the bar had left, and the identity around it cut the overflow
       off with a hard edge, having no ellipsis to give. Letting the button give
       up width is this half; li-truncates, in styles.scss, is the other. */
    .here {
      display: flex;
      justify-content: flex-start;
      overflow: hidden;
      flex-shrink: 1;
      min-width: 0;
      max-width: 36rem;
    }

    /* Where the tap says you are, when the bar has no room to. */
    .where {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-3xs);
      padding: var(--li-space-sm) var(--li-space-lg) var(--li-space-xs);
      max-width: 16rem;
    }

    .where .story,
    .where .chapter {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    /* One line that ellipsises as a whole: story first, chapter trimmed. */
    .label {
      display: block;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: var(--li-muted);
    }

    .story {
      font-family: var(--li-serif);
      font-size: var(--li-text-lg);
      color: var(--li-ink);
    }

    .chapter {
      font-size: var(--li-text-md);
    }

    .actions {
      flex: none;
      display: flex;
      align-items: center;
      gap: var(--li-space-3xs);
    }

    /* Narrow windows keep the story and the model; the wordmark can go. And on
       a phone it is the other way round — the story and the chapter move into
       the menu, and the button carries the wordmark itself — so this span,
       standing on its own beside it, is gone at both widths. */
    @include bp.without-wordmark {
      .wordmark {
        display: none;
      }
    }

    /* Long enough for a name and no longer, because the named buttons after it
       are what the bar is for. li-truncates is what ends a longer name in an
       ellipsis rather than mid-word. Two of those buttons went, so this and the
       cap on .here above both take a share of what they were using. */
    .model {
      max-width: 19rem;
    }

    .model.unset {
      color: var(--li-accent);
    }

    .dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-right: var(--li-space-sm);
      border-radius: 50%;
      background: var(--li-muted);
    }

    .dot.live {
      background: var(--li-success);
    }

    .available {
      flex: none;
      margin-right: var(--li-space-xs);
      color: var(--li-accent);
      border-color: color-mix(in srgb, var(--li-accent) 45%, var(--li-border));
      background: color-mix(in srgb, var(--li-accent) 10%, var(--li-surface));
    }

    .available:hover {
      background: color-mix(in srgb, var(--li-accent) 18%, var(--li-surface));
    }

    /* A name on the left and the keys that do the same thing on the right, the
       way every editor's menu writes it. The row Material draws is a flex box
       with the label span filling it, so the two ends are set inside that. */
    .item {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--li-space-xl);
    }

    .shortcut {
      font-size: var(--li-text-xs);
      color: var(--li-muted);
    }

    hr {
      border: 0;
      border-top: 1px solid var(--li-border);
      margin: var(--li-space-2xs) 0;
    }
  `,
})
export class TopBar {
  protected readonly layout = inject(Layout);
  protected readonly settings = inject(SettingsStore);
  protected readonly stories = inject(StoryStore);
  protected readonly chapters = inject(ChapterStore);
  protected readonly updates = inject(UpdatesStore);
  protected readonly dialogs = inject(DialogsService);
  protected readonly speech = inject(ReadAloud);

  protected readonly chapterLabel = computed(() => {
    const chapter = this.chapters.chapter();
    const title = chapterTitle(chapter);
    return `Chapter ${chapter.number}${title ? ` — ${title}` : ''}`;
  });

  protected readonly modelLabel = computed(() => {
    const connection = this.settings.connection();
    if (!connection.model) return 'Connect a model';
    const known = connection.modelsCache.find((m) => m.id === connection.model);
    return known?.name ?? shortModelId(connection.model);
  });

  /**
   * What is behind the name, not only what the name is. It was the URL alone,
   * which reads as a label; the rest says that the sheet it opens is where both
   * the endpoint and the way the model is asked are kept.
   */
  protected readonly modelTooltip = computed(() => {
    const hint = this.settings.connectionHint();
    if (hint) return hint;
    return `${this.settings.connection().baseUrl} — the connection and its parameters (Ctrl+K)`;
  });

  protected async rename(): Promise<void> {
    const title = await this.dialogs.askText({
      title: 'Rename story',
      label: 'Title',
      value: this.stories.story().title,
    });
    if (title) this.stories.patch({ title });
  }

  protected async remove(): Promise<void> {
    const story = this.stories.story();
    const ok = await this.dialogs.confirm({
      title: `Delete “${story.title}”?`,
      message: 'Every chapter of this story goes with it, and none of it can be brought back.',
      danger: true,
    });
    if (ok) this.stories.delete(story.id);
  }

  protected async clear(): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Clear this chapter?',
      message: 'Every message in it goes; the scene stays, and the chapter stays.',
      confirm: 'Clear',
      danger: true,
    });
    if (ok) this.chapters.clearMessages();
  }
}

/** `provider/family/model-name` reads better as just the last segment. */
function shortModelId(id: string): string {
  const parts = id.split('/');
  return parts[parts.length - 1] || id;
}
