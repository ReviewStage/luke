import { appStateQuery, selectAppSettingsView } from "@repo/panel/use-app-state";
import type { Theme } from "@repo/ui";
import { wearTheme } from "@repo/ui/appearance";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import { THEME_KEY, tintChrome } from "../theme-chrome";

function keepChoice(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}

function wearAccountTheme(theme: Theme, root = document.documentElement): () => void {
  keepChoice(theme);
  return wearTheme(root, theme, () => tintChrome(root));
}

export function WebAppearance(): null {
  const theme = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data?.theme;
  useLayoutEffect(() => (theme === undefined ? undefined : wearAccountTheme(theme)), [theme]);
  return null;
}
