import type { ITheme } from "@xterm/xterm";

/**
 * terminal-theme.ts -- a terminal's colours, read off the window's `--terminal-*` tokens as they stand on its host.
 *
 * The terminal draws its cells on a canvas, which reads no stylesheet, so its
 * colours are handed to it as values. Each token (`styles/base.css`) is a
 * `light-dark()` pair, which the canvas cannot parse, so each is read as the
 * colour it resolves to where the terminal is mounted, in the appearance the
 * surface there is drawn in. The stylesheet stays the one place a colour is
 * chosen, and the surface reads them again whenever the appearance flips.
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

/** The token the terminal's own notes are printed in, which a dimmed screen leaves as it is. */
const NOTE_TOKEN = "--terminal-note";

/** What a note is printed in where the stylesheet gives none: the palette's bright black. */
const NOTE_FALLBACK_INK = "\x1b[90m";

/** The colours a dimmed screen gives back to the ground: the text and the sixteen the shell's own output is drawn in. */
const DIMMED_COLOURS: ReadonlySet<string> = new Set([
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

/** How much of its colour a dimmed screen's output keeps, the rest taken by the ground. */
const DIM_KEEP = 0.42;

/** The tints a find gives the matches, by the token each is read from: every match, and the one the find is at. */
const FIND_TOKENS = {
  match: "--terminal-find-match",
  current: "--terminal-find-current",
} as const;

/** An opaque colour as a computed style writes it. */
const OPAQUE_RGB = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/u;

/** A find's tints: every match's, and the one the find is at. */
interface FindTints {
  readonly match: string;
  readonly current: string;
}

/**
 * Each token's colour as `host` draws it now, by the token, or nothing for a
 * token the stylesheet does not reach there. A probe inside the host is
 * coloured with each in turn, because a computed colour is a resolved one,
 * where the token's own text is still its `light-dark()` pair.
 */
function resolvedColours(host: Element, tokens: readonly string[]): Map<string, string> {
  const declared = getComputedStyle(host);
  const probe = host.appendChild(host.ownerDocument.createElement("span"));
  const colours = new Map<string, string>();
  for (const token of tokens) {
    if (declared.getPropertyValue(token).trim() === "") continue;
    probe.style.color = `var(${token})`;
    colours.set(token, getComputedStyle(probe).color);
  }
  probe.remove();
  return colours;
}

/** An opaque computed colour, `rgb(r, g, b)`, as `#rrggbb`; any other text as it stands. */
function hexOf(colour: string): string {
  const channels = OPAQUE_RGB.exec(colour);
  if (channels === null) return colour;
  const hex = channels.slice(1).map((channel) => Number(channel).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`;
}

/** A find's tints as the tokens resolve on `host` now, as the search reads them, in the `#rrggbb` the search asks for. */
export function terminalFindTints(host: Element): FindTints {
  const colours = resolvedColours(host, Object.values(FIND_TOKENS));
  return {
    match: hexOf(colours.get(FIND_TOKENS.match) ?? ""),
    current: hexOf(colours.get(FIND_TOKENS.current) ?? ""),
  };
}

/** `colour` taken `keep` of the way from `ground` to itself, both as a computed style writes them; a colour that is not opaque stands as it is. */
function dimmed(colour: string, ground: string | undefined, keep: number): string {
  const own = OPAQUE_RGB.exec(colour);
  const under = ground === undefined ? null : OPAQUE_RGB.exec(ground);
  if (own === null || under === null) return colour;
  const channels = own.slice(1).map((channel, at) => {
    const base = Number(under[at + 1]);
    return Math.round(base + (Number(channel) - base) * keep);
  });
  return `rgb(${channels.join(", ")})`;
}

/**
 * The terminal's colours as the tokens resolve on `host` now. A token the
 * stylesheet does not reach, as in a document without the panel's styles,
 * is left out, and the terminal keeps its own default for it. While the
 * screen is dimmed its output's colours stand a part of the way back to the
 * ground.
 */
export function terminalTheme(host: Element, dim: boolean): ITheme {
  const colours = resolvedColours(host, Object.values(THEME_TOKENS));
  const ground = colours.get(THEME_TOKENS.background);
  return Object.fromEntries(
    Object.entries(THEME_TOKENS).flatMap(([colour, token]) => {
      const value = colours.get(token);
      if (value === undefined) return [];
      return [
        [colour, dim && DIMMED_COLOURS.has(colour) ? dimmed(value, ground, DIM_KEEP) : value],
      ];
    }),
  );
}

/**
 * The escape sequence a note is printed in: the note's colour as `host` draws
 * it now, as 24-bit colour, which no palette slot of a shell's is given up
 * for and no dimming reaches. A note already printed keeps the colour it
 * had when it was.
 */
export function terminalNoteInk(host: Element): string {
  const note = OPAQUE_RGB.exec(resolvedColours(host, [NOTE_TOKEN]).get(NOTE_TOKEN) ?? "");
  return note === null ? NOTE_FALLBACK_INK : `\x1b[38;2;${note[1]};${note[2]};${note[3]}m`;
}
