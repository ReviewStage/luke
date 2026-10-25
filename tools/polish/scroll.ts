/**
 * scroll.ts -- the page scripts that move a scene's scroll box as a reader's wheel would, and that hold its edge fades as they rest for the shot.
 *
 * It lives apart from `polish-shots.ts`, which runs the whole capture the
 * moment it is imported, so a test can hand it to a page of its own.
 */

/**
 * A page expression that scrolls the first element holding the ARIA `role`
 * by `by` pixels, up where negative, and is true where it found one. Note
 * that it moves the box's own scroll rather than turning the wheel over it,
 * because the wheel scrolls whatever stands under the pointer, which may be a
 * card inside the box with a scroll of its own; the browser fires the box's
 * scroll event either way, which is what the app follows.
 */
export function scrollScript(role: string, by: number): string {
  return `(() => {
  const box = document.querySelector(${JSON.stringify(`[role="${role}"]`)});
  if (box === null) return false;
  box.scrollTop += ${JSON.stringify(by)};
  return true;
})()`;
}

/**
 * A page expression that holds every scroll fade at the depth it rests at
 * for the scroll it stands at. A fade's depth is eased by a scroll timeline
 * (`@luke/ui`'s scroll-area.css), which Playwright's `animations:
 * "disabled"` finishes, dropping the end fade from every box whatever its
 * scroll. Note that the depths are read live and written as important inline
 * lengths, because an important declaration outranks an animation, so the
 * finished animation leaves them be.
 */
export const PIN_SCROLL_FADES_SCRIPT = `(() => {
  const depths = ["--luke-scroll-area-fade-start", "--luke-scroll-area-fade-end"];
  for (const box of document.querySelectorAll("*")) {
    const style = getComputedStyle(box);
    if (!style.animationName.includes("luke-scroll-area-fade")) continue;
    for (const depth of depths) box.style.setProperty(depth, style.getPropertyValue(depth), "important");
  }
})()`;
