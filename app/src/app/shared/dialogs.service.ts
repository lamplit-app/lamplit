import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { DEFAULT_STORY_TITLE } from '../core/defaults';
import { ChapterStore } from '../store/chapter-store';
import { StoryStore } from '../store/story-store';
import type { ChapterClose } from '../features/chapters/close-chapter-dialog';
import type { NewStoryData, StorySetup } from '../features/story/new-story-dialog';
import { ConfirmData, TextPromptData } from './small-dialogs';

/**
 * How wide a sheet is, as four steps.
 *
 * It was twelve openers writing seven different `rem` widths — 30, 34, 38, 40,
 * 42, 44 and 46 — which is to say that three of those numbers existed only
 * because somebody typed a width rather than picking one. A note is narrow, a
 * form is a little wider, a sheet you work in is as wide as a paragraph of
 * prose, and the widest are the ones with tabs or a whole prompt to show.
 */
const SHEET_WIDTHS = {
  sm: '30rem',
  md: '34rem',
  lg: '42rem',
  xl: '46rem',
} as const;

/**
 * The three things a sheet says for itself: what it is handed, where focus
 * lands if not on the sheet, and whether it can be dismissed at all. Named as
 * the fields of Material's own config so that reading one is reading the other
 * — picked out of it rather than taken whole, because the rest of that config
 * is what the helper below is for.
 */
type SheetOptions<D> = Pick<MatDialogConfig<D>, 'autoFocus' | 'data' | 'disableClose'>;

/**
 * Everything a sheet is opened with that is not about that sheet: the width
 * from the scale, a cap so it never runs to the edge of a phone, and focus put
 * on the sheet itself rather than on the first thing in it.
 *
 * `maxWidth` was written out twelve times and `autoFocus` twelve times, which
 * is twelve chances for the thirteenth sheet to be the one that opens flush to
 * the screen edge. The two sheets that want focus in a box instead say so, and
 * that reads as the exception it is.
 *
 * The confirm and one-line-answer sheets are not opened through here: they take
 * the width of the words on them, and there is no scale for that.
 */
function sheet<D>(width: keyof typeof SHEET_WIDTHS, options: SheetOptions<D> = {}) {
  return {
    width: SHEET_WIDTHS[width],
    maxWidth: '95vw',
    autoFocus: 'dialog',
    ...options,
  } satisfies MatDialogConfig<D>;
}

/**
 * The page is never taken away: everything else opens over it. Keeping the
 * openers here means the top bar, the composer, the chapter toolbar and the
 * lists can all reach a modal without importing each other — and the two
 * flows that chain modals (new chapter, close chapter) live in one place.
 */
@Injectable({ providedIn: 'root' })
export class DialogsService {
  private readonly dialog = inject(MatDialog);
  private readonly chapters = inject(ChapterStore);
  private readonly stories = inject(StoryStore);
  /** The Model sheet while it is open, so a second ask joins the first. */
  private model: Promise<void> | null = null;

  /**
   * Whether anything is open over the page. The page's own shortcuts stop at
   * the edge of a sheet — Escape belongs to whatever is on top, and Ctrl+Enter
   * inside a text box is a keystroke and not a request — so the two places
   * that listen at the document ask this before acting.
   */
  anyOpen(): boolean {
    return this.dialog.openDialogs.length > 0;
  }

  /**
   * The model: where the story is sent, and how it is asked once it gets there.
   * Two tabs of one sheet, opening on Connection.
   *
   * `insisting` is the first-run form: it opens before anything else, has no
   * tab strip, does not take Escape or a click outside for an answer, and keeps
   * Done dark until there is somewhere to send the story. Resolves when it
   * closes, so the flow behind it can wait.
   *
   * Narrower when it is insisting, because a form that will not be dismissed is
   * a column of questions and nothing else; the tabbed sheet takes the width
   * Parameters needs for its two columns.
   */
  async openModel(insisting = false): Promise<void> {
    // Asked for twice — the shortcut pressed twice, or the first-run flow and a
    // keypress at once — is one sheet, and both askers wait on that one.
    this.model ??= this.showModel(insisting).finally(() => (this.model = null));
    return this.model;
  }

  private async showModel(insisting: boolean): Promise<void> {
    const { ModelDialog } = await import('../features/model/model-dialog');
    const ref = this.dialog.open(
      ModelDialog,
      sheet(insisting ? 'md' : 'lg', { disableClose: insisting, data: { insisting } }),
    );
    await firstValueFrom(ref.afterClosed());
  }

  /**
   * How the story looks to you: Reading first, then the colours it is drawn in,
   * then the panel for people who want to look under the hood.
   */
  async openPreferences(): Promise<void> {
    const { PreferencesDialog } = await import('../features/preferences/preferences-dialog');
    this.dialog.open(PreferencesDialog, sheet('lg'));
  }

  /**
   * The story sheet. Handed a character it opens on the cast with that one
   * scrolled to and its name waiting — which is what the chapter panel's rows
   * do, since a name and a paragraph are more than a row can hold.
   */
  async openStory(characterId?: string): Promise<void> {
    const { StoryDialog } = await import('../features/story/story-dialog');
    this.dialog.open(StoryDialog, sheet('lg', { data: { characterId } }));
  }

  async openWorld(): Promise<void> {
    const { WorldDialog } = await import('../features/world/world-dialog');
    this.dialog.open(WorldDialog, sheet('xl'));
  }

  /**
   * The release notes. From the pill it shows what is newer than this build;
   * from About, everything, because the notes are worth reading with nothing
   * pending.
   */
  async openWhatsNew(all = false): Promise<void> {
    const { WhatsNewDialog } = await import('../features/updates/whats-new-dialog');
    this.dialog.open(WhatsNewDialog, sheet('lg', { data: { all } }));
  }

  /** No settings on it: what this is, which build of it, and where to go next. */
  async openAbout(): Promise<void> {
    const { AboutDialog } = await import('./about-dialog');
    this.dialog.open(AboutDialog, sheet('sm'));
  }

  async openChapters(): Promise<void> {
    const { ChaptersDialog } = await import('../features/chapters/chapters-dialog');
    this.dialog.open(ChaptersDialog, sheet('lg'));
  }

  async openPromptPreview(draft = '', direction = ''): Promise<void> {
    const { PromptPreviewDialog } = await import('../features/chapters/prompt-preview-dialog');
    this.dialog.open(PromptPreviewDialog, sheet('xl', { data: { draft, direction } }));
  }

  /**
   * The scene sheet. Resolves true when the writer confirmed; Escape and
   * backdrop still save the text, they just do not open the chapter.
   */
  async openScene(chapterId: string, opening = false): Promise<boolean> {
    const { SceneDialog } = await import('../features/chapters/scene-dialog');
    const ref = this.dialog.open(
      SceneDialog,
      sheet('lg', { data: { chapterId, opening }, autoFocus: 'first-tabbable' }),
    );
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  /**
   * New chapter: starting the next one closes the one being written, because
   * that is what carries the story forward — the chapter is summarised, the
   * summary is reviewed, and it joins the story so far before the new scene is
   * written. A chapter with nothing in it, or one already closed, has nothing
   * to summarise, so that case goes straight to the scene sheet.
   */
  async newChapter(): Promise<void> {
    const chapter = this.chapters.chapter();
    if (chapter.status === 'writing' && !this.chapters.isEmpty()) {
      await this.closeChapter();
      return;
    }
    await this.startChapter(chapter.scene);
  }

  /**
   * Close chapter: summarise, review, fold into the story so far, then open
   * the next chapter's sheet pre-filled with this one's scene.
   */
  async closeChapter(): Promise<void> {
    const chapter = this.chapters.chapter();
    const { CloseChapterDialog } = await import('../features/chapters/close-chapter-dialog');
    const ref = this.dialog.open<InstanceType<typeof CloseChapterDialog>, undefined, ChapterClose>(
      CloseChapterDialog,
      sheet('lg'),
    );
    const closed = await firstValueFrom(ref.afterClosed());
    // Backing out of the review leaves the chapter open and starts nothing. Any
    // empty answer is a back-out: the sheet will not confirm without a summary,
    // and closing a chapter on nothing would replace the story so far with it.
    if (!closed?.summary.trim()) return;

    this.chapters.closeChapter(chapter.id, closed.summary, closed.entries);
    await this.startChapter(chapter.scene);
  }

  /** The record exists at once, and the scene sheet opens over it. */
  private async startChapter(scene: string): Promise<void> {
    const chapter = this.chapters.createChapter(scene);
    await this.openScene(chapter.id, true);
  }

  async askText(data: TextPromptData): Promise<string | undefined> {
    const { TextPromptDialog } = await import('./small-dialogs');
    const ref = this.dialog.open<InstanceType<typeof TextPromptDialog>, TextPromptData, string>(
      TextPromptDialog,
      { data, autoFocus: 'first-tabbable' },
    );
    return firstValueFrom(ref.afterClosed());
  }

  async confirm(data: ConfirmData): Promise<boolean> {
    const { ConfirmDialog } = await import('./small-dialogs');
    const ref = this.dialog.open(ConfirmDialog, { data, autoFocus: 'dialog' });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  /**
   * The story sheet on its own, seeded from whatever it is handed. Resolves to
   * what the writer chose, or undefined if they backed out.
   */
  private async askSetup(data: NewStoryData): Promise<StorySetup | undefined> {
    const { NewStoryDialog } = await import('../features/story/new-story-dialog');
    const ref = this.dialog.open<InstanceType<typeof NewStoryDialog>, NewStoryData, StorySetup>(
      NewStoryDialog,
      sheet('md', { data, autoFocus: 'first-tabbable' }),
    );
    return firstValueFrom(ref.afterClosed());
  }

  /**
   * New story: who tells it and who you play, then the first scene. Setup
   * comes first because it shapes every request the chapter will make — and
   * nothing is created until it is confirmed.
   */
  async newStory(): Promise<void> {
    const setup = await this.askSetup({
      heading: 'A new story',
      confirm: 'Write the first scene',
      title: '',
      mode: 'narrator',
      persona: { name: '', description: '' },
    });
    if (!setup) return;

    const chapter = this.chapters.startStory(setup);
    await this.openScene(chapter.id, true);
  }

  /**
   * First run: the app has already made a story, so this offers the same
   * questions over it. Backing out simply keeps the defaults.
   */
  async setUpFirstStory(): Promise<void> {
    const story = this.stories.story();
    const setup = await this.askSetup({
      heading: 'Your first story',
      confirm: 'Write the first scene',
      title: story.title === DEFAULT_STORY_TITLE ? '' : story.title,
      mode: story.mode,
      persona: story.persona,
    });
    if (!setup) return;
    this.stories.patch(
      {
        title: setup.title || story.title,
        mode: setup.mode,
        persona: setup.persona,
      },
      story.id,
    );
  }
}
