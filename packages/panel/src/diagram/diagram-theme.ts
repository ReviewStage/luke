import { DIAGRAM_APPEARANCE, type DiagramAppearance } from "@luke/ui/diagram-contract";

/**
 * diagram-theme.ts -- Mermaid's colours in an appearance, read off the window's palette as it draws them, as the terminal reads its own (`terminal/terminal-theme.ts`).
 *
 * Mermaid draws into a picture of its own, which reads no stylesheet of the
 * window's, so its colours are handed to it as values. Each role is read as
 * the colour it resolves to on a probe wearing the window's profile and the
 * appearance asked for (`palettes.css`), so a diagram drawn in the dark
 * takes the dark palette even while the window still stands in the light,
 * and the stylesheet stays the one place a colour is chosen. Mermaid mixes
 * its shades out of the colours it is handed and parses only the old sRGB
 * forms, so each is laid over the window's ground, the section a diagram is
 * drawn on, and handed over as an opaque `#rrggbb`.
 */

/** The palette's roles a diagram draws in, by the token each is read from. */
const DIAGRAM_TOKENS = {
  ground: "--luke-color-ground",
  words: "--luke-color-text",
  lines: "--luke-color-text-muted",
  box: "--luke-color-chip",
  raised: "--luke-color-chip-hover",
  edge: "--luke-color-chip-edge-strong",
  group: "--luke-color-well",
  groupEdge: "--luke-color-chip-edge",
} as const satisfies Record<string, `--luke-color-${string}`>;

type DiagramRole = keyof typeof DIAGRAM_TOKENS;

/**
 * Each colour Mermaid is handed, by the role it is drawn in: the primary ink
 * for words, the secondary ink for lines and arrows, a chip's face for a box
 * and its hover step for what is raised off one (a note, a label on a
 * line), a chip's strong edge for a box's, and a well for a group.
 */
const MERMAID_ROLES = {
  primaryColor: "box",
  primaryBorderColor: "edge",
  primaryTextColor: "words",
  secondaryColor: "raised",
  tertiaryColor: "raised",
  lineColor: "lines",
  textColor: "words",
  actorBkg: "box",
  actorBorder: "edge",
  actorTextColor: "words",
  signalColor: "lines",
  signalTextColor: "words",
  noteBkgColor: "raised",
  noteBorderColor: "edge",
  noteTextColor: "words",
  edgeLabelBackground: "raised",
  clusterBkg: "group",
  clusterBorder: "groupEdge",
} as const satisfies Record<string, DiagramRole>;

/** The attributes a surface wears its roles and its palette in (`@luke/ui`'s `surfaceAttributes`). */
const PROFILE_ATTRIBUTE = "data-luke-profile";
const THEME_ATTRIBUTE = "data-luke-theme";

/** An sRGB colour as a computed style writes it: `rgb(r, g, b)`, or `rgba(r, g, b, a)` where it is translucent. */
const SRGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/u;

/** A colour's channels, 0 to 255, and its alpha, 0 to 1. */
type Channels = readonly [red: number, green: number, blue: number, alpha: number];

/** Mermaid's theme variables in an appearance: a role's colour where the window's palette reaches it. */
type DiagramThemeVariables = { readonly darkMode: boolean } & Partial<
  Record<keyof typeof MERMAID_ROLES, string>
>;

/** A computed colour's channels: read from its text where it is sRGB, and by a canvas painting it where it is not (an `oklch()` on the web). */
function channelsOf(colour: string): Channels | undefined {
  const parsed = SRGB.exec(colour);
  if (parsed !== null) {
    const [, red, green, blue, alpha] = parsed;
    return [Number(red), Number(green), Number(blue), alpha === undefined ? 1 : Number(alpha)];
  }
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (context === null) return undefined;
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue, alpha / 255];
}

/** `colour` laid over the opaque `ground`, as `#rrggbb`. */
function opaqueOver(colour: Channels, ground: Channels): string {
  const alpha = colour[3];
  const mixed = [0, 1, 2].map((at) =>
    Math.round((colour[at] ?? 0) * alpha + (ground[at] ?? 0) * (1 - alpha)),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Each role's colour in `appearance` as the window's palette draws it,
 * opaque over its ground, or nothing for a role the stylesheet does not
 * reach, as in a document without the window's styles. A probe inside the
 * root is coloured with each token in turn, because a computed colour is a
 * resolved one, where the token's own text is still its `light-dark()` pair.
 */
function paletteIn(appearance: DiagramAppearance): Map<DiagramRole, string> {
  const root = document.documentElement;
  const probe = root.ownerDocument.createElement("span");
  const profile = root.getAttribute(PROFILE_ATTRIBUTE);
  if (profile !== null) probe.setAttribute(PROFILE_ATTRIBUTE, profile);
  probe.setAttribute(THEME_ATTRIBUTE, appearance);
  probe.hidden = true;
  root.appendChild(probe);
  const read = new Map<DiagramRole, Channels>();
  for (const role of Object.keys(DIAGRAM_TOKENS) as DiagramRole[]) {
    const token = DIAGRAM_TOKENS[role];
    if (getComputedStyle(probe).getPropertyValue(token).trim() === "") continue;
    probe.style.color = `var(${token})`;
    const channels = channelsOf(getComputedStyle(probe).color);
    if (channels !== undefined) read.set(role, channels);
  }
  probe.remove();
  const ground = read.get("ground");
  const palette = new Map<DiagramRole, string>();
  if (ground === undefined) return palette;
  for (const [role, channels] of read) palette.set(role, opaqueOver(channels, ground));
  return palette;
}

/**
 * Mermaid's colours in `appearance`, from the window's palette as it stands
 * now. A role the palette does not reach is left out, and Mermaid keeps its
 * own for it.
 */
export function diagramThemeVariables(appearance: DiagramAppearance): DiagramThemeVariables {
  const palette = paletteIn(appearance);
  const colours = Object.entries(MERMAID_ROLES).flatMap(([name, role]) => {
    const colour = palette.get(role);
    return colour === undefined ? [] : [[name, colour]];
  });
  return { ...Object.fromEntries(colours), darkMode: appearance === DIAGRAM_APPEARANCE.DARK };
}
