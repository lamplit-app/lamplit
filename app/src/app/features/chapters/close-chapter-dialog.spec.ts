import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { CloseChapterDialog } from './close-chapter-dialog';
import { ChapterRequests } from '../../store/chapter-requests';
import { ChapterStore } from '../../store/chapter-store';
import { StoryStore } from '../../store/story-store';
import { Chapter, Story } from '../../core/models';

/**
 * Closing a chapter asks the model to summarise it, and the sheet lets that be
 * stopped and asked again. Aborting resolves rather than throws, so a stopped
 * request still comes back — after the next one has started — which is the
 * whole of what these tests are about.
 */

/** A summary request the test finishes by hand, whenever it likes. */
interface Pending {
  deltas: (text: string) => void;
  finish: (result: { text: string; error?: string }) => void;
}

/** The chapter being closed, which is all the sheet asks the store for. */
class FakeChapters {
  readonly chapter = signal({ id: 'c1', number: 3, title: '', scene: 'A scene.' } as Chapter);
}

/** The two requests closing a chapter makes, neither of them finished yet. */
class FakeRequests {
  readonly pending: Pending[] = [];

  /**
   * Takes the deltas and hands back a promise the test finishes by hand. The
   * abort signal the sheet passes is not read: what is under test is what the
   * sheet does with an answer that comes back after it stopped caring.
   */
  summarise = (onDelta: (text: string) => void): Promise<{ text: string; error?: string }> =>
    new Promise((fulfil) => this.pending.push({ deltas: onDelta, finish: fulfil }));

  proposeLore = () => Promise.resolve({ proposals: [] });
}

class FakeStories {
  readonly story = signal({
    world: { summary: { useDefault: true, prompt: '' }, extractLore: false },
  } as Story);
  setSummaryPrompt = () => undefined;
}

describe('CloseChapterDialog', () => {
  let requests: FakeRequests;

  beforeEach(() => {
    requests = new FakeRequests();
    TestBed.configureTestingModule({
      providers: [
        { provide: ChapterStore, useValue: new FakeChapters() },
        { provide: ChapterRequests, useValue: requests },
        { provide: StoryStore, useValue: new FakeStories() },
        { provide: MatDialogRef, useValue: { close: () => undefined } },
      ],
    });
  });

  function open(): ReturnType<typeof TestBed.createComponent<CloseChapterDialog>> {
    const fixture = TestBed.createComponent(CloseChapterDialog);
    fixture.detectChanges();
    return fixture;
  }

  function click(
    fixture: ReturnType<typeof TestBed.createComponent<CloseChapterDialog>>,
    name: string,
  ): void {
    const host = fixture.nativeElement as HTMLElement;
    const button = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === name,
    );
    if (!button) throw new Error(`no button called ${name}`);
    button.click();
    fixture.detectChanges();
  }

  function text(fixture: ReturnType<typeof TestBed.createComponent<CloseChapterDialog>>): string {
    const host = fixture.nativeElement as HTMLElement;
    return host.querySelector('textarea')?.value ?? '';
  }

  it('writes a summary as it arrives', async () => {
    const fixture = open();
    expect(requests.pending).toHaveLength(1);

    requests.pending[0].deltas('The keeper went up ');
    requests.pending[0].deltas('the stairs.');
    requests.pending[0].finish({ text: 'The keeper went up the stairs.' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toBe('The keeper went up the stairs.');
  });

  it('ignores the request it was told to stop, however late it answers', async () => {
    const fixture = open();
    requests.pending[0].deltas('An abandoned ');

    click(fixture, 'Stop');
    click(fixture, 'Write it again');
    expect(requests.pending).toHaveLength(2);

    // The second request is under way and says so.
    requests.pending[1].deltas('The one that counts.');
    await fixture.whenStable();
    fixture.detectChanges();

    // Only now does the stopped one come back, as an abort always does.
    requests.pending[0].finish({ text: 'An abandoned attempt.' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toBe('The one that counts.');
    // And the sheet still knows it is waiting for the second one.
    const host = fixture.nativeElement as HTMLElement;
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent.trim());
    expect(labels).toContain('Stop');
    expect(labels).not.toContain('Write it again');
  });

  it('ignores the deltas of a stopped request as well as its answer', async () => {
    const fixture = open();
    click(fixture, 'Stop');
    click(fixture, 'Write it again');

    requests.pending[1].deltas('The one that counts.');
    requests.pending[0].deltas(' and some late words');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toBe('The one that counts.');
  });
});
