import type { ITheme } from "@xterm/xterm";

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

const NOTE_SLOT = 245;
const NOTE_TOKEN = "--terminal-note";

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

const DIM_KEEP = 0.42;

const FIND_TOKENS = {
  match: "--terminal-find-match",
  current: "--terminal-find-current",
} as const;

const OPAQUE_RGB = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/u;

interface FindTints {
  readonly match: string;
  readonly current: string;
}

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

function hexOf(color: string): string {
  const channels = OPAQUE_RGB.exec(color);
  if (channels === null) return color;
  const hex = channels.slice(1).map((channel) => Number(channel).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`;
}

export function terminalFindTints(host: Element): FindTints {
  const colors = resolvedColors(host, Object.values(FIND_TOKENS));
  return {
    match: hexOf(colors.get(FIND_TOKENS.match) ?? ""),
    current: hexOf(colors.get(FIND_TOKENS.current) ?? ""),
  };
}

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
  const extendedAnsi: string[] = [];
  extendedAnsi[NOTE_SLOT - 16] = note;
  return { ...theme, extendedAnsi };
}
