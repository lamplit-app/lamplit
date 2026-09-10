import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

/**
 * The two ways onto the clipboard, and which one a page gets.
 *
 * jsdom has neither `navigator.clipboard` nor `document.execCommand`, which is
 * convenient: each case puts exactly the one it is about in place, and the page
 * a phone gets over plain HTTP — no clipboard API at all — is the default.
 */

function withClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

function withCopyCommand(execCommand: (command: string) => boolean): void {
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
}

afterEach(() => {
  // Both are own properties put there by a case; jsdom's own instances have
  // neither, and the next case starts from that.
  delete (navigator as { clipboard?: unknown }).clipboard;
  delete (document as { execCommand?: unknown }).execCommand;
});

describe('copyText', () => {
  it('uses the clipboard API when the page has one', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    withClipboard(writeText);
    expect(await copyText('a line')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('a line');
  });

  it('falls back to the copy command where there is no clipboard API', async () => {
    let selected = '';
    withCopyCommand((command) => {
      const box = document.activeElement;
      selected = command === 'copy' && box instanceof HTMLTextAreaElement ? box.value : '';
      return true;
    });
    expect(await copyText('what was sent')).toBe(true);
    expect(selected).toBe('what was sent');
    // Nothing is left on the page from it.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('tries the copy command when the clipboard API refuses', async () => {
    withClipboard(() => Promise.reject(new Error('NotAllowedError')));
    const execCommand = vi.fn(() => true);
    withCopyCommand(execCommand);
    expect(await copyText('refused first')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('says so when neither is there', async () => {
    expect(await copyText('nowhere to go')).toBe(false);
  });
});
