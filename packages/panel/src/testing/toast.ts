/**
 * toast.ts -- what a test of a toast reads: the newest one standing, as the window's toasts stack.
 *
 * Toasts stack, and one leaving stays drawn through its exit, so the toast
 * an act just raised is the last one drawn that is not on its way out.
 */

/** The newest toast standing, or none. */
function newestToast(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(".toast:not([data-leaving])")].at(-1);
}

/** What the newest toast standing says, or nothing while none stands. */
export function newestToastSays(): string | undefined {
  return newestToast()?.textContent ?? undefined;
}

/** The newest toast's action, which an act raising it offered: its first button, the Dismiss after it. */
export function newestToastAction(): HTMLButtonElement | undefined {
  return newestToast()?.querySelector<HTMLButtonElement>("button") ?? undefined;
}
