import { act } from "react";
import { vi } from "vitest";

export async function wholeFileDrawn(container: HTMLElement): Promise<void> {
  await vi.waitFor(
    async () => {
      await act(async () => undefined);
      if (!wholeFileRoot(container)?.querySelector("[data-line]")) throw new Error("not drawn");
    },
    { timeout: 4000, interval: 10 },
  );
}

export function wholeFileRoot(container: HTMLElement): ShadowRoot | undefined {
  return container.querySelector(".whole-file diffs-container")?.shadowRoot ?? undefined;
}

export function wholeFileLines(container: HTMLElement): string[] {
  const root = wholeFileRoot(container);
  return [...(root?.querySelectorAll("[data-line]") ?? [])].map(
    (row) => `${row.getAttribute("data-line")} ${row.textContent}`,
  );
}

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

export function installScrollTo(): void {
  Element.prototype.scrollTo = () => undefined;
}
