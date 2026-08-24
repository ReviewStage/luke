import { MOTION_DURATION_MS } from "@sidecar/surface";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowMode } from "#shared/wire/session";
import {
  HIT_REGION,
  HIT_REGION_ATTRIBUTE,
  LEAVE_DELAY_MS,
  PANEL_PRESENTATION,
  type PanelPresentation,
  PEEK_ENTER_DELAY_MS,
  presentationForMode,
  SETTLE_DELAY_MS,
} from "./panel-state";

/**
 * Whether a pointer leave should schedule a close. The slot and the composer
 * stay put — someone is in the middle of writing, often in a browser — and a
 * key or ask being typed holds the panel the same way. A panel whose shape
 * has just receded out from under the pointer stays too: entering a settings
 * page shorter than the one it replaces shrinks the shape past a resting
 * hand, and that is the shape leaving the pointer, not the pointer leaving
 * the shape.
 */
export function pointerLeaveSchedules(input: {
  presentation: PanelPresentation;
  hold: boolean;
  receded: boolean;
}): boolean {
  if (input.presentation === PANEL_PRESENTATION.CAPSULE) return false;
  if (input.presentation === PANEL_PRESENTATION.SLOT) return false;
  if (input.presentation === PANEL_PRESENTATION.FEEDBACK) return false;
  if (input.presentation === PANEL_PRESENTATION.PANEL && (input.hold || input.receded)) {
    return false;
  }
  return true;
}

/**
 * How long a marked recede is still travelling: exit plus shape, the same
 * clock the collapse spends. Until it has passed, the vacated footprint still
 * answers hit tests — the surface and the panel's clip spring down behind the
 * content — so what the pointer is confirmed over inside this window may be
 * ground the shape is about to leave.
 */
export const RECEDE_SETTLE_MS = MOTION_DURATION_MS.EXIT + MOTION_DURATION_MS.SURFACE;

/**
 * Whether the shape shrinking marks the pointer as left behind. Only the
 * panel follows its content down under a resting pointer — the slot and the
 * composer never close by leaving anyway — and only a pointer actually on
 * the shape can be left by it: a shrink with the pointer already away has
 * nobody to protect, and marking it would swallow a later, genuine leave.
 */
export function recedeArms(input: {
  presentation: PanelPresentation;
  pointerInside: boolean;
}): boolean {
  return input.presentation === PANEL_PRESENTATION.PANEL && input.pointerInside;
}

/**
 * Whether a pointer confirmed over the panel's content releases the recede
 * mark. Only once the recede has settled: while the spring is still
 * travelling, the vacated footprint itself answers as content, so a twitch
 * during the shrink would spend the protection one frame before the leave it
 * exists for.
 */
export function recedeReleases(input: { recededAt: number; now: number }): boolean {
  return input.now - input.recededAt >= RECEDE_SETTLE_MS;
}

/** What the leave timer does when it fires, reading the shape as it is now. */
export const POINTER_LEAVE_FIRE = {
  IGNORE: "ignore",
  CAPSULE: "capsule",
  COLLAPSE: "collapse",
} as const;

export type PointerLeaveFire = (typeof POINTER_LEAVE_FIRE)[keyof typeof POINTER_LEAVE_FIRE];

export function pointerLeaveFires(input: {
  presentation: PanelPresentation;
  hold: boolean;
}): PointerLeaveFire {
  if (input.presentation === PANEL_PRESENTATION.PEEK) return POINTER_LEAVE_FIRE.CAPSULE;
  if (input.presentation === PANEL_PRESENTATION.PANEL) {
    return input.hold ? POINTER_LEAVE_FIRE.IGNORE : POINTER_LEAVE_FIRE.COLLAPSE;
  }
  return POINTER_LEAVE_FIRE.IGNORE;
}

/** Hovering the capsule peeks; any other shape is already answering the pointer. */
export function pointerEnterPeeks(presentation: PanelPresentation): boolean {
  return presentation === PANEL_PRESENTATION.CAPSULE;
}

/**
 * Whether closing to the capsule keeps the settings tab. A half-written key
 * or note is what someone is in the middle of; the list is not.
 */
export function capsuleKeepsTab(composerHeld: boolean): boolean {
  return composerHeld;
}

/**
 * Letting go of the ask field while the pointer is already away has to
 * release the hold the caret had — the pointer cannot leave a second time.
 */
export function askDisengageLeaves(input: {
  wasEngaged: boolean;
  engaged: boolean;
  pointerInside: boolean;
}): boolean {
  return input.wasEngaged && !input.engaged && !input.pointerInside;
}

function usePointerPassthrough(
  onHitRegionEnter: () => void,
  onHitRegionLeave: () => void,
  onPointerOverPanel: () => void,
  presentation: PanelPresentation,
): void {
  const lastValue = useRef<boolean | undefined>(undefined);
  const lastPoint = useRef<{ x: number; y: number } | undefined>(undefined);

  const update = useCallback(
    (interceptsPointer: boolean) => {
      if (lastValue.current === interceptsPointer) return;
      lastValue.current = interceptsPointer;
      window.sidecar.setPointerInterception(interceptsPointer);
      if (interceptsPointer) onHitRegionEnter();
      else onHitRegionLeave();
    },
    [onHitRegionEnter, onHitRegionLeave],
  );

  const testLastPoint = useCallback(
    (drawn: PanelPresentation) => {
      const point = lastPoint.current;
      if (!point) return;
      // `elementFromPoint` answers null for a point outside the viewport, which a
      // forwarded move can carry. Comparing that against null read as "still
      // inside", so leaving by the edge left the panel open until some other
      // event closed it.
      const region = document
        .elementFromPoint(point.x, point.y)
        ?.closest(`[${HIT_REGION_ATTRIBUTE}]`);
      const kind = region?.getAttribute(HIT_REGION_ATTRIBUTE);
      const overPanel = kind === HIT_REGION.PANEL && drawn === PANEL_PRESENTATION.PANEL;
      // Reported on every move rather than on the transition, because it is
      // what releases a recede mark: a pointer resting on the panel as it now
      // stands is not one the shape left behind.
      if (overPanel) onPointerOverPanel();
      // The shape takes the pointer wherever it is drawn, which is the whole
      // rule: the capsule strip and the panel's body are what sit on top of it
      // and answer first. The surface is what answers in between — the panel's
      // body is not a target for the first `--expand-delay` of an opening, and
      // by then the strip has already narrowed from the peek's width back to
      // the capsule's, so a press out where the marks unfold would otherwise
      // land on nothing and read as the pointer leaving.
      update(
        kind === HIT_REGION.SURFACE ||
          kind === HIT_REGION.CAPSULE ||
          overPanel ||
          (kind === HIT_REGION.SLOT && drawn === PANEL_PRESENTATION.SLOT) ||
          (kind === HIT_REGION.FEEDBACK && drawn === PANEL_PRESENTATION.FEEDBACK),
      );
    },
    [onPointerOverPanel, update],
  );

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      lastPoint.current = { x: event.clientX, y: event.clientY };
      testLastPoint(presentation);
    };
    const handleLeave = () => {
      lastPoint.current = undefined;
      update(false);
    };
    window.addEventListener("mousemove", handleMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", handleLeave);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      document.documentElement.removeEventListener("mouseleave", handleLeave);
    };
  }, [presentation, testLastPoint, update]);

  // The shape can change under a pointer that never moves — Escape closes the
  // panel, and a spoken ask opens it — and what the pointer is over changes with it.
  // Without this the window keeps intercepting clicks for a shape that is no
  // longer drawn, and the window is always larger than the shape.
  useEffect(() => {
    testLastPoint(presentation);
  }, [presentation, testLastPoint]);
}

export interface PanelPresentationOptions {
  /**
   * A credential still on the settings tab, which holds the panel open against
   * the pointer the way the ask field does.
   */
  entryDrawn: () => boolean;
  /** A key or note being written, which keeps the settings tab through a close. */
  composerHeld: () => boolean;
  /** The sheet is only ever drawn inside the panel. */
  onNotPanel: () => void;
  /** Closing to the capsule resets the list: a filter is not something anyone is in the middle of. */
  onCapsuleList: () => void;
  /** And the tab, unless a composer is what they were in the middle of. */
  onCapsuleTab: () => void;
}

export interface PanelPresentationApi {
  presentation: PanelPresentation;
  current: () => PanelPresentation;
  generation: () => number;
  pointerInside: () => boolean;
  heldAgainstPointer: () => boolean;
  applyPresentation: (next: PanelPresentation) => void;
  applyAuthoritativeMode: (mode: WindowMode) => void;
  changeMode: (expanded: boolean) => Promise<void>;
  cancelHover: () => void;
  onHitRegionLeave: () => void;
  /** The drawn panel followed its content down and may have left the pointer. */
  panelReceded: () => void;
  changeAskEngagement: (engaged: boolean) => void;
  settle: () => void;
  leave: () => void;
  expand: () => void;
}

/**
 * The surface's shape, and the pointer's hold on it. Hovering peeks, leaving
 * closes, and a field someone is part-way through holds the panel the way a
 * hand on the shape does.
 */
export function usePanelPresentation(options: PanelPresentationOptions): PanelPresentationApi {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [presentation, setPresentation] = useState<PanelPresentation>(PANEL_PRESENTATION.CAPSULE);
  const presentationRef = useRef<PanelPresentation>(PANEL_PRESENTATION.CAPSULE);
  const hoverTimer = useRef<number | undefined>(undefined);
  const pointerInside = useRef(false);
  const modeGeneration = useRef(0);
  const askEngaged = useRef(false);
  /**
   * When the shape last receded out from under the pointer, undefined once
   * spent. Spent by the one leave it explains, by the pointer settling on the
   * panel as it now stands, by the pointer arriving back from outside, or by
   * the panel closing any way at all — a mark that survived into the next
   * opening would swallow that panel's first, genuine leave.
   */
  const recededAt = useRef<number | undefined>(undefined);

  const heldAgainstPointer = useCallback(
    () => optionsRef.current.entryDrawn() || askEngaged.current,
    [],
  );

  const cancelHover = useCallback(() => {
    if (hoverTimer.current === undefined) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  }, []);

  const applyPresentation = useCallback((next: PanelPresentation) => {
    presentationRef.current = next;
    setPresentation(next);
    if (next !== PANEL_PRESENTATION.PANEL) recededAt.current = undefined;
    const host = optionsRef.current;
    // The sheet is only ever drawn inside the panel, so any other shape puts
    // it away. Left set behind a shape that cannot draw it, it would be over
    // the list again the next time the panel came forward with nothing having
    // been pressed — and a key half-entered is the one thing that survives a
    // close, which the sheet is not.
    if (next !== PANEL_PRESENTATION.PANEL) host.onNotPanel();
    // A panel that has closed reopens on the session list, showing every
    // session with whatever needs a person first: settings are somewhere you
    // go, not a state the capsule remembers, and a filter left in place would
    // let the panel hide a session the capsule is still counting.
    //
    // Something half-written is the one exception, and only to the tab — a
    // key being entered or a note to the founders alike: it is what someone
    // is in the middle of, so however the panel closed, it opens again where
    // they left it. The list is not something anyone is in the middle of, so
    // it resets either way.
    if (next === PANEL_PRESENTATION.CAPSULE) {
      host.onCapsuleList();
      if (!capsuleKeepsTab(host.composerHeld())) host.onCapsuleTab();
    }
  }, []);

  const applyAuthoritativeMode = useCallback(
    (nextMode: WindowMode) => {
      // A lifecycle notification can originate outside this renderer (for
      // example from a spoken ask). Ignore an older IPC result that arrives later.
      modeGeneration.current += 1;
      applyPresentation(presentationForMode(nextMode));
    },
    [applyPresentation],
  );

  /**
   * Only the panel needs the main process. The capsule and the peek share a
   * window, so hovering never leaves the renderer — which is what lets the peek
   * answer the pointer immediately.
   */
  const changeMode = useCallback(
    async (expanded: boolean) => {
      const previous = presentationRef.current;
      const generation = modeGeneration.current + 1;
      modeGeneration.current = generation;
      presentationRef.current = expanded ? PANEL_PRESENTATION.PANEL : PANEL_PRESENTATION.CAPSULE;
      // Spent here as well as on the confirmed presentation, because a newer
      // generation can win the race and leave this call's applyPresentation
      // unmade — a mark surviving that into a reopened panel would swallow
      // its first genuine leave.
      if (!expanded) recededAt.current = undefined;
      try {
        // Asking for focus is what makes Escape reach the panel someone opened.
        const confirmedMode = await window.sidecar.setExpanded(expanded, expanded);
        if (modeGeneration.current === generation) {
          applyPresentation(presentationForMode(confirmedMode));
        }
      } catch (error) {
        if (modeGeneration.current === generation) presentationRef.current = previous;
        throw error;
      }
    },
    [applyPresentation],
  );

  const onHitRegionEnter = useCallback(() => {
    cancelHover();
    pointerInside.current = true;
    // A pointer arriving from outside ends whatever story a mark was telling:
    // it is back on the shape, so its next leave is its own act. The arrival
    // cannot land between a recede and the leave it explains — the surface
    // covers the pointer for that whole stretch, so no enter fires there.
    recededAt.current = undefined;
    if (!pointerEnterPeeks(presentationRef.current)) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      if (presentationRef.current === PANEL_PRESENTATION.CAPSULE) {
        applyPresentation(PANEL_PRESENTATION.PEEK);
      }
    }, PEEK_ENTER_DELAY_MS);
  }, [applyPresentation, cancelHover]);

  const onHitRegionLeave = useCallback(() => {
    cancelHover();
    pointerInside.current = false;
    // Read and spent in the same breath: the mark explains exactly one leave,
    // and the next one is the pointer's own act again.
    const receded = recededAt.current !== undefined;
    recededAt.current = undefined;
    if (
      !pointerLeaveSchedules({
        presentation: presentationRef.current,
        hold: heldAgainstPointer(),
        receded,
      })
    ) {
      return;
    }
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      const fire = pointerLeaveFires({
        presentation: presentationRef.current,
        hold: heldAgainstPointer(),
      });
      if (fire === POINTER_LEAVE_FIRE.CAPSULE) applyPresentation(PANEL_PRESENTATION.CAPSULE);
      else if (fire === POINTER_LEAVE_FIRE.COLLAPSE) void changeMode(false);
    }, LEAVE_DELAY_MS);
  }, [applyPresentation, cancelHover, changeMode, heldAgainstPointer]);

  const changeAskEngagement = useCallback(
    (engaged: boolean) => {
      const leave = askDisengageLeaves({
        wasEngaged: askEngaged.current,
        engaged,
        pointerInside: pointerInside.current,
      });
      askEngaged.current = engaged;
      if (leave) onHitRegionLeave();
    },
    [onHitRegionLeave],
  );

  const settle = useCallback(() => {
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      if (presentationRef.current === PANEL_PRESENTATION.PANEL) void changeMode(false);
    }, SETTLE_DELAY_MS);
  }, [changeMode]);

  const leave = useCallback(() => {
    void changeMode(false);
  }, [changeMode]);

  const expand = useCallback(() => {
    void changeMode(true);
  }, [changeMode]);

  const panelReceded = useCallback(() => {
    const arms = recedeArms({
      presentation: presentationRef.current,
      pointerInside: pointerInside.current,
    });
    if (arms) recededAt.current = performance.now();
  }, []);

  const onPointerOverPanel = useCallback(() => {
    const marked = recededAt.current;
    if (marked === undefined) return;
    if (recedeReleases({ recededAt: marked, now: performance.now() })) {
      recededAt.current = undefined;
    }
  }, []);

  const presentationOf = useCallback(() => presentationRef.current, []);
  const modeGenerationOf = useCallback(() => modeGeneration.current, []);
  const pointerIsInside = useCallback(() => pointerInside.current, []);

  usePointerPassthrough(onHitRegionEnter, onHitRegionLeave, onPointerOverPanel, presentation);

  useEffect(() => () => cancelHover(), [cancelHover]);

  return {
    presentation,
    current: presentationOf,
    generation: modeGenerationOf,
    pointerInside: pointerIsInside,
    heldAgainstPointer,
    applyPresentation,
    applyAuthoritativeMode,
    changeMode,
    cancelHover,
    onHitRegionLeave,
    panelReceded,
    changeAskEngagement,
    settle,
    leave,
    expand,
  };
}
