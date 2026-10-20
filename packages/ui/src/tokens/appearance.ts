/**
 * appearance.ts -- whether a surface is drawn dark, read off its root's `data-luke-theme`: the one place script resolves `system` against the machine, as `palettes.css`'s `color-scheme` is the one place a sheet does.
 *
 * A root wears `dark` or `light` where its theme is chosen, as the web app's
 * does from the account's Theme setting, and `system` where it follows the
 * machine, as the desktop's windows do: there Luke's own Theme setting is
 * applied to the machine's appearance itself (`nativeTheme.themeSource`), so
 * following the machine is following the setting. A sheet picks its inks by
 * `light-dark()`, which the root's theme decides through `color-scheme`. What
 * draws on a canvas or picks a theme in script, a diagram, a whiteboard, a
 * terminal, asks here instead of asking the media query, so a page drawn in a
 * chosen theme draws its canvases in that theme whatever the machine says.
 */

import { THEME, type Theme } from "./surface.js";

/** The machine's dark appearance, which a theme of `system` follows. */
const MACHINE_DARK = "(prefers-color-scheme: dark)";

/** The attribute a root wears its theme in (`surfaceAttributes`). */
const THEME_ATTRIBUTE = "data-luke-theme";

/** Every theme a root may wear, to read the attribute by. */
const THEMES: ReadonlySet<string> = new Set(Object.values(THEME));

/** A theme as it is drawn, `system` resolved to the machine's appearance. */
export type DrawnTheme = Exclude<Theme, typeof THEME.SYSTEM>;

/** The theme `theme` is drawn in now: itself where it is chosen, the machine's where it follows the machine. */
function drawnTheme(theme: Theme): DrawnTheme {
  if (theme !== THEME.SYSTEM) return theme;
  return window.matchMedia(MACHINE_DARK).matches ? THEME.DARK : THEME.LIGHT;
}

/** The theme `root` wears, a root wearing none or one unknown following the machine. */
function wornTheme(root: Element): Theme {
  const worn = root.getAttribute(THEME_ATTRIBUTE);
  // SAFETY: `THEMES` holds exactly the theme values, so a member is one.
  return worn !== null && THEMES.has(worn) ? (worn as Theme) : THEME.SYSTEM;
}

/** Whether the surface under `root`, the document's own where none is named, is drawn dark now. */
export function drawnDark(root: Element = document.documentElement): boolean {
  return drawnTheme(wornTheme(root)) === THEME.DARK;
}

/**
 * Calls `changed` whenever what `drawnDark` answers for `root` may have
 * moved: the root wearing another theme, or the machine's appearance
 * flipping. Answers what stops it.
 */
export function onDrawnThemeChange(
  changed: () => void,
  root: Element = document.documentElement,
): () => void {
  const machine = window.matchMedia(MACHINE_DARK);
  machine.addEventListener("change", changed);
  const worn = new MutationObserver(changed);
  worn.observe(root, { attributes: true, attributeFilter: [THEME_ATTRIBUTE] });
  return () => {
    machine.removeEventListener("change", changed);
    worn.disconnect();
  };
}

/**
 * Wears `theme` on `root` as it is drawn, `dark` or `light`, for a root
 * whose palette keeps no theme that follows the machine (the site's, in
 * `palettes.css`); under `system` it is worn again each time the machine's
 * appearance flips. `worn` hears each theme as it is put on. Answers what
 * stops the following, which leaves the last theme worn.
 */
export function wearTheme(
  root: Element,
  theme: Theme,
  worn: (drawn: DrawnTheme) => void = () => undefined,
): () => void {
  const wear = (): void => {
    const drawn = drawnTheme(theme);
    root.setAttribute(THEME_ATTRIBUTE, drawn);
    worn(drawn);
  };
  wear();
  if (theme !== THEME.SYSTEM) return () => undefined;
  const machine = window.matchMedia(MACHINE_DARK);
  machine.addEventListener("change", wear);
  return () => machine.removeEventListener("change", wear);
}
