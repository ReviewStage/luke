import { DIAGRAM_APPEARANCE, type DiagramAppearance } from "@repo/ui/diagram-contract";

const DIAGRAM_TOKENS = {
  ground: "--ui-color-ground",
  words: "--ui-color-text",
  lines: "--ui-color-text-muted",
  box: "--ui-color-chip",
  raised: "--ui-color-chip-hover",
  edge: "--ui-color-chip-edge-strong",
  group: "--ui-color-well",
  groupEdge: "--ui-color-chip-edge",
} as const satisfies Record<string, `--ui-color-${string}`>;

type DiagramRole = keyof typeof DIAGRAM_TOKENS;

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

const PROFILE_ATTRIBUTE = "data-ui-profile";
const THEME_ATTRIBUTE = "data-ui-theme";

const SRGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/u;

type Channels = readonly [red: number, green: number, blue: number, alpha: number];

type DiagramThemeVariables = { readonly darkMode: boolean } & Partial<
  Record<keyof typeof MERMAID_ROLES, string>
>;

function channelsOf(color: string): Channels | undefined {
  const parsed = SRGB.exec(color);
  if (parsed !== null) {
    const [, red, green, blue, alpha] = parsed;
    return [Number(red), Number(green), Number(blue), alpha === undefined ? 1 : Number(alpha)];
  }
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (context === null) return undefined;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue, alpha / 255];
}

function opaqueOver(color: Channels, ground: Channels): string {
  const alpha = color[3];
  const mixed = [0, 1, 2].map((at) =>
    Math.round((color[at] ?? 0) * alpha + (ground[at] ?? 0) * (1 - alpha)),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

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

export function diagramThemeVariables(appearance: DiagramAppearance): DiagramThemeVariables {
  const palette = paletteIn(appearance);
  const colors = Object.entries(MERMAID_ROLES).flatMap(([name, role]) => {
    const color = palette.get(role);
    return color === undefined ? [] : [[name, color]];
  });
  return { ...Object.fromEntries(colors), darkMode: appearance === DIAGRAM_APPEARANCE.DARK };
}
