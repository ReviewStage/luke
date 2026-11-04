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
 * page-theme.ts -- the window's theme handed to a page it frames: answered when the page asks, and sent again each time the window's appearance flips.
 *
 * A page wears the theme as `--vespin-*` variables (`@repo/features/page-theme`),
 * each the value of one of the window's own roles as its root holds it now,
 * and the scheme the window is drawn in. A role the desktop writes as
 * `light-dark()` is handed as written, so the page reads it in the scheme it
 * is handed beside it. The ask is heard from the frame drawn alone, and the
 * answer goes to that frame alone.
 */

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
};

const isAsk = Schema.is(pageThemeAskSchema);

/** The theme as the window's root draws it now. */
function themeNow(): PageTheme {
  const drawn = getComputedStyle(document.documentElement);
  const variables = Object.fromEntries(
    Object.entries(ROLE_OF).map(([variable, role]) => [
      variable,
      drawn.getPropertyValue(role).trim(),
    ]),
  ) as Record<PageThemeVariable, string>;
  return { scheme: drawnDark() ? PAGE_THEME_SCHEME.DARK : PAGE_THEME_SCHEME.LIGHT, variables };
}

/** Hands the page in `frame` the window's theme when it asks, and again each time the window's appearance flips. */
export function usePageTheme(frame: RefObject<HTMLIFrameElement | null>): void {
  useEffect(() => {
    const send = () => frame.current?.contentWindow?.postMessage(pageThemeMessage(themeNow()), "*");
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
  }, [frame]);
}
