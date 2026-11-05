import type { ITheme } from "@xterm/xterm";

/**
 * terminal-theme.ts -- a terminal's colors, read off the window's `--terminal-*` tokens as they stand on its host.
 *
 * The terminal draws its cells on a canvas, which reads no stylesheet, so its
 * colors are handed to it as values. Each token (`styles/base.css`) is a
 * `light-dark()` pair, which the canvas cannot parse, so each is read as the
 * color it resolves to where the terminal is mounted, in the appearance the
 * surface there is drawn in. The stylesheet stays the one place a color is
 * chosen, and the surface reads them again whenever the appearance flips.
 */

/** Each color the terminal draws, by the token it is read from. */
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

/**
 * The terminal's own notes are printed in palette slot 245 (`38;5;245`, which
 * `use-terminal-session.ts` writes), a mid gray of the 256-color ramp, read
 * off `--terminal-note`. A palette slot rather than a 24-bit color because
 * the DOM renderer draws a slot through a class, which the panel's policy
 * admits, and a slot follows the appearance as it flips. A shell that
 * prints that gray itself gets the note's, which is a gray beside it, and a
 * dimmed screen leaves the slot undimmed so the note stays legible over
 * output that is not.
 */
const NOTE_SLOT = 245;
const NOTE_TOKEN = "--terminal-note";

/** The colors a dimmed screen gives back to the ground: the text and the sixteen the shell's own output is drawn in. */
const DIMMED_COLORS: ReadonlySet<string> = new Set([
  "foreground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
]);

/** How much of its color a dimmed screen's output keeps, the rest taken by the ground. */
const DIM_KEEP = 0.42;

/** The tints a find gives the matches, by the token each is read from: every match, and the one the find is at. */
const FIND_TOKENS = {
  match: "--terminal-find-match",
  current: "--terminal-find-current",
} as const;

/** An opaque color as a computed style writes it. */
const OPAQUE_RGB = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/u;

/** A find's tints: every match's, and the one the find is at. */
interface FindTints {
  readonly match: string;
  readonly current: string;
}

/**
 * Each token's color as `host` draws it now, by the token, or nothing for a
 * token the stylesheet does not reach there. A probe inside the host is
 * colored with each in turn, because a computed color is a resolved one,
 * where the token's own text is still its `light-dark()` pair.
 */
function resolvedColors(host: Element, tokens: readonly string[]): Map<string, string> {
  const declared = getComputedStyle(host);
  const probe = host.appendChild(host.ownerDocument.createElement("span"));
  const colors = new Map<string, string>();
  for (const token of tokens) {
    if (declared.getPropertyValue(token).trim() === "") continue;
    probe.style.color = `var(${token})`;
    colors.set(token, getComputedStyle(probe).color);
  }
  probe.remove();
  return colors;
}

/** An opaque computed color, `rgb(r, g, b)`, as `#rrggbb`; any other text as it stands. */
function hexOf(color: string): string {
  const channels = OPAQUE_RGB.exec(color);
  if (channels === null) return color;
  const hex = channels.slice(1).map((channel) => Number(channel).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`;
}

/** A find's tints as the tokens resolve on `host` now, as the search reads them, in the `#rrggbb` the search asks for. */
export function terminalFindTints(host: Element): FindTints {
  const colors = resolvedColors(host, Object.values(FIND_TOKENS));
  return {
    match: hexOf(colors.get(FIND_TOKENS.match) ?? ""),
    current: hexOf(colors.get(FIND_TOKENS.current) ?? ""),
  };
}

/** `color` taken `keep` of the way from `ground` to itself, both as a computed style writes them; a color that is not opaque stands as it is. */
function dimmed(color: string, ground: string | undefined, keep: number): string {
  const own = OPAQUE_RGB.exec(color);
  const under = ground === undefined ? null : OPAQUE_RGB.exec(ground);
  if (own === null || under === null) return color;
  const channels = own.slice(1).map((channel, at) => {
    const base = Number(under[at + 1]);
    return Math.round(base + (Number(channel) - base) * keep);
  });
  return `rgb(${channels.join(", ")})`;
}

/**
 * The terminal's colors as the tokens resolve on `host` now. A token the
 * stylesheet does not reach, as in a document without the panel's styles,
 * is left out, and the terminal keeps its own default for it. While the
 * screen is dimmed its output's colors stand a part of the way back to the
 * ground, and the terminal's own notes, in their slot, stay as they are.
 */
export function terminalTheme(host: Element, dim: boolean): ITheme {
  const colors = resolvedColors(host, [...Object.values(THEME_TOKENS), NOTE_TOKEN]);
  const ground = colors.get(THEME_TOKENS.background);
  const theme = Object.fromEntries(
    Object.entries(THEME_TOKENS).flatMap(([color, token]) => {
      const value = colors.get(token);
      if (value === undefined) return [];
      return [[color, dim && DIMMED_COLORS.has(color) ? dimmed(value, ground, DIM_KEEP) : value]];
    }),
  );
  const note = colors.get(NOTE_TOKEN);
  if (note === undefined) return theme;
  // Note that the slots between the sixteen and the note's are left empty, which the terminal fills with its own cube.
  const extendedAnsi: string[] = [];
  extendedAnsi[NOTE_SLOT - 16] = note;
  return { ...theme, extendedAnsi };
}
