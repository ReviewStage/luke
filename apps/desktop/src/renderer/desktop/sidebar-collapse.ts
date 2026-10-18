/**
 * sidebar-collapse.ts -- whether the tasks' sidebar is folded away, by the developer or by a window too narrow to pin it, how wide it stands, and whether it floats open over the work.
 *
 * The choice is the window's own and nobody else's: no other window draws the
 * sidebar and main never acts on it, so it is kept in the renderer's storage,
 * which lives under Luke's state root and outlives a relaunch, rather than
 * crossing to the settings file as a setting nobody else reads.
 *
 * A window narrower than {@link SIDEBAR_COMPACT} folds the sidebar whatever
 * the choice says, as Linear's and AppKit's sidebars fold, and writes nothing
 * over the choice, so widening the window again hands back the sidebar as the
 * developer left it. A folded sidebar floats open over the work rather than
 * beside it: peeked while the pointer rests at the window's left edge and
 * put away once it leaves, as Linear's does, or opened by its toggle or
 * chord until a choice in it, Escape, or a press outside puts it away. Only
 * a window wide enough pins it again.
 */

import { PANE_FLOAT, type PaneFloat } from "@luke/panel/desktop/hover-pane";
import { Option, Schema } from "effect";
import { useCallback, useEffect, useState } from "react";

/** The storage keys the choices are kept under. */
const SIDEBAR_COLLAPSED_KEY = "luke.sidebar-collapsed";
const SIDEBAR_WIDTH_KEY = "luke.sidebar-width";

/**
 * How wide the sidebar may be dragged, in CSS pixels, and where it starts:
 * the range VS Code, Cursor, and Codex give theirs, around the width the
 * sidebar had before it could be dragged.
 */
export const SIDEBAR_WIDTH = {
  MIN: 200,
  MAX: 400,
  DEFAULT: 264,
} as const;

/**
 * The window widths, in CSS pixels, between which the sidebar is pinned or
 * floats. Narrower than `ENTER`, the window folds it: the work beside a
 * pinned sidebar at its default width would be left less than the Inbox's
 * list and the item it reads need side by side. Only wider than `LEAVE` is
 * it pinned again, so a window dragged across the line does not fold and
 * unfold the sidebar at every pixel.
 */
const SIDEBAR_COMPACT = {
  ENTER: 1120,
  LEAVE: 1160,
} as const;

/** How the folded sidebar stands over the work: as every pane that floats does (`hover-pane.ts`). */
export const SIDEBAR_OVERLAY = PANE_FLOAT;

type SidebarOverlay = PaneFloat;

const decodeWidth = Schema.decodeUnknownOption(Schema.FiniteFromString);

/** The kept choice, or open when there is none or storage refuses the read. */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function clampWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH.MAX, Math.max(SIDEBAR_WIDTH.MIN, Math.round(width)));
}

/** Whether the window is too narrow to pin the sidebar, given whether it was, so the line it crosses depends on the way it is crossed. */
function compactWindow(was: boolean): boolean {
  return window.innerWidth < (was ? SIDEBAR_COMPACT.LEAVE : SIDEBAR_COMPACT.ENTER);
}

/** The kept width, or the default when there is none, it no longer reads, or storage refuses the read. */
function readWidth(): number {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  } catch {
    // The default stands.
  }
  return clampWidth(Option.getOrElse(decodeWidth(stored), () => SIDEBAR_WIDTH.DEFAULT));
}

export interface SidebarCollapse {
  /** Whether the sidebar stands out of the window's columns: folded by the developer, or by a window too narrow to pin it. */
  collapsed: boolean;
  /** Whether the window is too narrow to pin the sidebar, so its toggle floats it over the work instead. */
  compact: boolean;
  /** How the folded sidebar stands over the work; always closed while it is pinned. */
  overlay: SidebarOverlay;
  /** The open sidebar's width in CSS pixels, always within {@link SIDEBAR_WIDTH}, kept while it is folded. */
  width: number;
  /** Pins the sidebar or folds it away; in a compact window, floats it open over the work or puts it away. */
  onToggle: () => void;
  /** Floats the folded sidebar over the work, as a peek or opened, or puts it away. */
  onOverlay: (overlay: SidebarOverlay) => void;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
  /** Whether the run keeps none of the sidebar's preferences: a fixture run, whose frames wear no developer's own. */
  staged: boolean;
}

/**
 * The collapse, the width, and the overlay. The chord is the sidebar toggle's
 * to offer, so it answers only while the toggle stands. The choice itself
 * outlives an absence: Settings hands back the sidebar the way it was left,
 * and so does a window widened past the compact line. The width outlives a
 * fold, so the sidebar opens again as wide as it closed. A fixture run starts
 * open at the default width and keeps nothing, so its frames never wear a
 * developer's own fold or width. The overlay goes with the fold it floats
 * over, so a pinned sidebar folded again starts away.
 */
export function useSidebarCollapse(fixtureMode: boolean): SidebarCollapse {
  // Note that the fixture run's fold is a state of its own rather than the
  // kept one reset, because the run is only known once the first state
  // arrives, a render after the kept fold was read.
  const [kept, setKept] = useState(readCollapsed);
  const [staged, setStaged] = useState(false);
  const [keptWidth, setKeptWidth] = useState(readWidth);
  const [stagedWidth, setStagedWidth] = useState<number>(SIDEBAR_WIDTH.DEFAULT);
  const [compact, setCompact] = useState(() => compactWindow(false));
  const [overlay, setOverlay] = useState<SidebarOverlay>(SIDEBAR_OVERLAY.CLOSED);
  const collapsed = (fixtureMode ? staged : kept) || compact;
  const width = fixtureMode ? stagedWidth : keptWidth;
  const onToggle = useCallback(() => {
    if (compact) {
      setOverlay((was) =>
        was === SIDEBAR_OVERLAY.OPEN ? SIDEBAR_OVERLAY.CLOSED : SIDEBAR_OVERLAY.OPEN,
      );
      return;
    }
    setOverlay(SIDEBAR_OVERLAY.CLOSED);
    (fixtureMode ? setStaged : setKept)((was) => !was);
  }, [compact, fixtureMode]);
  const onResize = useCallback(
    (asked: number) => (fixtureMode ? setStagedWidth : setKeptWidth)(clampWidth(asked)),
    [fixtureMode],
  );

  useEffect(() => {
    const follow = () => setCompact(compactWindow);
    follow();
    window.addEventListener("resize", follow);
    return () => window.removeEventListener("resize", follow);
  }, []);

  useEffect(() => {
    if (!collapsed) setOverlay(SIDEBAR_OVERLAY.CLOSED);
  }, [collapsed]);

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
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(keptWidth));
    } catch {
      // The sidebar keeps working at the width it holds.
    }
  }, [keptWidth]);

  return {
    collapsed,
    compact,
    overlay: collapsed ? overlay : SIDEBAR_OVERLAY.CLOSED,
    width,
    onToggle,
    onOverlay: setOverlay,
    onResize,
    staged: fixtureMode,
  };
}
