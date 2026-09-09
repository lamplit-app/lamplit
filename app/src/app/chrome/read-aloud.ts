import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ChapterMessage } from '../core/models';
import { speechPieces, spokenText } from '../core/reading-aloud';
import { announcedName } from '../core/speakers';
import { ChapterStore } from '../store/chapter-store';
import { SettingsStore } from '../store/settings-store';
import { StoryStore } from '../store/story-store';

/** A voice the device has, as much of one as anything here needs to know. */
export interface VoiceChoice {
  name: string;
  lang: string;
}

/**
 * Reading the story out loud, with the voice the device already has.
 *
 * The whole of it is `speechSynthesis`: no request leaves the machine, no key
 * is spent, and there is no service to be down. What that buys in privacy it
 * costs in consistency — the voices are the ones this particular phone or
 * laptop ships with, which is why the chosen voice is stored by name and an
 * unknown name is simply the device's own default rather than an error.
 *
 * Two ways in, and they are different acts. **Listen** on a message reads that
 * message because it was asked for. **Read replies aloud** reads each new
 * reply as it finishes, which is the phone propped against something across
 * the room. Either way only one thing is ever being said: a new reading stops
 * whatever was being read, and so does a new turn starting.
 */
@Injectable({ providedIn: 'root' })
export class ReadAloud {
  private readonly settings = inject(SettingsStore);
  private readonly chapters = inject(ChapterStore);
  private readonly stories = inject(StoryStore);

  /**
   * Whether this browser can speak at all. Every desktop browser and both
   * phone browsers can; a headless one may not, and the buttons are simply not
   * offered where it cannot rather than failing when they are pressed.
   */
  readonly supported = typeof speechSynthesis !== 'undefined';

  /** The voices the device offers, for the picker in Preferences. */
  readonly voices = signal<VoiceChoice[]>([]);

  /** The message being read, or null. The buttons say Stop while it is theirs. */
  readonly speakingId = signal<string | null>(null);

  /** Whether each new reply is read as it finishes. */
  readonly automatic = computed(() => this.settings.ui().readAloud);

  /** What is left to say of the message being read, piece by piece. */
  private queue: string[] = [];
  private available: SpeechSynthesisVoice[] = [];

  constructor() {
    if (this.supported) {
      this.loadVoices();
      // A voice outlives the page that started it: close the tab mid-reading
      // and Chrome carries on talking to an empty room, with nothing left on
      // screen to press. Leaving is the same as pressing stop.
      addEventListener('pagehide', () => this.stop());
    }
    this.followTheChapter();
  }

  /**
   * Read this message, or stop if it is the one already being read — the same
   * press, twice, the way every play button works.
   */
  toggleMessage(message: ChapterMessage): void {
    if (this.speakingId() === message.id) {
      this.stop();
      return;
    }
    this.read(message);
  }

  /** Reading replies as they arrive, on or off. Off stops what is being said. */
  toggleAutomatic(): void {
    const on = !this.automatic();
    this.settings.patchUi({ readAloud: on });
    if (!on) this.stop();
  }

  stop(): void {
    this.queue = [];
    this.speakingId.set(null);
    if (this.supported) speechSynthesis.cancel();
  }

  /**
   * The text of a message, said in the chosen voice.
   *
   * Nothing is spoken for a message with no words in it — a turn that failed,
   * or one that is nothing but an author's direction, which is an instruction
   * to the model and was never part of the story to begin with.
   */
  private read(message: ChapterMessage): void {
    if (!this.supported) return;
    const text = spokenText(message.content, announcedName(this.stories.story(), message));
    if (!text) return;

    this.stop();
    this.queue = speechPieces(text);
    this.speakingId.set(message.id);
    this.sayNext();
  }

  /**
   * One piece, and the next when it ends.
   *
   * Queued one at a time rather than all at once so that the end of the last
   * piece is the end of the reading — `speechSynthesis` has no event for "the
   * queue is empty", and an `onend` per utterance is the only thing that says
   * anything at all. `onerror` is treated as an end for the same reason: a
   * voice that fails halfway must not leave the button saying Stop for ever.
   */
  private sayNext(): void {
    const piece = this.queue.shift();
    if (piece === undefined) {
      this.speakingId.set(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(piece);
    const ui = this.settings.ui();
    const chosen = this.available.find((voice) => voice.name === ui.voice);
    if (chosen) utterance.voice = chosen;
    utterance.rate = ui.speechRate;
    utterance.onend = () => this.sayNext();
    utterance.onerror = () => this.sayNext();
    speechSynthesis.speak(utterance);
  }

  /**
   * The list of voices arrives late in every browser that has more than the
   * one built in — `getVoices()` is empty on the first call and the event is
   * how the rest turn up. Asked for once here and kept, because Preferences is
   * opened long after this.
   */
  private loadVoices(): void {
    const take = () => {
      this.available = speechSynthesis.getVoices();
      this.voices.set(this.available.map(({ name, lang }) => ({ name, lang })));
    };
    take();
    speechSynthesis.addEventListener('voiceschanged', take);
  }

  /**
   * A turn starting silences whatever was being read, and a reply finishing is
   * what "read replies aloud" is waiting for.
   *
   * Watching `streamingId` rather than the messages themselves is what keeps
   * this cheap: it changes twice a turn, where the message under it changes on
   * every delta. The message is read once the id has gone, so what is spoken
   * is the finished answer and not a race with the last of it.
   */
  private followTheChapter(): void {
    let streaming: string | null = untracked(this.chapters.streamingId);
    effect(() => {
      const now = this.chapters.streamingId();
      const finished = streaming && !now ? streaming : null;
      const started = !streaming && now;
      streaming = now;

      untracked(() => {
        // Whatever was being read is about to be out of date, or is about to be
        // read over by the reply now arriving.
        if (started || finished) this.stop();
        if (!finished || !this.automatic()) return;

        const message = this.chapters.messages().find((m) => m.id === finished);
        // Not a turn that failed, and not one the reader stopped: both of those
        // are the app reporting itself, and neither is the story.
        if (!message || message.meta?.error || message.meta?.aborted) return;
        this.read(message);
      });
    });
  }
}
