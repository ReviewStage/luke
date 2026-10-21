/**
 * theme-chrome.ts -- what the web app and the admin dashboard share of wearing a theme on a tab's root: the key the choice is kept under, and the browser's chrome tinted in the worn theme's ground.
 *
 * `public/app-theme.js` reads the same key before the first frame, and
 * `app/web-appearance.tsx` and `admin/admin-appearance.ts` wear it live.
 */

/** Where the last theme chosen is kept for the next load's first frame, as `public/app-theme.js` reads it. */
export const THEME_KEY = "luke.theme";

/** The palette's own ground, which the browser's chrome is drawn in to blend into the page. */
const GROUND_TOKEN = "--luke-color-ground";

/** Says the ground of the theme just worn to the browser, for the chrome around the page. */
export function tintChrome(root: HTMLElement): void {
  const ground = getComputedStyle(root).getPropertyValue(GROUND_TOKEN).trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta !== null && ground !== "") meta.content = ground;
}
