/**
 * sidebar-collapse.ts -- whether the plans' sidebar is folded away, and how wide it stands, kept across launches.
 *
 * The choice is the window's own and nobody else's: no other window draws the
 * sidebar and main never acts on it, so it is kept in the renderer's storage,
 * which lives under Luke's state root and outlives a relaunch, rather than
 * crossing to the settings file as a setting nobody else reads.
 */

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
  collapsed: boolean;
  /** The open sidebar's width in CSS pixels, always within {@link SIDEBAR_WIDTH}, kept while it is folded. */
  width: number;
  onToggle: () => void;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
}

/**
 * The collapse and the width. The chord is the sidebar toggle's to offer,
 * so it answers only while the toggle stands. The choice itself outlives an
 * absence: Settings hands back the sidebar the way it was left. The width
 * outlives a fold, so the sidebar opens again as wide as it closed. A fixture
 * run starts open at the default width and keeps nothing, so its frames never
 * wear a developer's own fold or width.
 */
export function useSidebarCollapse(fixtureMode: boolean): SidebarCollapse {
  // Note that the fixture run's fold is a state of its own rather than the
  // kept one reset, because the run is only known once the first state
  // arrives, a render after the kept fold was read.
  const [kept, setKept] = useState(readCollapsed);
  const [staged, setStaged] = useState(false);
  const [keptWidth, setKeptWidth] = useState(readWidth);
  const [stagedWidth, setStagedWidth] = useState<number>(SIDEBAR_WIDTH.DEFAULT);
  const collapsed = fixtureMode ? staged : kept;
  const width = fixtureMode ? stagedWidth : keptWidth;
  const onToggle = useCallback(
    () => (fixtureMode ? setStaged : setKept)((was) => !was),
    [fixtureMode],
  );
  const onResize = useCallback(
    (asked: number) => (fixtureMode ? setStagedWidth : setKeptWidth)(clampWidth(asked)),
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
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(keptWidth));
    } catch {
      // The sidebar keeps working at the width it holds.
    }
  }, [keptWidth]);

  return { collapsed, width, onToggle, onResize };
}
