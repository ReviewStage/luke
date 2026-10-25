/**
 * ready.ts -- the page script that says whether a scene has stopped waiting on anything, so the capture shoots it loaded.
 *
 * It lives apart from `polish-shots.ts`, which runs the whole capture the
 * moment it is imported, so a test can hand it to a page of its own.
 */

// What a wait draws, which a scene is not shot under: a loading skeleton's box (root AGENTS.md: `anti-slop/skeleton-through-components`), a spinner's box (`Spinner`, `SpinnerRegion`, a busy button's ring: `luke-spinner`), anything the app marks `aria-busy`, and Excalidraw's own line while the board's scene loads (`LoadingMessage`).
const WAIT_SELECTOR = '[class*="skeleton"], .luke-spinner, [aria-busy="true"], .LoadingMessage';

/** A page expression that is true once no wait stands on screen; one counts only where it is within the viewport. */
export const READY_SCRIPT = `![...document.querySelectorAll(${JSON.stringify(WAIT_SELECTOR)})].some((box) => {
  const r = box.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
})`;
