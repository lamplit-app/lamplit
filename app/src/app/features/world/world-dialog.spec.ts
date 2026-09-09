import { ANIMATION_MODULE_TYPE } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldDialog } from './world-dialog';
import { LoreEntry } from '../../core/models';
import { ModelClient } from '../../core/model-client';
import { StoryStore } from '../../store/story-store';
import { KEYS } from '../../store/documents';
import { STORAGE_BACKEND } from '../../store/storage';
import { InMemoryStorage } from '../../store/testing/in-memory-storage';

const STORY_ID = 'story-1';

function lore(patch: Partial<LoreEntry>): LoreEntry {
  return {
    id: 'lore',
    title: '',
    category: 'fact',
    keys: [],
    content: 'Something true.',
    enabled: true,
    alwaysOn: false,
    ...patch,
  };
}

const ENTRIES = [
  lore({ id: 'keeper', title: 'Tomas the keeper', category: 'person', keys: ['tomas', 'old man'] }),
  lore({ id: 'sister', title: 'His sister', category: 'person', keys: ['ines'] }),
  lore({ id: 'light', title: 'The lighthouse', category: 'place', keys: ['light', 'tower'] }),
];

/**
 * A world of any size is unreadable without the search, and the search is the
 * only way to reach an entry that is not on screen — so what it matches is
 * what can be edited at all. The rest of this is the arithmetic between a
 * typed field and a stored document: keys are a line of text on one side and a
 * list on the other, and the scan depth is a number that must not go negative.
 */
describe('WorldDialog', () => {
  let storage: InMemoryStorage;
  let fixture: ReturnType<typeof TestBed.createComponent<WorldDialog>>;

  const stories = () => TestBed.inject(StoryStore);
  const world = () => stories().story().world;
  const host = () => fixture.nativeElement as HTMLElement;

  function seed(entries: LoreEntry[]): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
      activeStoryId: STORY_ID,
    });
    storage.write(KEYS.story(STORY_ID), {
      id: STORY_ID,
      title: 'The Lamplighter',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: 'chapter-1',
      chapterCounter: 1,
      world: {
        storySoFar: '',
        summary: { useDefault: true, prompt: '' },
        entries,
        scan: { depth: 6, caseSensitive: false, matchWholeWords: true },
        extractLore: false,
      },
    });
    storage.write(KEYS.chapter('chapter-1'), {
      id: 'chapter-1',
      storyId: STORY_ID,
      number: 1,
      title: '',
      scene: 'A scene.',
      status: 'writing',
      summary: '',
      messages: [],
    });
  }

  /** Opens the sheet on the Lore tab, which is where all of this lives. */
  function open(entries: LoreEntry[] = ENTRIES): void {
    seed(entries);
    fixture = TestBed.createComponent(WorldDialog);
    fixture.detectChanges();
    const tab = [...host().querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (candidate) => candidate.textContent.trim() === 'Lore',
    );
    if (!tab) throw new Error('the sheet has no Lore tab');
    tab.click();
    fixture.detectChanges();
  }

  /** The names of the entries the list is showing, in the order it shows them. */
  function listed(): string[] {
    return [...host().querySelectorAll('.entry .name')].map((name) => name.textContent.trim());
  }

  function search(text: string): void {
    const box = host().querySelector<HTMLInputElement>('.search input')!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Puts an entry's own fields on screen, the way the caret button does. */
  function reveal(title: string): void {
    const row = [...host().querySelectorAll('.entry')].find(
      (entry) => entry.querySelector('.name')?.textContent.trim() === title,
    );
    if (!row) throw new Error(`no entry called ${title}`);
    row.querySelector<HTMLButtonElement>('.disclose')!.click();
    fixture.detectChanges();
  }

  /** The field of an open entry that is showing this text. */
  function fieldShowing(text: string): HTMLInputElement {
    const found = [...host().querySelectorAll<HTMLInputElement>('.entry input')].find(
      (input) => input.value === text,
    );
    if (!found) throw new Error(`no field showing ${text}`);
    return found;
  }

  function commit(box: HTMLInputElement, text: string): void {
    box.value = text;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [
        { provide: STORAGE_BACKEND, useValue: storage },
        { provide: ModelClient, useValue: { chatJson: vi.fn(), streamChat: vi.fn() } },
        // Without this the tab body waits on a transition that jsdom will
        // never run, and the Lore tab is never put on the page at all.
        { provide: ANIMATION_MODULE_TYPE, useValue: 'NoopAnimations' },
      ],
    });
  });

  it('shows every entry, under the kind it is', () => {
    open();
    expect(listed()).toEqual(['Tomas the keeper', 'His sister', 'The lighthouse']);
    expect([...host().querySelectorAll('h3')].map((heading) => heading.textContent.trim())).toEqual(
      ['People', 'Places'],
    );
  });

  it('finds an entry by its title, whatever case it was typed in', () => {
    open();
    search('LIGHTHOUSE');
    expect(listed()).toEqual(['The lighthouse']);
  });

  it('finds an entry by a key, which the row does not show', () => {
    open();
    search('ines');
    expect(listed()).toEqual(['His sister']);
  });

  it('says so rather than looking empty when nothing matches', () => {
    open();
    search('the sea');

    expect(listed()).toEqual([]);
    expect(host().textContent).toContain('Nothing matches that search.');
  });

  it('says something else again when there is no lore at all', () => {
    open([]);
    expect(host().textContent).toContain('No lore yet.');
  });

  it('clears the search when an entry is added, so the new one can be seen', () => {
    open();
    search('lighthouse');

    const add = [...host().querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent.trim() === 'Add an entry',
    )!;
    add.click();
    fixture.detectChanges();
    // By role rather than by the menu item's own class name, which is private
    // to Material and two renames deep; `menuitem` is what the menu promises
    // anyone reading it, this spec included.
    const place = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent.trim() === 'Place',
    )!;
    place.click();
    fixture.detectChanges();

    expect(host().querySelector<HTMLInputElement>('.search input')!.value).toBe('');
    expect(listed()).toContain('Untitled entry');
  });

  it('reads a line of keys as the list of keys it looks like', () => {
    open();
    reveal('Tomas the keeper');

    commit(fieldShowing('tomas, old man'), ' tomas ,keeper,, the old man ,  ');

    expect(world().entries[0].keys).toEqual(['tomas', 'keeper', 'the old man']);
  });

  it('reads an emptied key line as no keys at all', () => {
    open();
    reveal('His sister');

    commit(fieldShowing('ines'), '  ,  , ');

    expect(world().entries[1].keys).toEqual([]);
  });

  it('keeps the scan depth a whole number of messages, and never below none', () => {
    open();
    const depth = host().querySelector<HTMLInputElement>('.depth input')!;

    commit(depth, '3.7');
    expect(world().scan.depth).toBe(3);

    commit(depth, '-4');
    expect(world().scan.depth).toBe(0);

    // Nothing at all is not a depth; the one that was there stays.
    commit(depth, '');
    expect(world().scan.depth).toBe(0);
  });

  it('puts a duplicate under the entry it was made from, and says it is one', () => {
    open();
    stories().duplicateLore('keeper');
    fixture.detectChanges();

    expect(listed()).toEqual([
      'Tomas the keeper',
      'Tomas the keeper (copy)',
      'His sister',
      'The lighthouse',
    ]);
    const [source, copy] = world().entries;
    expect(copy.id).not.toBe(source.id);
    expect(copy.keys).toEqual(source.keys);

    // Its own entry, not a second name for the first one.
    stories().patchLore(copy.id, { content: 'Rewritten.' });
    expect(world().entries[0].content).toBe('Something true.');
  });
});
