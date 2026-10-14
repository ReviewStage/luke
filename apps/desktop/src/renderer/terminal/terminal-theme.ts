import type { ITheme } from "@xterm/xterm";

/**
 * terminal-theme.ts -- a terminal's colours, read off the window's `--terminal-*` tokens as they stand on its host.
 *
 * The terminal draws its cells on a canvas, which reads no stylesheet, so its
 * colours are handed to it as values. Each is the computed value of a token
 * (`styles/base.css`), read off the element it is mounted in, so the
 * stylesheet stays the one place a colour is chosen and the light
 * appearance's restatements reach the canvas too: the surface reads them
 * again whenever the appearance flips.
 */

/** Each colour the terminal draws, by the token it is read from. */
const THEME_TOKENS = {
  background: "--terminal-ground",
  foreground: "--terminal-text",
  cursor: "--terminal-cursor",
  cursorAccent: "--terminal-ground",
  selectionBackground: "--terminal-selection",
  scrollbarSliderBackground: "--terminal-scrollbar",
  scrollbarSliderHoverBackground: "--terminal-scrollbar",
  scrollbarSliderActiveBackground: "--terminal-scrollbar",
  black: "--terminal-black",
  red: "--terminal-red",
  green: "--terminal-green",
  yellow: "--terminal-yellow",
  blue: "--terminal-blue",
  magenta: "--terminal-magenta",
  cyan: "--terminal-cyan",
  white: "--terminal-white",
  brightBlack: "--terminal-bright-black",
  brightRed: "--terminal-bright-red",
  brightGreen: "--terminal-bright-green",
  brightYellow: "--terminal-bright-yellow",
  brightBlue: "--terminal-bright-blue",
  brightMagenta: "--terminal-bright-magenta",
  brightCyan: "--terminal-bright-cyan",
  brightWhite: "--terminal-bright-white",
} as const satisfies Record<string, `--terminal-${string}`>;

/** The appearance query whose answer flipping changes every token's value. */
export const LIGHT_APPEARANCE = "(prefers-color-scheme: light)";

/**
 * The terminal's colours as the tokens stand on `host` now. A token the
 * stylesheet does not reach, as in a document without the panel's styles,
 * is left out, and the terminal keeps its own default for it.
 */
export function terminalTheme(host: Element): ITheme {
  const style = getComputedStyle(host);
  return Object.fromEntries(
    Object.entries(THEME_TOKENS).flatMap(([colour, token]) => {
      const value = style.getPropertyValue(token).trim();
      return value === "" ? [] : [[colour, value]];
    }),
  );
}
