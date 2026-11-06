import attachmentViewer from "@repo/panel/styles/attachment-viewer.css?raw";
import base from "@repo/panel/styles/base.css?raw";
import desktop from "@repo/panel/styles/desktop.css?raw";
import entry from "@repo/panel/styles/index.css?raw";
import settings from "@repo/panel/styles/settings.css?raw";
import shell from "@repo/panel/styles/shell.css?raw";
import tasks from "@repo/panel/styles/tasks.css?raw";
import utilities from "@repo/panel/testing/tailwind.css?inline";
import ui from "@repo/ui/styles.css?inline";
import tokens from "@repo/ui/tokens.css?inline";

const UTILITIES = "tailwind.css";

const SHEET_BY_IMPORT = {
  "@repo/ui/tokens.css": tokens,
  "./settings.css": settings,
  "./base.css": base,
  "@repo/ui/styles.css": ui,
  "./tasks.css": tasks,
  "./attachment-viewer.css": attachmentViewer,
  "./shell.css": shell,
  "./desktop.css": desktop,
} as const;

const SHEETS = [
  ...[...entry.matchAll(/^@import "([^"]+)";$/gm)].map(([, specifier = ""]) => {
    const sheet = Object.entries(SHEET_BY_IMPORT).find(([named]) => named === specifier)?.[1];
    if (sheet === undefined) throw new Error(`container-width.ts lays no sheet for ${specifier}`);
    return { specifier, css: sheet };
  }),
  { specifier: UTILITIES, css: utilities },
];

const AT_RULE =
  /@container (?:([a-z-]+) )?\((?:(max-width|min-width): (\d+)px|width (<|<=|>|>=) (\d+)px)\) \{|@media ((?:not all and )?\((?:hover|pointer): ?[a-z]+\)(?: and \((?:hover|pointer): ?[a-z]+\))*) \{|@layer ([a-z-]+) \{/g;

const DEVICE = {
  TOUCH: { hover: "none", pointer: "coarse" },
  MOUSE: { hover: "hover", pointer: "fine" },
} as const;

export interface ContainerLayout {
  readonly unnamed?: number;
  readonly touch?: boolean;
  readonly only?: readonly string[];
}

interface Resolution {
  readonly widths: Readonly<Record<string, number>>;
  readonly layout: ContainerLayout;
  readonly layers: Map<string, string[]>;
}

function blockEnd(css: string, from: number): number {
  let depth = 1;
  let at = from;
  while (depth > 0 && at < css.length) {
    if (css[at] === "{") depth += 1;
    if (css[at] === "}") depth -= 1;
    at += 1;
  }
  return at;
}

function widthHolds(width: number, comparison: string, length: number): boolean {
  if (comparison === "max-width" || comparison === "<=") return width <= length;
  if (comparison === "min-width" || comparison === ">=") return width >= length;
  if (comparison === "<") return width < length;
  return width > length;
}

function mediaHolds(media: string, layout: ContainerLayout): boolean {
  const negated = media.startsWith("not all and ");
  const device: Readonly<Record<string, string>> =
    layout.touch === true ? DEVICE.TOUCH : DEVICE.MOUSE;
  const features = [...media.matchAll(/\((hover|pointer): ?([a-z]+)\)/g)];
  const answered = features.every(
    ([, feature, value]) => feature !== undefined && device[feature] === value,
  );
  return negated ? !answered : answered;
}

function holds(query: RegExpExecArray, resolution: Resolution): boolean {
  const [, name, word, wordLength, sign, signLength, media] = query;
  const { widths, layout } = resolution;
  if (media !== undefined) return mediaHolds(media, layout);
  const width = name === undefined ? layout.unnamed : widths[name];
  return (
    width !== undefined && widthHolds(width, word ?? sign ?? "", Number(wordLength ?? signLength))
  );
}

function resolvedAt(css: string, resolution: Resolution): string {
  const rules = new RegExp(AT_RULE);
  let resolved = "";
  let from = 0;
  for (let rule = rules.exec(css); rule !== null; rule = rules.exec(css)) {
    const open = rule.index + rule[0].length;
    const end = blockEnd(css, open);
    const layer = rule[7];
    resolved += css.slice(from, rule.index);
    if (layer !== undefined) {
      const gathered = resolution.layers.get(layer) ?? [];
      resolution.layers.set(layer, gathered);
      gathered.push(resolvedAt(css.slice(open, end - 1), resolution));
    } else if (holds(rule, resolution)) {
      resolved += resolvedAt(css.slice(open, end - 1), resolution);
    }
    from = end;
    rules.lastIndex = end;
  }
  return resolved + css.slice(from);
}

const STILL_MOTION =
  ":root { --ui-duration-shape: 0s; --ui-duration-exit: 0s; --ui-duration-quick: 0s; --ui-duration-fast: 0s; --ui-duration-pane: 0s; }";

export function layContainersAt(
  widths: Readonly<Record<string, number>>,
  layout: ContainerLayout = {},
): HTMLStyleElement {
  const resolution: Resolution = { widths, layout, layers: new Map() };
  const laid = SHEETS.filter(
    ({ specifier }) => layout.only === undefined || layout.only.includes(specifier),
  );
  const unlayered = laid.map(({ css }) => resolvedAt(css, resolution));
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = [...[...resolution.layers.values()].flat(), ...unlayered, STILL_MOTION].join(
    "\n",
  );
  return style;
}

export function shown(element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if (getComputedStyle(at).display === "none") return false;
  }
  return true;
}
