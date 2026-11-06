export const THEME_KEY = "app.theme";

const GROUND_TOKEN = "--ui-color-ground";

export function tintChrome(root: HTMLElement): void {
  const ground = getComputedStyle(root).getPropertyValue(GROUND_TOKEN).trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta !== null && ground !== "") meta.content = ground;
}
