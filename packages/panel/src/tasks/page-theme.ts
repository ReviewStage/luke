import {
  PAGE_THEME_SCHEME,
  PAGE_THEME_VARIABLE,
  type PageTheme,
  type PageThemeVariable,
  pageThemeAskSchema,
  pageThemeMessage,
} from "@repo/features/page-theme";
import { drawnDark, onDrawnThemeChange } from "@repo/ui/appearance";
import { Schema } from "effect";
import { type RefObject, useEffect } from "react";

/**
 * page-theme.ts -- the window's theme handed to a page it frames, with the room kept around it where it stands: answered when the page asks, and sent again each time the window's appearance flips.
 *
 * A page wears the theme as `--app-*` variables (`@repo/features/page-theme`),
 * each the value of one of the window's own roles as its root holds it now,
 * and the scheme the window is drawn in. A role the desktop writes as
 * `light-dark()` is handed as written, so the page reads it in the scheme it
 * is handed beside it. The ask is heard from the frame drawn alone, and the
 * answer goes to that frame alone.
 *
 * A page is told to keep no side room of its own, since in words it stands
 * at the words' edges. In a room of its own, its tab in the side panel, the
 * window keeps that room for it instead: the inset the window's own pages
 * keep, and their narrow inset in a frame under 480px, so a page reads in
 * its tab, wide or on a phone, as the window's pages do.
 */

/** Where a page is drawn: in the words that tell of it, or in a room of its own, its tab. */
export const PAGE_ROOM = {
  WORDS: "words",
  OWN: "own",
} as const;

export type PageRoom = (typeof PAGE_ROOM)[keyof typeof PAGE_ROOM];

/** Each variable a page reads, by the window's role it carries. */
const ROLE_OF: Readonly<Record<PageThemeVariable, string>> = {
  [PAGE_THEME_VARIABLE.BACKGROUND]: "--ui-color-ground",
  [PAGE_THEME_VARIABLE.FOREGROUND]: "--ui-color-text",
  [PAGE_THEME_VARIABLE.MUTED_FOREGROUND]: "--ui-color-text-muted",
  [PAGE_THEME_VARIABLE.SURFACE]: "--ui-color-surface",
  [PAGE_THEME_VARIABLE.WELL]: "--ui-color-well",
  [PAGE_THEME_VARIABLE.BORDER]: "--ui-color-border",
  [PAGE_THEME_VARIABLE.BORDER_STRONG]: "--ui-color-border-strong",
  [PAGE_THEME_VARIABLE.ACCENT]: "--ui-color-accent",
  [PAGE_THEME_VARIABLE.ACCENT_TEXT]: "--ui-color-accent-text",
  [PAGE_THEME_VARIABLE.SUCCESS]: "--ui-color-complete",
  [PAGE_THEME_VARIABLE.WARNING]: "--ui-color-attention",
  [PAGE_THEME_VARIABLE.DANGER]: "--ui-color-danger",
  [PAGE_THEME_VARIABLE.CHART_1]: "--ui-color-chart-1",
  [PAGE_THEME_VARIABLE.CHART_2]: "--ui-color-chart-2",
  [PAGE_THEME_VARIABLE.CHART_3]: "--ui-color-chart-3",
  [PAGE_THEME_VARIABLE.CHART_4]: "--ui-color-chart-4",
  [PAGE_THEME_VARIABLE.CHART_5]: "--ui-color-chart-5",
  [PAGE_THEME_VARIABLE.FONT_SANS]: "--ui-font-sans",
  [PAGE_THEME_VARIABLE.FONT_MONO]: "--ui-font-mono",
  [PAGE_THEME_VARIABLE.TEXT_SIZE]: "--ui-type-body-size",
  [PAGE_THEME_VARIABLE.TEXT_LEADING]: "--ui-type-body-leading",
  [PAGE_THEME_VARIABLE.RADIUS]: "--ui-card-radius",
  [PAGE_THEME_VARIABLE.READING_WIDTH]: "--ui-page-measure",
};

const isAsk = Schema.is(pageThemeAskSchema);

/** The room kept around a page drawn in `room`, wide and narrow, as the window's root draws it now. */
function insetIn(
  room: PageRoom,
  drawn: CSSStyleDeclaration,
): Pick<PageTheme, "inset" | "narrowInset"> {
  if (room === PAGE_ROOM.WORDS) return { inset: "", narrowInset: "" };
  return {
    inset: drawn.getPropertyValue("--ui-page-inset").trim(),
    narrowInset: drawn.getPropertyValue("--ui-page-inset-narrow").trim(),
  };
}

/** The theme as the window's root draws it now, for a page drawn in `room`. */
function themeNow(room: PageRoom): PageTheme {
  const drawn = getComputedStyle(document.documentElement);
  const variables = Object.fromEntries(
    Object.entries(ROLE_OF).map(([variable, role]) => [
      variable,
      drawn.getPropertyValue(role).trim(),
    ]),
  ) as Record<PageThemeVariable, string>;
  return {
    scheme: drawnDark() ? PAGE_THEME_SCHEME.DARK : PAGE_THEME_SCHEME.LIGHT,
    variables,
    ...insetIn(room, drawn),
  };
}

/** Hands the page in `frame`, drawn in `room`, the window's theme when it asks, and again each time the window's appearance flips. */
export function usePageTheme(frame: RefObject<HTMLIFrameElement | null>, room: PageRoom): void {
  useEffect(() => {
    const send = () =>
      frame.current?.contentWindow?.postMessage(pageThemeMessage(themeNow(room)), "*");
    const hear = (event: MessageEvent) => {
      const framed = frame.current?.contentWindow;
      if (framed === null || framed === undefined || event.source !== framed) return;
      if (isAsk(event.data)) send();
    };
    window.addEventListener("message", hear);
    const stop = onDrawnThemeChange(send);
    return () => {
      window.removeEventListener("message", hear);
      stop();
    };
  }, [frame, room]);
}
