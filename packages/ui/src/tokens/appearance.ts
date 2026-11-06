import { THEME, type Theme } from "./surface.js";

const MACHINE_DARK = "(prefers-color-scheme: dark)";

const THEME_ATTRIBUTE = "data-ui-theme";

const THEMES: ReadonlySet<string> = new Set(Object.values(THEME));

export type DrawnTheme = Exclude<Theme, typeof THEME.SYSTEM>;

function drawnTheme(theme: Theme): DrawnTheme {
  if (theme !== THEME.SYSTEM) return theme;
  return window.matchMedia(MACHINE_DARK).matches ? THEME.DARK : THEME.LIGHT;
}

function wornTheme(root: Element): Theme {
  const worn = root.getAttribute(THEME_ATTRIBUTE);
  return worn !== null && THEMES.has(worn) ? (worn as Theme) : THEME.SYSTEM;
}

export function drawnDark(root: Element = document.documentElement): boolean {
  return drawnTheme(wornTheme(root)) === THEME.DARK;
}

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
