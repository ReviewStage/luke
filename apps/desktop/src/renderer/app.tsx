import type { NormalizedSession } from "@sidecar/core";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type {
  AppBootstrap,
  AppSettings,
  DisplayDiagnostic,
  MicrophoneStatus,
  WindowMode,
} from "../shared/contracts";
import { CREDENTIAL_SOURCE } from "../shared/contracts";
import type { CredentialProviderId } from "../shared/credential-providers";
import { CREDENTIAL_PROVIDER_LIST } from "../shared/credential-providers";
import type { CredentialEntry, CredentialEntryControl } from "./credential-entry";
import { isSubmittable, removalEndsEntry } from "./credential-entry";
import { KeySlot } from "./key-slot";
import { NotchWings } from "./notch-wings";
import { PanelBody } from "./panel-body";
import {
  HIT_REGION,
  LEAVE_DELAY_MS,
  PANEL_PRESENTATION,
  type PanelPresentation,
  PEEK_ENTER_DELAY_MS,
  presentationForMode,
  SETTLE_DELAY_MS,
} from "./panel-state";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import {
  arrangeSessions,
  DEFAULT_SESSION_VIEW,
  type DisplaySession,
  displaySessions,
  type SessionView,
  sessionTally,
  tallySummary,
} from "./session-model";
import { SESSION_OPTIONS_BUTTON_ID, SESSION_OPTIONS_ID } from "./session-parts";

function usePointerPassthrough(
  onHitRegionEnter: () => void,
  onHitRegionLeave: () => void,
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
      const region = document.elementFromPoint(point.x, point.y)?.closest("[data-hit-region]");
      const kind = region?.getAttribute("data-hit-region");
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
          (kind === HIT_REGION.PANEL && drawn === PANEL_PRESENTATION.PANEL) ||
          (kind === HIT_REGION.SLOT && drawn === PANEL_PRESENTATION.SLOT),
      );
    },
    [update],
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
  // panel, and the tray opens it — and what the pointer is over changes with it.
  // Without this the window keeps intercepting clicks for a shape that is no
  // longer drawn, and the window is always larger than the shape.
  useEffect(() => {
    testLastPoint(presentation);
  }, [presentation, testLastPoint]);
}

function notchStyle(display: DisplayDiagnostic): CSSProperties {
  return {
    "--notch-top-inset": `${display.notch.topInset}px`,
    "--notch-housing-width": `${display.notch.housingWidth}px`,
  } as CSSProperties;
}

function shapeHeightStyle(
  panelHeight: number | undefined,
  slotHeight: number | undefined,
): CSSProperties {
  return {
    ...(panelHeight === undefined ? {} : { "--panel-height": `${panelHeight}px` }),
    ...(slotHeight === undefined ? {} : { "--slot-height": `${slotHeight}px` }),
  } as CSSProperties;
}

/**
 * Reports a shape's own content height so the black surface can end where the
 * content does. The window stays one size; only the shape inside it follows
 * what it holds — the number of sessions in the panel, a refusal appearing
 * under the slot's field — which is what makes either one feel like a resize
 * rather than a redraw.
 */
function useShapeHeight(): [(element: HTMLElement | null) => void, number | undefined] {
  const observer = useRef<ResizeObserver | undefined>(undefined);
  const [height, setHeight] = useState<number>();

  // A callback ref rather than an effect: the panel mounts only once bootstrap
  // has resolved, and the slot only once a key is being entered — both after
  // the first render.
  const measured = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = undefined;
    if (!element) return;
    const measure = () => setHeight(Math.ceil(element.getBoundingClientRect().height));
    const nextObserver = new ResizeObserver(measure);
    nextObserver.observe(element);
    observer.current = nextObserver;
    measure();
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [measured, height];
}

export function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [sessions, setSessions] = useState<readonly NormalizedSession[]>([]);
  const [display, setDisplay] = useState<DisplayDiagnostic>();
  const [presentation, setPresentation] = useState<PanelPresentation>(PANEL_PRESENTATION.CAPSULE);
  const [tab, setTab] = useState<PanelTab>(PANEL_TAB.SESSIONS);
  const [sessionView, setSessionView] = useState<SessionView>(DEFAULT_SESSION_VIEW);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>();
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>("not-determined");
  const [microphoneError, setMicrophoneError] = useState<string>();
  const [analyser, setAnalyser] = useState<AnalyserNode>();
  const [entry, setEntry] = useState<CredentialEntry>();
  const [panelElement, panelHeight] = useShapeHeight();
  const [slotElement, slotHeight] = useShapeHeight();
  const audioContext = useRef<AudioContext | undefined>(undefined);
  const mediaStream = useRef<MediaStream | undefined>(undefined);
  const hoverTimer = useRef<number | undefined>(undefined);
  const presentationRef = useRef<PanelPresentation>(PANEL_PRESENTATION.CAPSULE);
  const tabRef = useRef<PanelTab>(PANEL_TAB.SESSIONS);
  const entryRef = useRef<CredentialEntry | undefined>(undefined);
  const pointerInside = useRef(false);
  const modeGeneration = useRef(0);

  const changeTab = useCallback((next: PanelTab) => {
    tabRef.current = next;
    setTab(next);
    // The sheet belongs to the session list, and it is drawn over the list it
    // belongs to, so leaving for Settings has to take it along.
    setOptionsOpen(false);
  }, []);

  // A choice made in the sheet puts the sheet away. It is drawn over the list
  // and is taller than a row, so a list narrowed to one or two sessions ends up
  // entirely behind it — the control would hide the very rows it was asked for,
  // which reads as a filter that shows nothing at all. The fallback the render
  // performs when a filter empties writes the view directly instead: that is the
  // list correcting itself, not somebody choosing.
  const changeSessionView = useCallback((next: SessionView) => {
    setSessionView(next);
    setOptionsOpen(false);
  }, []);

  const applyPresentation = useCallback(
    (next: PanelPresentation) => {
      presentationRef.current = next;
      setPresentation(next);
      // The sheet is only ever drawn inside the panel, so any other shape puts
      // it away. Left set behind a shape that cannot draw it, it would be over
      // the list again the next time the panel came forward with nothing having
      // been pressed — and a key half-entered is the one thing that survives a
      // close, which the sheet is not.
      if (next !== PANEL_PRESENTATION.PANEL) setOptionsOpen(false);
      // A panel that has closed reopens on the session list, showing every
      // session with whatever needs a person first: settings are somewhere you
      // go, not a state the capsule remembers, and a filter left in place would
      // let the panel hide a session the capsule is still counting.
      //
      // A key half-entered is the one exception, and only to the tab: it is
      // what someone is in the middle of, so however the panel closed, it opens
      // again where they left it. The list is not something anyone is in the
      // middle of, so it resets either way.
      if (next === PANEL_PRESENTATION.CAPSULE) {
        setSessionView(DEFAULT_SESSION_VIEW);
        if (entryRef.current === undefined) changeTab(PANEL_TAB.SESSIONS);
      }
    },
    [changeTab],
  );

  const applyAuthoritativeMode = useCallback(
    (nextMode: WindowMode) => {
      // A lifecycle notification can originate outside this renderer (for
      // example from the tray). Ignore an older IPC result that arrives later.
      modeGeneration.current += 1;
      applyPresentation(presentationForMode(nextMode));
    },
    [applyPresentation],
  );

  const stopMicrophone = useCallback(async () => {
    mediaStream.current?.getTracks().forEach((track) => {
      track.stop();
    });
    mediaStream.current = undefined;
    await audioContext.current?.close();
    audioContext.current = undefined;
    setAnalyser(undefined);
  }, []);

  const startMicrophone = useCallback(async () => {
    setMicrophoneError(undefined);
    const permission = await window.sidecar.requestMicrophone();
    setMicrophoneStatus(permission);
    if (permission !== "granted") return;

    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      await stopMicrophone();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      context = new AudioContext({ latencyHint: "interactive" });
      const source = context.createMediaStreamSource(stream);
      const nextAnalyser = context.createAnalyser();
      nextAnalyser.fftSize = 256;
      nextAnalyser.smoothingTimeConstant = 0.82;
      source.connect(nextAnalyser);
      mediaStream.current = stream;
      audioContext.current = context;
      setAnalyser(nextAnalyser);
    } catch (error) {
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      try {
        await context?.close();
      } catch {
        // Preserve the original setup error if browser cleanup also fails.
      }
      setMicrophoneError(error instanceof Error ? error.message : String(error));
    }
  }, [stopMicrophone]);

  const cancelHoverTransition = useCallback(() => {
    if (hoverTimer.current === undefined) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  }, []);

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

  const handleHitRegionEnter = useCallback(() => {
    cancelHoverTransition();
    pointerInside.current = true;
    if (presentationRef.current !== PANEL_PRESENTATION.CAPSULE) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      if (presentationRef.current === PANEL_PRESENTATION.CAPSULE) {
        applyPresentation(PANEL_PRESENTATION.PEEK);
      }
    }, PEEK_ENTER_DELAY_MS);
  }, [applyPresentation, cancelHoverTransition]);

  /**
   * True while a field someone could be part-way through is actually on screen.
   * An entry outlives the tab it was started on now, so holding the panel open
   * for one that is not drawn would leave the pointer unable to close a panel
   * showing nothing but sessions.
   */
  const entryIsDrawn = useCallback(
    () => entryRef.current !== undefined && tabRef.current === PANEL_TAB.SETTINGS,
    [],
  );

  const handleHitRegionLeave = useCallback(() => {
    cancelHoverTransition();
    pointerInside.current = false;
    const current = presentationRef.current;
    if (current === PANEL_PRESENTATION.CAPSULE) return;
    // The slot is drawn for someone who is somewhere else entirely — in a
    // browser, fetching the key it is waiting for — so the pointer being away
    // from it is the normal case rather than a dismissal.
    if (current === PANEL_PRESENTATION.SLOT) return;
    // A key half-typed is the one thing the pointer must not be allowed to
    // discard. Everything else on the settings tab closes like the sessions
    // tab does.
    if (current === PANEL_PRESENTATION.PANEL && entryIsDrawn()) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      if (presentationRef.current === PANEL_PRESENTATION.PEEK) {
        applyPresentation(PANEL_PRESENTATION.CAPSULE);
      } else if (presentationRef.current === PANEL_PRESENTATION.PANEL) {
        // Read again rather than trusting the answer from when this was
        // scheduled: an entry can begin inside the delay — pressing Connect and
        // reaching for the keyboard does exactly that — and a close decided
        // before it began would discard it.
        if (entryIsDrawn()) return;
        void changeMode(false);
      }
    }, LEAVE_DELAY_MS);
  }, [applyPresentation, cancelHoverTransition, changeMode, entryIsDrawn]);

  /**
   * The single place an entry changes. A key being entered holds the panel open
   * against the pointer, so ending one has to release that hold: an entry that
   * ends while the pointer is already away — Escape out of the field, say —
   * would otherwise leave the panel held open by nothing, because the pointer
   * cannot leave a second time.
   */
  const applyEntry = useCallback(
    (next: CredentialEntry | undefined) => {
      const released = entryRef.current !== undefined && next === undefined;
      entryRef.current = next;
      setEntry(next);
      if (released && !pointerInside.current) handleHitRegionLeave();
    },
    [handleHitRegionLeave],
  );

  /**
   * Brings the panel back around the line the entry belongs to, and leaves it
   * open the way every other way of opening it does — the pointer closes it by
   * visiting and leaving.
   */
  const restorePanel = useCallback(() => {
    changeTab(PANEL_TAB.SETTINGS);
    void changeMode(true);
  }, [changeMode, changeTab]);

  /**
   * Asking to write a key is asking for one thing, so the panel gets out of the
   * way of it: the shape goes down to the slot, which is the field and nothing
   * else. It is the same wherever the key is coming from — a first connection, a
   * stored key being replaced, or one standing in front of the environment's —
   * because they are all the same act.
   */
  const beginEntry = useCallback(
    (providerId: CredentialProviderId) => {
      applyEntry({ providerId, draft: "", busy: false, away: false });
      cancelHoverTransition();
      applyPresentation(PANEL_PRESENTATION.SLOT);
    },
    [applyEntry, applyPresentation, cancelHoverTransition],
  );

  const changeEntry = useCallback(
    (draft: string) => {
      const current = entryRef.current;
      // A key being written is not a moment to change the entry: the reply on
      // its way back is answering the entry that was sent, and it is recognised
      // by being that same entry. Nothing may replace it underneath but ending
      // it outright, which is a decision to stop listening for the reply.
      if (!current || current.busy) return;
      // Typing again answers the refusal, so the refusal goes.
      applyEntry({ ...current, draft, rejection: undefined });
    },
    [applyEntry],
  );

  /**
   * Sends the browser to the provider's key page. The entry remembers that it
   * did: from here on, the person this slot is waiting for is reading a page
   * that Luke — which floats above every window — would otherwise be sitting on
   * top of. It is also what the slot is for, so the shape is already right; the
   * panel is only stood down if the link was pressed from inside it.
   */
  const fetchKey = useCallback(() => {
    const current = entryRef.current;
    // Same rule as typing: the key on its way to the store is what the entry is
    // for, and going to fetch another one is not a reason to disturb it. Both
    // views disable the link while it is in flight, so this is the floor rather
    // than the answer.
    if (!current || current.busy) return;
    window.sidecar.openProviderApiKeys(current.providerId);
    applyEntry({ ...current, away: true });
    if (presentationRef.current === PANEL_PRESENTATION.SLOT) return;
    cancelHoverTransition();
    applyPresentation(PANEL_PRESENTATION.SLOT);
  }, [applyEntry, applyPresentation, cancelHoverTransition]);

  const cancelEntry = useCallback(() => {
    const away = entryRef.current?.away === true;
    const aside = presentationRef.current === PANEL_PRESENTATION.SLOT;
    applyEntry(undefined);
    if (!aside) return;
    // Giving up returns you where you were. If the key page was opened, that is
    // the browser, and Luke leaves; if it was not, it is the panel this entry
    // was started from.
    if (away) void changeMode(false);
    else restorePanel();
  }, [applyEntry, changeMode, restorePanel]);

  const commitEntry = useCallback(() => {
    const current = entryRef.current;
    if (!isSubmittable(current)) return;
    const sending = { ...current, busy: true, rejection: undefined };
    applyEntry(sending);
    void window.sidecar.setProviderApiKey(current.providerId, current.draft).then((result) => {
      // The store changed either way, so the sources are always taken.
      setSettings(result.settings);
      // Whoever is entering a key now is not necessarily whoever sent this one:
      // Escape reaches the slot while a save is in flight, and so does another
      // provider's Connect. A reply that outlived its own entry is spent.
      if (entryRef.current !== sending) return;
      if (result.reason) {
        applyEntry({ ...sending, busy: false, rejection: result.reason });
        return;
      }
      applyEntry(undefined);
      // Saved from the slot: the whole panel comes back around the provider
      // that is now connected, because the check appearing beside its name is
      // the answer to what was just done.
      if (presentationRef.current !== PANEL_PRESENTATION.SLOT) return;
      restorePanel();
      // An answer is worth reading and then done with. The pointer is usually
      // still on the button that was pressed, and where it is not — the key was
      // sent from the keyboard, or the shape shrank out from under it — nothing
      // else would ever ask this panel to close, so it shows the answer and then
      // takes its leave. Nothing else restores the panel this way: giving up has
      // no answer to show.
      if (pointerInside.current) return;
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = undefined;
        if (presentationRef.current === PANEL_PRESENTATION.PANEL) void changeMode(false);
      }, SETTLE_DELAY_MS);
    });
  }, [applyEntry, changeMode, restorePanel]);

  const removeProviderApiKey = useCallback(
    async (providerId: CredentialProviderId) => {
      const result = await window.sidecar.setProviderApiKey(providerId, undefined);
      setSettings(result.settings);
      // Delete and the field are on the row together once the panel has been
      // brought back around an entry, and a key that has been removed cannot be
      // replaced.
      if (removalEndsEntry(entryRef.current, providerId, result.reason)) applyEntry(undefined);
      return result.reason;
    },
    [applyEntry],
  );

  const credentials: CredentialEntryControl = {
    entry,
    begin: beginEntry,
    change: changeEntry,
    fetchKey,
    cancel: cancelEntry,
    commit: commitEntry,
    remove: removeProviderApiKey,
  };

  /**
   * Sends a session to its provider and gets out of the way. Luke floats above
   * every window, so a panel left open would be sitting on top of the very chat
   * it was just asked to bring forward — the same reason fetching a key stands
   * the panel down. The pointer is on the row that was pressed and cannot leave
   * a shape that is no longer drawn, so the close is asked for here rather than
   * waited for.
   */
  const openSession = useCallback(
    (session: DisplaySession) => {
      window.sidecar.openSession({
        providerId: session.providerId,
        providerSessionId: session.id,
      });
      cancelHoverTransition();
      void changeMode(false);
    },
    [cancelHoverTransition, changeMode],
  );

  /** The capsule is a button: pressing it opens the panel, or closes it again. */
  const handleCapsulePress = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // A press is a gesture, not a focus change, so the pointer hands focus
      // back. `detail` is 0 when the keyboard activated the button, and there
      // the focus is the point and stays where the keyboard put it.
      if (event.detail > 0) event.currentTarget.blur();
      cancelHoverTransition();
      void changeMode(presentationRef.current !== PANEL_PRESENTATION.PANEL);
    },
    [cancelHoverTransition, changeMode],
  );

  usePointerPassthrough(handleHitRegionEnter, handleHitRegionLeave, presentation);

  // `:focus-visible` is a heuristic about how focus arrived, and here it guesses
  // wrong: the panel takes focus programmatically when it opens, which the
  // engine can read as keyboard modality and ring the capsule after a plain
  // press — most reliably the first time the window is ever focused. Modality
  // is tracked outright instead, so a ring is drawn only once someone has
  // actually moved focus with the keyboard.
  useEffect(() => {
    const root = document.documentElement;
    const keyboardMoved = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key.startsWith("Arrow")) root.dataset.keyboard = "true";
    };
    const pointerUsed = () => {
      delete root.dataset.keyboard;
    };
    // Capture: the flag has to be right before anything reacts to the event.
    window.addEventListener("keydown", keyboardMoved, true);
    window.addEventListener("pointerdown", pointerUsed, true);
    return () => {
      window.removeEventListener("keydown", keyboardMoved, true);
      window.removeEventListener("pointerdown", pointerUsed, true);
    };
  }, []);

  useEffect(() => {
    const bootstrapGeneration = modeGeneration.current;
    void window.sidecar.getBootstrap().then((value) => {
      setBootstrap(value);
      setSessions(value.sessions);
      setSettings(value.settings);
      setDisplay(value.display);
      if (modeGeneration.current === bootstrapGeneration) {
        applyAuthoritativeMode(value.mode);
        if (value.startPeeked && value.mode === "compact") {
          applyPresentation(PANEL_PRESENTATION.PEEK);
        }
        // Evidence only, and the same trick the peek uses: the slot is reached
        // by pressing Connect, which a capture run has no way to do, so the
        // entry the press would have begun is asked for directly. It carries
        // the shape with it, as it does anywhere else.
        const [firstProvider] = CREDENTIAL_PROVIDER_LIST;
        if (value.startInSlot && value.mode === "expanded" && firstProvider) {
          // The tab an entry begins on, so pressing the capsule from here lands
          // where it would have in the flow this is standing in for.
          changeTab(PANEL_TAB.SETTINGS);
          beginEntry(firstProvider.id);
        }
      }
      setMicrophoneStatus(value.microphoneStatus);
      if (value.profile === "microphone") {
        window.setTimeout(() => void startMicrophone(), 500);
      }
      window.sidecar.notifyReady();
    });
    const removeLifecycle = window.sidecar.onLifecycle((eventName) => {
      if (eventName === "mode:compact") applyAuthoritativeMode("compact");
      if (eventName === "mode:expanded") applyAuthoritativeMode("expanded");
      if (eventName === "tab:settings") changeTab(PANEL_TAB.SETTINGS);
    });
    const removeDisplay = window.sidecar.onDisplayChanged(setDisplay);
    const removeSessions = window.sidecar.onSessionsChanged(setSessions);
    return () => {
      cancelHoverTransition();
      removeLifecycle();
      removeDisplay();
      removeSessions();
      void stopMicrophone();
    };
  }, [
    applyAuthoritativeMode,
    applyPresentation,
    beginEntry,
    cancelHoverTransition,
    changeTab,
    startMicrophone,
    stopMicrophone,
  ]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      // The shortcut the tray menu advertises. It is claimed here rather than
      // globally, because Command-, belongs to whichever app is frontmost and
      // Luke is only that while its panel has the keyboard.
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        if (presentation !== PANEL_PRESENTATION.PANEL) return;
        event.preventDefault();
        changeTab(PANEL_TAB.SETTINGS);
        return;
      }
      if (event.key !== "Escape") return;
      // Escape out of the slot is the entry's own way out, wherever the caret
      // happens to be: the slot is the only thing on screen, so there is nothing
      // else it could mean.
      if (presentation === PANEL_PRESENTATION.SLOT) {
        cancelEntry();
        return;
      }
      if (presentation !== PANEL_PRESENTATION.PANEL) return;
      // Otherwise it closes the nearest thing that is open, one layer at a
      // time: the options sheet, then the settings tab, then the panel itself.
      if (optionsOpen) setOptionsOpen(false);
      else if (tab === PANEL_TAB.SETTINGS) changeTab(PANEL_TAB.SESSIONS);
      else void changeMode(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [cancelEntry, changeMode, changeTab, optionsOpen, presentation, tab]);

  // A press anywhere else is the same dismissal Escape is, and the one a sheet
  // over a list has to answer: what is behind it can only be reached by asking
  // it to move, so pressing there has to be what asks. The press is taken on the
  // way down, before whatever it lands on can act on it, and the button that
  // opened the sheet is left to its own toggle. Nothing outside the drawn shape
  // reaches this renderer at all — those presses belong to whatever is behind
  // Luke — so leaving the shape is what closes the panel, and closing the panel
  // is what puts the sheet away.
  useEffect(() => {
    if (!optionsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : undefined;
      if (!target) return;
      const sheet = document.getElementById(SESSION_OPTIONS_ID);
      const button = document.getElementById(SESSION_OPTIONS_BUTTON_ID);
      if (sheet?.contains(target) || button?.contains(target)) return;
      setOptionsOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, [optionsOpen]);

  if (!bootstrap || !display) return <div />;

  const visibleSessions = displaySessions(bootstrap, sessions);
  // The tally is taken before the list is narrowed: the capsule reports what
  // Luke is watching, not what the panel is currently showing.
  const tally = sessionTally(visibleSessions);
  const list = arrangeSessions(visibleSessions, sessionView);
  // Dropping an emptied filter is a change of view, not a way of drawing one.
  // Left in state it would lie dormant behind an All that only looks chosen,
  // and the next session to enter that state would narrow the list back down
  // to it with nothing having been pressed. Setting state here rather than from
  // an effect is what keeps that from being drawn first and corrected after.
  if (list.filter !== sessionView.filter) {
    setSessionView({ ...sessionView, filter: list.filter });
  }
  // The sheet exists only while there is something for it to decide, and its
  // being open has to go when its button does — by the same rule the emptied
  // filter follows. Left set behind a button nobody can see, Escape would spend
  // itself closing a sheet that is not drawn instead of closing the panel, and
  // the next session to arrive would open it again with nothing pressed.
  const offerOptions = tab === PANEL_TAB.SESSIONS && list.total > 1;
  if (optionsOpen && !offerOptions) setOptionsOpen(false);
  const fixtureSpeaking = bootstrap.profile === "speaking";
  const hasAudioSignal = fixtureSpeaking || analyser !== undefined;
  const panelOpen = presentation === PANEL_PRESENTATION.PANEL;
  const slotOpen = presentation === PANEL_PRESENTATION.SLOT;
  // What the slot's field is for depends on what answers for that provider now,
  // and settings resolve after the first render.
  const slotSource =
    entry && settings ? settings.credentialSources[entry.providerId] : CREDENTIAL_SOURCE.NONE;

  return (
    <div
      className="app-stage"
      data-presentation={presentation}
      data-notch={String(display.notch.hasNotch)}
      data-capture={String(bootstrap.captureMode)}
      style={{ ...notchStyle(display), ...shapeHeightStyle(panelHeight, slotHeight) }}
    >
      {/* Capsule, peek, slot and panel are all this one shape at different
          sizes, so the surface is never cross-faded — it is only ever resized. */}
      <span className="panel-surface" data-hit-region={HIT_REGION.SURFACE} aria-hidden="true" />

      {/* Inert while hidden: the panel keeps its full layout box behind
          `opacity: 0`, so its buttons stay focusable and the browser will scroll
          them into view, pushing the compact capsule off screen. */}
      <div className="expanded-stage" aria-hidden={!panelOpen} inert={!panelOpen}>
        <section className="expanded-panel" ref={panelElement} data-hit-region={HIT_REGION.PANEL}>
          <PanelBody
            list={list}
            view={sessionView}
            onViewChange={changeSessionView}
            onOpenSession={openSession}
            offerOptions={offerOptions}
            optionsOpen={optionsOpen}
            onOptionsToggle={() => setOptionsOpen((open) => !open)}
            tab={tab}
            onTabChange={changeTab}
            settings={{
              microphoneStatus,
              microphoneActive: analyser !== undefined,
              microphoneError,
              onToggleMicrophone: () => void (analyser ? stopMicrophone() : startMicrophone()),
              settings,
              onToggleLocalTranscripts: (enabled: boolean) => {
                void window.sidecar.setLocalTranscripts(enabled).then(setSettings);
              },
              credentials,
              panelOpen,
              onQuit: () => window.sidecar.quit(),
            }}
          />
        </section>
      </div>

      {/* The panel stood down to its field. It shares the expanded window, so
          standing down to it costs no more than the peek does. */}
      <KeySlot control={credentials} source={slotSource} drawn={slotOpen} measure={slotElement} />

      <NotchWings
        tally={tally}
        analyser={analyser}
        fixtureSpeaking={fixtureSpeaking}
        hasAudioSignal={hasAudioSignal}
        presentation={presentation}
        housingWidth={display.notch.housingWidth}
      />

      <div className="compact-stage">
        {/* A button, not a hover target: hovering only peeks, pressing commits.
            It stays live over an open panel so pressing it closes again. */}
        <button
          type="button"
          className="compact-hover-target"
          data-hit-region={HIT_REGION.CAPSULE}
          aria-expanded={panelOpen}
          aria-label={`${tallySummary(tally)}. ${panelOpen ? "Close" : "Open"} the panel`}
          // Keeps the press from moving focus here at all, so nothing is drawn
          // around the notch strip and a focused settings field keeps the caret.
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleCapsulePress}
        />
      </div>
    </div>
  );
}
