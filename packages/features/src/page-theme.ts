import { Schema as EffectSchema } from "effect";

/**
 * page-theme.ts -- the app's theme as a plan's page wears it: the variables a page draws with, which the window hands it, and the color scheme they are read in.
 *
 * A page is drawn inside the app, in a transcript, an Inbox thread, or its
 * tab, so it should read as the app does, in the app's light or dark, its
 * colors, its type, and its corners. Its frame holds an opaque origin, so it
 * cannot read the window's tokens; every server of a page therefore answers
 * it with one more script of our own ahead of the agent's HTML
 * (`withPageScripts`), which asks the window for the theme as the page is
 * read and wears whatever the window answers, again each time the window's
 * appearance flips.
 *
 * The page wears the theme as `--app-*` variables and a `color-scheme` on
 * its root, in a sheet of its own placed ahead of the page's own styles, so a
 * page that sets either itself keeps its own. A page that paints no ground of
 * its own reads on the ground it is drawn over, the transcript's or the tab's,
 * in the scheme the window draws in, rather than on the browser's light
 * canvas. Drawn in words, a transcript's or a thread's, the page stands at
 * the words' own edges, so it is told to keep no side room of its own; drawn
 * in a room of its own, its tab, the window hands it an inset
 * as well, which the script keeps around the page as its root's padding, so
 * its words stand off the room's edges as the window's own pages do: the
 * window's page inset, and its narrow inset in a frame under 480px wide.
 * What the window sends is the window's word and carries no
 * credential, only colors, fonts, and sizes; the script takes it only from
 * the window that framed the page and only in the shape below.
 */

/** The mark the page's ask wears, setting it apart from whatever else the page posts. */
const PAGE_THEME_ASK_TYPE = "app-page-theme-ask";

/** The mark the window's answer wears. */
const PAGE_THEME_TYPE = "app-page-theme";

/** The class a page gives an element, or its body, to stand across the frame rather than at reading width. */
export const PAGE_WIDE_CLASS = "page-wide";

/**
 * The prefix the variables were first handed under, before they took a name
 * that leaves the product out. Pages shown then are stored as written, so the
 * script hands each variable under this prefix as well, and no agent is told it.
 */
const PAGE_THEME_LEGACY_PREFIX = "--vespin-";

/** The scheme a page is drawn in, as the window draws. */
export const PAGE_THEME_SCHEME = {
  DARK: "dark",
  LIGHT: "light",
} as const;

export type PageThemeScheme = (typeof PAGE_THEME_SCHEME)[keyof typeof PAGE_THEME_SCHEME];

/**
 * The variables a page may draw with, by the names it reads them by, and
 * what each is for, which an agent writing a page is told.
 */
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

/** The theme the window hands a page: the scheme it draws in, each variable's value, and the room kept around it. */
export interface PageTheme {
  readonly scheme: PageThemeScheme;
  readonly variables: Readonly<Record<PageThemeVariable, string>>;
  /** The padding kept around the page's root, a CSS length; empty where the page stands at its room's edges. */
  readonly inset: string;
  /** The padding kept instead in a frame under 480px wide. */
  readonly narrowInset: string;
}

/** A message the frame posts to the window: the page asking for the theme. */
export const pageThemeAskSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(PAGE_THEME_ASK_TYPE),
});

/** The message the window posts to the frame, answering an ask or as its appearance flips. */
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

/**
 * The script the frame runs, ahead of the page's own. It is plain JavaScript
 * in a string because it runs in the page, apart from every bundle of ours.
 * It asks the window for the theme as the page is read and wears each answer
 * from the window alone, taking only `--app-*` names and values that
 * cannot close the rule they stand in, in a sheet it places first in the
 * page's head, so the page's own rules come after it and win. The inset is
 * the root's padding by the `html` element's name, which a page's own `*`
 * reset does not outweigh and its own `html` rule does.
 *
 * The page's body stands at reading width, centered, unless the page says
 * otherwise: its width by `body`, which a page's own `max-width` on its body
 * outweighs, and its centering by `html>body`, which a page's own
 * `body { margin: 0 }` reset does not, so the happy path needs nothing of
 * the page. A body of
 * the wide class stands across the frame, and an element of it stands across
 * the frame from within its reading-width parent, measured against the root
 * as a container, so its width leaves out the scrollbar and the inset.
 */
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
    "body ." + WIDE + "{box-sizing:border-box;width:100cqw;max-width:none;margin-inline:calc((100% - 100cqw) / 2)}";
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
