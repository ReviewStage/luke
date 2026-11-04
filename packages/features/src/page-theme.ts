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
 * The page wears the theme as `--vespin-*` variables and a `color-scheme` on
 * its root, in a sheet of its own placed ahead of the page's own styles, so a
 * page that sets either itself keeps its own. A page that paints no ground of
 * its own reads on the ground it is drawn over, the transcript's or the tab's,
 * in the scheme the window draws in, rather than on the browser's light
 * canvas. Drawn in words, a transcript's or a thread's, the page stands at
the words' own edges, so it is told to keep no side room of its own; drawn
in a room of its own, its tab or full screen, the window hands it an inset
as well, which the script keeps around the page as its root's padding, so
its words stand off the room's edges as the window's own pages do. What the
window sends is the window's word and carries no
 * credential, only colors, fonts, and sizes; the script takes it only from
 * the window that framed the page and only in the shape below.
 */

/** The mark the page's ask wears, setting it apart from whatever else the page posts. */
const PAGE_THEME_ASK_TYPE = "app-page-theme-ask";

/** The mark the window's answer wears. */
const PAGE_THEME_TYPE = "app-page-theme";

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
  BACKGROUND: "--vespin-background",
  FOREGROUND: "--vespin-foreground",
  MUTED_FOREGROUND: "--vespin-muted-foreground",
  SURFACE: "--vespin-surface",
  WELL: "--vespin-well",
  BORDER: "--vespin-border",
  BORDER_STRONG: "--vespin-border-strong",
  ACCENT: "--vespin-accent",
  ACCENT_TEXT: "--vespin-accent-text",
  SUCCESS: "--vespin-success",
  WARNING: "--vespin-warning",
  DANGER: "--vespin-danger",
  CHART_1: "--vespin-chart-1",
  CHART_2: "--vespin-chart-2",
  CHART_3: "--vespin-chart-3",
  CHART_4: "--vespin-chart-4",
  CHART_5: "--vespin-chart-5",
  FONT_SANS: "--vespin-font-sans",
  FONT_MONO: "--vespin-font-mono",
  TEXT_SIZE: "--vespin-text-size",
  TEXT_LEADING: "--vespin-text-leading",
  RADIUS: "--vespin-radius",
} as const;

export type PageThemeVariable = (typeof PAGE_THEME_VARIABLE)[keyof typeof PAGE_THEME_VARIABLE];

/** The theme the window hands a page: the scheme it draws in, each variable's value, and the room kept around it. */
export interface PageTheme {
  readonly scheme: PageThemeScheme;
  readonly variables: Readonly<Record<PageThemeVariable, string>>;
  /** The padding kept around the page's root, a CSS length; empty where the page stands at its room's edges. */
  readonly inset: string;
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
} {
  return {
    type: PAGE_THEME_TYPE,
    scheme: theme.scheme,
    variables: theme.variables,
    inset: theme.inset,
  };
}

/**
 * The script the frame runs, ahead of the page's own. It is plain JavaScript
 * in a string because it runs in the page, apart from every bundle of ours.
 * It asks the window for the theme as the page is read and wears each answer
 * from the window alone, taking only `--vespin-*` names and values that
 * cannot close the rule they stand in, in a sheet it places first in the
 * page's head, so the page's own rules come after it and win. The inset is
 * the root's padding by the `html` element's name, which a page's own `*`
 * reset does not outweigh and its own `html` rule does.
 */
export const PAGE_THEME_SCRIPT = `(() => {
  "use strict";
  const TYPE = ${JSON.stringify(PAGE_THEME_TYPE)};
  const ASK = ${JSON.stringify(PAGE_THEME_ASK_TYPE)};
  const NAME = /^--vespin-[a-z0-9-]+$/;
  const VALUE = /^[^;{}<>\\\\]*$/;
  let sheet = null;

  const wear = (scheme, variables, inset) => {
    let rules = "color-scheme:" + (scheme === "dark" ? "dark" : "light") + ";";
    for (const name of Object.keys(variables)) {
      const value = variables[name];
      if (NAME.test(name) && typeof value === "string" && VALUE.test(value)) rules += name + ":" + value + ";";
    }
    if (sheet === null) {
      sheet = document.createElement("style");
      const head = document.head || document.documentElement;
      head.insertBefore(sheet, head.firstChild);
    }
    const room = typeof inset === "string" && inset !== "" && VALUE.test(inset) ? "html{padding:" + inset + "}" : "";
    sheet.textContent = ":root{" + rules + "}" + room;
  };

  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (data === null || typeof data !== "object" || data.type !== TYPE) return;
    if (data.variables === null || typeof data.variables !== "object") return;
    wear(data.scheme, data.variables, data.inset);
  });
  parent.postMessage({ type: ASK }, "*");
})();`;
