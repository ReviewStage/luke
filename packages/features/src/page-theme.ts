import { Schema as EffectSchema } from "effect";

const PAGE_THEME_ASK_TYPE = "app-page-theme-ask";

const PAGE_THEME_TYPE = "app-page-theme";

export const PAGE_WIDE_CLASS = "page-wide";

const PAGE_THEME_LEGACY_PREFIX = "--vespin-";

export const PAGE_THEME_SCHEME = {
  DARK: "dark",
  LIGHT: "light",
} as const;

export type PageThemeScheme = (typeof PAGE_THEME_SCHEME)[keyof typeof PAGE_THEME_SCHEME];

export const PAGE_THEME_VARIABLE = {
  BACKGROUND: "--app-background",
  FOREGROUND: "--app-foreground",
  MUTED_FOREGROUND: "--app-muted-foreground",
  SURFACE: "--app-surface",
  WELL: "--app-well",
  BORDER: "--app-border",
  BORDER_STRONG: "--app-border-strong",
  ACCENT: "--app-accent",
  ACCENT_TEXT: "--app-accent-text",
  SUCCESS: "--app-success",
  WARNING: "--app-warning",
  DANGER: "--app-danger",
  CHART_1: "--app-chart-1",
  CHART_2: "--app-chart-2",
  CHART_3: "--app-chart-3",
  CHART_4: "--app-chart-4",
  CHART_5: "--app-chart-5",
  FONT_SANS: "--app-font-sans",
  FONT_MONO: "--app-font-mono",
  TEXT_SIZE: "--app-text-size",
  TEXT_LEADING: "--app-text-leading",
  RADIUS: "--app-radius",
  READING_WIDTH: "--app-reading-width",
} as const;

export type PageThemeVariable = (typeof PAGE_THEME_VARIABLE)[keyof typeof PAGE_THEME_VARIABLE];

export interface PageTheme {
  readonly scheme: PageThemeScheme;
  readonly variables: Readonly<Record<PageThemeVariable, string>>;
  readonly inset: string;
  readonly narrowInset: string;
}

export const pageThemeAskSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(PAGE_THEME_ASK_TYPE),
});

export function pageThemeMessage(theme: PageTheme): {
  readonly type: typeof PAGE_THEME_TYPE;
  readonly scheme: PageThemeScheme;
  readonly variables: Readonly<Record<string, string>>;
  readonly inset: string;
  readonly narrowInset: string;
} {
  return {
    type: PAGE_THEME_TYPE,
    scheme: theme.scheme,
    variables: theme.variables,
    inset: theme.inset,
    narrowInset: theme.narrowInset,
  };
}

export const PAGE_THEME_SCRIPT = `(() => {
  "use strict";
  const TYPE = ${JSON.stringify(PAGE_THEME_TYPE)};
  const ASK = ${JSON.stringify(PAGE_THEME_ASK_TYPE)};
  const PREFIX = "--app-";
  const LEGACY = ${JSON.stringify(PAGE_THEME_LEGACY_PREFIX)};
  const NAME = /^--app-[a-z0-9-]+$/;
  const VALUE = /^[^;{}<>\\\\]*$/;
  const WIDE = ${JSON.stringify(PAGE_WIDE_CLASS)};
  const READING =
    "html{container-type:inline-size}" +
    "body{max-width:var(${PAGE_THEME_VARIABLE.READING_WIDTH})}html>body{margin-inline:auto}" +
    "body." + WIDE + "{max-width:none}" +
    "body ." + WIDE + "{box-sizing:border-box;width:100cqw;max-width:none;margin-inline:calc((100% - 100cqw) / 2)}" +
    ":where(body ." + WIDE + "){justify-content:safe center}";
  let sheet = null;

  const length = (value) => typeof value === "string" && value !== "" && VALUE.test(value);
  const wear = (scheme, variables, inset, narrowInset) => {
    let rules = "color-scheme:" + (scheme === "dark" ? "dark" : "light") + ";";
    for (const name of Object.keys(variables)) {
      const value = variables[name];
      if (!NAME.test(name) || typeof value !== "string" || !VALUE.test(value)) continue;
      rules += name + ":" + value + ";" + LEGACY + name.slice(PREFIX.length) + ":" + value + ";";
    }
    if (sheet === null) {
      sheet = document.createElement("style");
      const head = document.head || document.documentElement;
      head.insertBefore(sheet, head.firstChild);
    }
    let room = length(inset) ? "html{padding:" + inset + "}" : "";
    if (room !== "" && length(narrowInset)) room += "@media (max-width:479.98px){html{padding:" + narrowInset + "}}";
    sheet.textContent = ":root{" + rules + "}" + room + READING;
  };

  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (data === null || typeof data !== "object" || data.type !== TYPE) return;
    if (data.variables === null || typeof data.variables !== "object") return;
    wear(data.scheme, data.variables, data.inset, data.narrowInset);
  });
  parent.postMessage({ type: ASK }, "*");
})();`;
