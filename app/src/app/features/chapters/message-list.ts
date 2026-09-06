import { Component, computed, inject } from '@angular/core';
import { speakerLabels } from '../../core/speakers';
import { ReadAloud } from '../../shared/read-aloud.service';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { StoryStore } from '../../store/story-store';
import { MessageItem } from './message-item';

/**
 * The written turns, and nothing about scrolling.
 *
 * There is one scrollport on the page and `chapters-page` owns it, because the
 * toolbar and the composer are in it too — this is the part of it that is the
 * story.
 */
@Component({
  selector: 'li-message-list',
  imports: [MessageItem],
  template: `
    <div class="column">
      <!-- The written turns, not every row: a record of the cast changing is
           in the list so the prompt knows where it happened, not to be read. -->
      @for (message of chapters.written(); track message.id) {
        <li-message-item
          [message]="message"
          [streaming]="chapters.streamingId() === message.id"
          [busy]="chapters.isStreaming()"
          [bookStyle]="settings.ui().bookStyleDialogue"
          [showTokens]="settings.ui().showTokenCounts"
          [speaker]="speakers().get(message.id) ?? null"
          [canListen]="speech.supported"
          [listening]="speech.speakingId() === message.id"
          (edited)="chapters.editMessage(message.id, $event.content, $event.direction)"
          (remove)="chapters.deleteMessage(message.id)"
          (regenerate)="chapters.regenerate(message.id)"
          (replay)="chapters.replayFrom(message.id)"
          (listen)="speech.toggleMessage(message)"
          (setContext)="settings.patchGeneration({ maxContextTokens: $event })"
        />
      }
      <div class="tail"></div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .column {
      width: var(--li-column);
      margin: 0 auto;
      padding: var(--li-space-lg) 0 0;
    }

    .tail {
      height: 1.5rem;
    }
  `,
})
export class MessageList {
  protected readonly chapters = inject(ChapterStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly speech = inject(ReadAloud);
  private readonly stories = inject(StoryStore);

  /**
   * Worked out over the whole list rather than per message, because whether a
   * turn is labelled depends on the one before it — and on the cast records
   * between them, which the page itself does not show.
   */
  protected readonly speakers = computed(() =>
    speakerLabels(this.stories.story(), this.chapters.messages(), this.settings.ui().theme),
  );
}
