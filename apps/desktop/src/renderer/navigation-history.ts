/**
 * navigation-history.ts -- the window's back and forward: the places it has stood on, and the moves between them.
 *
 * A place is a plan's page, the new-plan page, or Settings, and the history
 * is the one a browser keeps: the places behind, the one standing, and the
 * places ahead, which a new visit clears. It is written by watching where the
 * window is rather than by each door that moves it, so a plan opened from the
 * sidebar, by a key, by starting it, or by the host itself is one more place
 * visited all the same, and a move through the history is the window arriving
 * where the history already stands. It lives as long as the window does, the
 * way a browser tab's does.
 *
 * Settings is one step however many of its pages are turned: entering it is
 * a visit, and choosing another of its pages turns the page that visit holds
 * in place, so Back from any page of it returns to wherever it was opened
 * from, and Forward brings it back on the page last open.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import type { PlansControl } from "./planning/use-plans-tab";
import type { SettingsView } from "./settings-views";

/** The most places the history holds; the oldest go first. */
const HISTORY_LIMIT = 50;

/** `MouseEvent.button` for the mouse's own back and forward buttons. */
const MOUSE_BUTTON = {
  BACK: 3,
  FORWARD: 4,
} as const;

/** Which kind of place the window is on. */
const PLACE_KIND = {
  PLAN: "plan",
  NEW_PLAN: "new-plan",
  SETTINGS: "settings",
} as const;

/** A place the window can stand on: a plan by its id, so a rename leaves it the same place. */
type Place =
  | { readonly kind: typeof PLACE_KIND.PLAN; readonly planId: string }
  | { readonly kind: typeof PLACE_KIND.NEW_PLAN }
  | { readonly kind: typeof PLACE_KIND.SETTINGS; readonly view: SettingsView };

interface Trail {
  readonly places: readonly Place[];
  readonly at: number;
}

const EMPTY_TRAIL: Trail = { places: [], at: -1 };

/** Whether two places are one step of the history: the same plan, the new-plan page, or Settings on any page. */
function sameStep(one: Place | undefined, other: Place): boolean {
  if (one === undefined || one.kind !== other.kind) return false;
  if (one.kind === PLACE_KIND.PLAN && other.kind === PLACE_KIND.PLAN) {
    return one.planId === other.planId;
  }
  return true;
}

/**
 * The trail with the window standing on `place`. A step already standing is
 * the same trail, but for a Settings page turned, which the standing step
 * takes in place.
 */
function visited(trail: Trail, place: Place): Trail {
  const standing = trail.places[trail.at];
  if (sameStep(standing, place)) {
    if (standing?.kind !== PLACE_KIND.SETTINGS || place.kind !== PLACE_KIND.SETTINGS) return trail;
    if (standing.view === place.view) return trail;
    return { places: trail.places.with(trail.at, place), at: trail.at };
  }
  const places = [...trail.places.slice(0, trail.at + 1), place].slice(-HISTORY_LIMIT);
  return { places, at: places.length - 1 };
}

/**
 * The nearest step one way along the trail the window can still go to,
 * skipping any it cannot reach and any that is the step it already stands
 * on, so a deleted plan between two visits of one page is passed over whole.
 */
function nearest(
  trail: Trail,
  step: -1 | 1,
  reachable: (place: Place) => boolean,
): number | undefined {
  const standing = trail.places[trail.at];
  for (let at = trail.at + step; at >= 0 && at < trail.places.length; at += step) {
    const place = trail.places[at];
    if (place !== undefined && reachable(place) && !sameStep(standing, place)) return at;
  }
  return undefined;
}

/** The window's history as its buttons and keys use it. */
export interface NavigationHistory {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/**
 * The history over where the window stands. `place` is nothing until the
 * window knows where it is, so a launch records no page it never showed.
 * `reachable` says whether a place can still be gone to — a deleted plan
 * cannot — and `go` takes the window there; the move's own arrival is then
 * recognised as the place the history already stands on, and records nothing.
 */
function useHistory(input: {
  place: Place | undefined;
  reachable: (place: Place) => boolean;
  go: (place: Place) => void;
}): NavigationHistory {
  const { place, reachable } = input;
  const [trail, setTrail] = useState<Trail>(EMPTY_TRAIL);
  // Note that the presses read the latest trail through a ref, because a key
  // can land between a move and the render that shows it, and the latest
  // `reachable` and `go` too, so a press stays the same function across renders.
  const latest = useRef({ trail, reachable, go: input.go });
  useLayoutEffect(() => {
    latest.current = { trail, reachable, go: input.go };
  });

  useEffect(() => {
    if (place !== undefined) setTrail((held) => visited(held, place));
  }, [place]);

  const step = useCallback((by: -1 | 1) => {
    const held = latest.current;
    const at = nearest(held.trail, by, held.reachable);
    const target = at === undefined ? undefined : held.trail.places[at];
    if (at === undefined || target === undefined) return;
    const moved = { places: held.trail.places, at };
    latest.current = { ...held, trail: moved };
    setTrail(moved);
    held.go(target);
  }, []);

  return {
    canGoBack: nearest(trail, -1, reachable) !== undefined,
    canGoForward: nearest(trail, 1, reachable) !== undefined,
    onBack: useCallback(() => step(-1), [step]),
    onForward: useCallback(() => step(1), [step]),
  };
}

/**
 * The window's history: Plans on the plan it is bound for — the one asked
 * for, so a move waiting on the host's answer is already where it is going —
 * or Settings on its page. A plan the account no longer lists is passed
 * over, unless the list itself could not be read; a plan that cannot be read
 * is still a place, and says so when it is gone back to. Going to a place
 * changes the tab only when it must, so a tab change is counted as any other.
 */
export function useWindowHistory(input: {
  /** Whether the window knows where it stands: its state has arrived, and no sign-in stands over it. */
  known: boolean;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  settingsView: SettingsView;
  onSettingsViewChange: (view: SettingsView) => void;
  plans: Pick<PlansControl, "boundFor" | "plans" | "listFailed" | "onSelect" | "onLeavePlan">;
}): NavigationHistory {
  const { known, tab, settingsView, plans } = input;
  const { boundFor } = plans;
  const place = useMemo((): Place | undefined => {
    if (!known) return undefined;
    if (tab === PANEL_TAB.SETTINGS) return { kind: PLACE_KIND.SETTINGS, view: settingsView };
    return boundFor === undefined
      ? { kind: PLACE_KIND.NEW_PLAN }
      : { kind: PLACE_KIND.PLAN, planId: boundFor };
  }, [known, tab, settingsView, boundFor]);
  const reachable = (to: Place) =>
    to.kind !== PLACE_KIND.PLAN ||
    plans.listFailed ||
    plans.plans.some((plan) => plan.id === to.planId);
  const go = (to: Place) => {
    if (to.kind === PLACE_KIND.SETTINGS) {
      if (tab !== PANEL_TAB.SETTINGS) input.onTabChange(PANEL_TAB.SETTINGS);
      input.onSettingsViewChange(to.view);
      return;
    }
    if (tab !== PANEL_TAB.PLANS) input.onTabChange(PANEL_TAB.PLANS);
    if (to.kind === PLACE_KIND.PLAN && boundFor !== to.planId) plans.onSelect(to.planId);
    if (to.kind === PLACE_KIND.NEW_PLAN && boundFor !== undefined) plans.onLeavePlan();
  };
  return useHistory({ place, reachable, go });
}

/**
 * The mouse's own back and forward buttons, the fourth and fifth, answered
 * while `enabled` as a browser answers them.
 */
export function useHistoryMouseButtons(history: NavigationHistory, enabled: boolean): void {
  const { onBack, onForward } = history;
  useEffect(() => {
    if (!enabled) return;
    const handleUp = (event: MouseEvent) => {
      if (event.button === MOUSE_BUTTON.BACK) onBack();
      if (event.button === MOUSE_BUTTON.FORWARD) onForward();
    };
    window.addEventListener("mouseup", handleUp);
    return () => window.removeEventListener("mouseup", handleUp);
  }, [enabled, onBack, onForward]);
}
