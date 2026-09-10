/**
 * Puts text on the clipboard, and says whether it got there.
 *
 * `navigator.clipboard` is one of the APIs a browser withholds from a page that
 * did not arrive over HTTPS, and a phone on this network is such a page — see
 * `newId` in store/documents.ts for the whole of why. Where it is missing the
 * older route still works: a text box nobody sees, selected, and the `copy`
 * command, which is what every site did before there was a clipboard API and
 * what every browser still honours from inside a tap.
 *
 * Both are read through a type that admits they may not be there. The DOM's
 * own types say the clipboard is always present and the command is deprecated,
 * and on the page this is for the first is false and the second is the point.
 */
export async function copyText(text: string): Promise<boolean> {
  const { clipboard } = navigator as { clipboard?: Clipboard };
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Refused: permission, or focus somewhere else. The old way may still take it.
    }
  }
  return copyBySelection(text);
}

function copyBySelection(text: string): boolean {
  const { execCommand } = document as { execCommand?: (command: string) => boolean };
  if (!execCommand) return false;
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.setAttribute('aria-hidden', 'true');
  box.style.position = 'fixed';
  box.style.opacity = '0';
  box.style.pointerEvents = 'none';
  document.body.append(box);
  const active = document.activeElement;
  box.focus();
  box.select();
  try {
    return execCommand.call(document, 'copy');
  } catch {
    return false;
  } finally {
    box.remove();
    if (active instanceof HTMLElement) active.focus();
  }
}
