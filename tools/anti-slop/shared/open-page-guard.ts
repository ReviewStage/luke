export const OPEN_PAGE_GUARD_RULE = "anti-slop/no-open-page-from-button";

export const BUTTON_COMPONENTS: ReadonlySet<string> = new Set([
  "Button",
  "IconButton",
  "TextButton",
  "SplitButton",
  "FoldingButton",
  "ProviderButton",
  "Chip",
]);

export const OPEN_PAGE_CALLS: ReadonlySet<string> = new Set([
  "openExternal",
  "openUrl",
  "openLink",
  "openWeb",
  "openGitHub",
]);

export const WINDOW_GLOBALS: ReadonlySet<string> = new Set(["window", "globalThis"]);
