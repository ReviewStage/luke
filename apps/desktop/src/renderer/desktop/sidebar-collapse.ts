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

/** The kept choice, or open when there is none or storage refuses the read. */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export interface SidebarCollapse {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * The collapse and its chord. `available` is whether the sidebar is on
 * screen to fold — the Plans tab, the panel holding the keyboard — and the
 * chord answers only then, so Command-B in Settings or under a sheet is left
 * to whatever else wants it. The choice itself outlives an absence: Settings
 * hands back the sidebar the way it was left. A fixture run starts open and
 * keeps nothing, so its frames never wear a developer's own fold.
 */
export function useSidebarCollapse(available: boolean, fixtureMode: boolean): SidebarCollapse {
  // Note that the fixture run's fold is a state of its own rather than the
  // kept one reset, because the run is only known once the first state
  // arrives, a render after the kept fold was read.
  const [kept, setKept] = useState(readCollapsed);
  const [staged, setStaged] = useState(false);
  const collapsed = fixtureMode ? staged : kept;
  const onToggle = useCallback(
    () => (fixtureMode ? setStaged : setKept)((was) => !was),
    [fixtureMode],
  );

  // A write that fails costs only the preference, so it is not worth a word
  // on screen.
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(kept));
    } catch {
      // The sidebar keeps working on the state it holds.
    }
  }, [kept]);

  useEffect(() => {
    if (!available) return;
    const handleKey = (event: KeyboardEvent) => {
      // The lowercase key is deliberate, as for Command-F: with Shift held
      // this is some other chord. Command alone, because Control-B is the
      // text field's own caret-back. A held key toggles once, not per repeat.
      if (event.key !== "b" || !event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      if (!event.repeat) onToggle();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [available, onToggle]);

  return { collapsed, onToggle };
}
