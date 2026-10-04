import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import type { WindowMode } from "#shared/messages/session";
import { useAct } from "./act";
import {
  LEAVE_DELAY_MS,
  PANEL_PRESENTATION,
  type PanelPresentation,
  presentationForMode,
  SETTLE_DELAY_MS,
} from "./panel-state";

export interface PanelPresentationOptions {
  /**
   * A credential still on the settings tab, which holds the panel open against
   * the pointer the way the ask field does.
   */
  entryDrawn: () => boolean;
  /** A planning call in progress, which holds the panel open against the pointer too. */
  planningHeld: () => boolean;
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
  pointerInside: () => boolean;
  applyPresentation: (next: PanelPresentation) => void;
  applyAuthoritativeMode: (mode: WindowMode) => void;
  changeMode: (expanded: boolean) => Promise<void>;
  cancelHover: () => void;
  onHitRegionLeave: (travelled?: boolean) => void;
  /** The drawn panel followed its content down and may have left the pointer. */
  panelReceded: () => void;
  changeAskEngagement: (engaged: boolean) => void;
  settle: () => void;
  leave: () => void;
  expand: () => void;
}

/**
 * The surface's shape: the panel, or the panel stood down to one field — a
 * key, a consent wait, a note. Main answers every mode request with the
 * panel, so a close asked of the window leaves it open.
 */
export function usePanelPresentation(options: PanelPresentationOptions): PanelPresentationApi {
  const { act } = useAct();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // The window opens on the panel, so the first frame draws it.
  const [presentation, setPresentation] = useState<PanelPresentation>(PANEL_PRESENTATION.PANEL);
  const presentationRef = useRef<PanelPresentation>(PANEL_PRESENTATION.PANEL);
  const hoverTimer = useRef<number | undefined>(undefined);
  // The window is an ordinary app window that takes the pointer whole, so
  // the pointer is always on the panel: nothing the pointer does closes it.
  const pointerInside = useRef(true);
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
    () =>
      optionsRef.current.entryDrawn() || optionsRef.current.planningHeld() || askEngaged.current,
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
      if (!host.composerHeld()) host.onCapsuleTab();
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
        const confirmedMode = await act(ACT_KIND.WINDOW_SET_EXPANDED, {
          expanded,
          focus: expanded,
        });
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

  const onHitRegionLeave = useCallback(
    (travelled = true) => {
      cancelHover();
      pointerInside.current = false;
      // Read and spent in the same breath: the mark explains exactly one leave,
      // and the next one is the pointer's own action again.
      const receded = recededAt.current !== undefined;
      recededAt.current = undefined;
      // The slot and the composer stay put — someone is in the middle of
      // writing, often in a browser — and a key or ask being typed holds the
      // panel the same way. A panel whose shape has just receded out from
      // under the pointer stays too: entering a settings page shorter than
      // the one it replaces shrinks the shape past a resting hand, and that
      // is the shape leaving the pointer, not the pointer leaving the shape.
      // An untravelled leave is the same physics from the other side: a
      // pointer that has not moved since the shape took it cannot have left
      // it, so the leave is the shape's own doing — a greeting expanding
      // under a resting cursor, a window standing up beneath one — and
      // closing on it would collapse a panel nobody dismissed.
      const drawn = presentationRef.current;
      if (drawn === PANEL_PRESENTATION.CAPSULE) return;
      if (drawn === PANEL_PRESENTATION.SLOT) return;
      if (drawn === PANEL_PRESENTATION.FEEDBACK) return;
      if (drawn === PANEL_PRESENTATION.PANEL && (heldAgainstPointer() || receded || !travelled)) {
        return;
      }
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = undefined;
        const fired = presentationRef.current;
        if (fired === PANEL_PRESENTATION.PEEK) applyPresentation(PANEL_PRESENTATION.CAPSULE);
        else if (fired === PANEL_PRESENTATION.PANEL && !heldAgainstPointer()) {
          void changeMode(false);
        }
      }, LEAVE_DELAY_MS);
    },
    [applyPresentation, cancelHover, changeMode, heldAgainstPointer],
  );

  const changeAskEngagement = useCallback(
    (engaged: boolean) => {
      // Letting go of the field while the pointer is already away has to
      // release the hold the caret had — the pointer cannot leave a second
      // time.
      const leaves = askEngaged.current && !engaged && !pointerInside.current;
      askEngaged.current = engaged;
      if (leaves) onHitRegionLeave();
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

  // Only the panel follows its content down under a resting pointer — the
  // slot and the composer never close by leaving anyway — and only a pointer
  // actually on the shape can be left by it: a shrink with the pointer
  // already away has nobody to protect, and marking it would swallow a later,
  // genuine leave.
  const panelReceded = useCallback(() => {
    if (presentationRef.current !== PANEL_PRESENTATION.PANEL) return;
    if (!pointerInside.current) return;
    recededAt.current = performance.now();
  }, []);

  const presentationOf = useCallback(() => presentationRef.current, []);
  const pointerIsInside = useCallback(() => pointerInside.current, []);

  useEffect(() => () => cancelHover(), [cancelHover]);

  return {
    presentation,
    current: presentationOf,
    pointerInside: pointerIsInside,
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
