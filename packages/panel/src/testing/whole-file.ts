import { act } from "react";
import { vi } from "vitest";

/**
 * whole-file.ts -- a whole file the panel drew through the diff bundle, as a
 * test reads it: waited for, since the bundle is imported and Pierre draws on
 * its next frame, and its rows read from the shadow root Pierre drew them in.
 */

/** Waits for the whole file under `container` to be drawn: the diff bundle loaded, and Pierre's rows drawn on its next frame. */
export async function wholeFileDrawn(container: HTMLElement): Promise<void> {
  await act(() =>
    vi.waitFor(() => {
      if (!wholeFileRoot(container)?.querySelector("[data-line]")) throw new Error("not drawn");
    }),
  );
}

/** The shadow root of the whole file under `container`, none where none is drawn. */
export function wholeFileRoot(container: HTMLElement): ShadowRoot | undefined {
  return container.querySelector(".whole-file diffs-container")?.shadowRoot ?? undefined;
}

/** Each line the whole file under `container` draws, its number then its text; none where none is drawn. */
export function wholeFileLines(container: HTMLElement): string[] {
  const root = wholeFileRoot(container);
  return [...(root?.querySelectorAll("[data-line]") ?? [])].map(
    (row) => `${row.getAttribute("data-line")} ${row.textContent}`,
  );
}

/** Presses a line's number in the whole file under `container`, as the reader picks it, with ⇧ to pick on from the line picked. */
export function pressLineNumber(container: HTMLElement, line: number, shiftKey = false): void {
  const number = wholeFileRoot(container)?.querySelector(`[data-column-number="${line}"]`);
  if (number === null || number === undefined) throw new Error(`line ${line} is drawn`);
  const at = {
    bubbles: true,
    composed: true,
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    shiftKey,
  };
  number.dispatchEvent(new PointerEvent("pointerdown", at));
  document.dispatchEvent(new PointerEvent("pointerup", at));
}

/** jsdom lays nothing out, so it has no `scrollTo`; Pierre scrolls a whole file to its lines with one, which here moves nothing. */
export function installScrollTo(): void {
  Element.prototype.scrollTo = () => undefined;
}
