/**
 * open-page-guard.ts -- what the `no-open-page-from-button` rule reads: which
 * `@luke/ui` components are buttons, and the calls that open a page outside
 * the window. The rule started clean, so it takes no baseline. A page to open is a link (`ButtonLink`, `TextLink`, or `Chip`'s
 * `href`), which a right-click, ⌘-click and a reader's link list find.
 */
export const OPEN_PAGE_GUARD_RULE = "anti-slop/no-open-page-from-button";

/** The `@luke/ui` components that draw a button, by the name they are exported under. */
export const BUTTON_COMPONENTS: ReadonlySet<string> = new Set([
  "Button",
  "IconButton",
  "TextButton",
  "SplitButton",
  "FoldingButton",
  "ProviderButton",
  "Chip",
]);

/**
 * The calls that open an address outside the window, by the name they are
 * made by: the window's door (`useOpenLink`'s `openLink`), the platform's
 * (`openWeb`, `openGitHub`), and Electron's and the browser's own.
 */
export const OPEN_PAGE_CALLS: ReadonlySet<string> = new Set([
  "openExternal",
  "openUrl",
  "openLink",
  "openWeb",
  "openGitHub",
]);

/** The globals whose `open` is the browser's `window.open`. */
export const WINDOW_GLOBALS: ReadonlySet<string> = new Set(["window", "globalThis"]);
