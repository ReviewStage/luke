import { Schema } from "effect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { keptFlag, keptKey, useKept } from "../use-kept.js";
import { PANE_FLOAT, type PaneFloat } from "./hover-pane.js";

export const SIDEBAR_WIDTH = {
  MIN: 200,
  MAX: 400,
  DEFAULT: 264,
} as const;

const SIDEBAR_COMPACT = {
  ENTER: 1120,
  LEAVE: 1160,
} as const;

export const SIDEBAR_OVERLAY = PANE_FLOAT;

type SidebarOverlay = PaneFloat;

const KEPT = {
  COLLAPSED: keptKey("app.sidebar-collapsed", keptFlag),
  WIDTH: keptKey("app.sidebar-width", Schema.FiniteFromString),
} as const;

function clampWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH.MAX, Math.max(SIDEBAR_WIDTH.MIN, Math.round(width)));
}

export function compactStage(width: number, was: boolean): boolean {
  return width < (was ? SIDEBAR_COMPACT.LEAVE : SIDEBAR_COMPACT.ENTER);
}

export interface SidebarCollapse {
  collapsed: boolean;
  compact: boolean;
  overlay: SidebarOverlay;
  width: number;
  onToggle: () => void;
  onOverlay: (overlay: SidebarOverlay) => void;
  onResize: (width: number) => void;
  staged: boolean;
}

export function sidebarInSight(sidebar: Pick<SidebarCollapse, "collapsed" | "overlay">): boolean {
  return !sidebar.collapsed || sidebar.overlay !== SIDEBAR_OVERLAY.CLOSED;
}

export function useSidebarCollapse(fixtureMode: boolean, compact: boolean): SidebarCollapse {
  const [kept, , changeKept] = useKept(KEPT.COLLAPSED, false);
  const [staged, setStaged] = useState(false);
  const [keptWidth, keepWidth] = useKept(KEPT.WIDTH, SIDEBAR_WIDTH.DEFAULT);
  const [stagedWidth, setStagedWidth] = useState<number>(SIDEBAR_WIDTH.DEFAULT);
  const [overlay, setOverlay] = useState<SidebarOverlay>(SIDEBAR_OVERLAY.CLOSED);
  const collapsed = (fixtureMode ? staged : kept) || compact;
  const width = fixtureMode ? stagedWidth : clampWidth(keptWidth);
  const onToggle = useCallback(() => {
    if (compact) {
      setOverlay((was) =>
        was === SIDEBAR_OVERLAY.OPEN ? SIDEBAR_OVERLAY.CLOSED : SIDEBAR_OVERLAY.OPEN,
      );
      return;
    }
    setOverlay(SIDEBAR_OVERLAY.CLOSED);
    (fixtureMode ? setStaged : changeKept)((was) => !was);
  }, [compact, fixtureMode, changeKept]);
  const onResize = useCallback(
    (asked: number) => (fixtureMode ? setStagedWidth : keepWidth)(clampWidth(asked)),
    [fixtureMode, keepWidth],
  );

  useEffect(() => {
    if (!collapsed) setOverlay(SIDEBAR_OVERLAY.CLOSED);
  }, [collapsed]);

  const shownOverlay = collapsed ? overlay : SIDEBAR_OVERLAY.CLOSED;
  return useMemo(
    () => ({
      collapsed,
      compact,
      overlay: shownOverlay,
      width,
      onToggle,
      onOverlay: setOverlay,
      onResize,
      staged: fixtureMode,
    }),
    [collapsed, compact, shownOverlay, width, onToggle, onResize, fixtureMode],
  );
}
