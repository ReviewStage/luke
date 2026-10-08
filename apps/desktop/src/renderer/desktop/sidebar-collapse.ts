/**
 * sidebar-collapse.ts -- whether the plans' sidebar is folded away, kept across launches.
 *
 * The choice is the window's own and nobody else's: no other window draws the
 * sidebar and main never acts on it, so it is kept in the renderer's storage,
 * which lives under Luke's state root and outlives a relaunch, rather than
 * crossing to the settings file as a setting nobody else reads.
 */

import { useCallback, useEffect, useState } from "react";

/** The storage key the choice is kept under. */
const SIDEBAR_COLLAPSED_KEY = "luke.sidebar-collapsed";

/** The chord that folds and unfolds the sidebar, as an accelerator `Keycaps` draws. */
export const SIDEBAR_HOTKEY = "Command+B";

/** The same chord as `aria-keyshortcuts` spells it. */
export const SIDEBAR_HOTKEY_ARIA = "Meta+B";

export interface SidebarCollapse {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * The collapse and its chord. `available` is whether the sidebar is on
 * screen to fold — the Plans tab, the panel holding the keyboard — and the
 * chord answers only then, so Command-B in Settings or under a sheet is left
 * to whatever else wants it. The choice itself outlives an absence: Settings
 * hands back the sidebar the way it was left.
 */
export function useSidebarCollapse(available: boolean): SidebarCollapse {
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  );
  const onToggle = useCallback(() => setCollapsed((was) => !was), []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (!available) return;
    const handleKey = (event: KeyboardEvent) => {
      // The lowercase key is deliberate, as for Command-F: with Shift held
      // this is some other chord. A held key toggles once, not per repeat.
      if (event.key !== "b" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      event.preventDefault();
      if (!event.repeat) onToggle();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [available, onToggle]);

  return { collapsed, onToggle };
}
