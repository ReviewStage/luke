/**
 * press-intent.ts -- whether the press the window is answering right now was made with ⌘, or Ctrl
 * off a Mac: a link so pressed asks to go where it leads, as against a plain press, which opens what
 * it names beside the reader as a preview (`use-side-panel.ts`).
 *
 * The press is read at the window, around the handlers that answer it: the window's capture phase
 * hears a click before any control does and its bubble phase after them all, so a door a control's
 * click opens reads the press it came from without every control between the link and the door
 * carrying the event along. A press some control stops short of the window's bubble phase is let go
 * by the next press, and is never read past `PRESS_HELD_MS` after it landed.
 */

/** How long a press is read as the one being answered, in milliseconds, should the window never hear its end. */
const PRESS_HELD_MS = 1000;

/** The press being answered: whether ⌘ or Ctrl was held, and when it landed, by the event's own clock. */
let pressing: { readonly command: boolean; readonly at: number } | undefined;

/** Starts reading presses on `target`, the window; answers the way to stop. */
export function installPressIntent(target: Window): () => void {
  const start = (event: MouseEvent) => {
    pressing = { command: event.metaKey || event.ctrlKey, at: event.timeStamp };
  };
  const end = () => {
    pressing = undefined;
  };
  target.addEventListener("click", start, true);
  target.addEventListener("click", end, false);
  return () => {
    target.removeEventListener("click", start, true);
    target.removeEventListener("click", end, false);
    pressing = undefined;
  };
}

/** Whether the press being answered was made with ⌘ (or Ctrl), asking to go where it leads. */
export function pressedWithCommand(): boolean {
  if (pressing === undefined) return false;
  return pressing.command && performance.now() - pressing.at < PRESS_HELD_MS;
}
