import type { NormalizedSession } from "@sidecar/core";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type {
  AppBootstrap,
  AppSettings,
  DisplayDiagnostic,
  MicrophoneStatus,
  WindowMode,
} from "../shared/contracts";
import type { CredentialProviderId } from "../shared/credential-providers";
import { NotchWings } from "./notch-wings";
import { PanelBody } from "./panel-body";
import {
  LEAVE_DELAY_MS,
  PANEL_PRESENTATION,
  type PanelPresentation,
  PEEK_ENTER_DELAY_MS,
  presentationForMode,
} from "./panel-state";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";

/** What takes the pointer, named so the test can tell one from another. */
const HIT_REGION = {
  /** The black shape itself, whatever size it is drawn at. */
  SURFACE: "surface",
  CAPSULE: "capsule",
  PANEL: "panel",
} as const;

import { displaySessions, sessionTally, tallySummary } from "./session-model";

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
          (kind === HIT_REGION.PANEL && drawn === PANEL_PRESENTATION.PANEL),
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

function panelHeightStyle(panelHeight: number | undefined): CSSProperties {
  return panelHeight === undefined
    ? {}
    : ({ "--panel-height": `${panelHeight}px` } as CSSProperties);
}

/**
 * Reports the panel's own height so the black surface can end where the content
 * does. The window stays one size; only the shape inside it follows the number
 * of sessions, which is what makes adding or finishing one feel like a resize
 * rather than a redraw.
 */
function usePanelHeight(): [(element: HTMLElement | null) => void, number | undefined] {
  const observer = useRef<ResizeObserver | undefined>(undefined);
  const [panelHeight, setPanelHeight] = useState<number>();

  // A callback ref rather than an effect: the panel mounts only once bootstrap
  // has resolved, which is after the first render.
  const panelElement = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = undefined;
    if (!element) return;
    const measure = () => setPanelHeight(Math.ceil(element.getBoundingClientRect().height));
    const nextObserver = new ResizeObserver(measure);
    nextObserver.observe(element);
    observer.current = nextObserver;
    measure();
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [panelElement, panelHeight];
}

export function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [sessions, setSessions] = useState<readonly NormalizedSession[]>([]);
  const [display, setDisplay] = useState<DisplayDiagnostic>();
  const [presentation, setPresentation] = useState<PanelPresentation>(PANEL_PRESENTATION.CAPSULE);
  const [tab, setTab] = useState<PanelTab>(PANEL_TAB.SESSIONS);
  const [settings, setSettings] = useState<AppSettings>();
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>("not-determined");
  const [microphoneError, setMicrophoneError] = useState<string>();
  const [analyser, setAnalyser] = useState<AnalyserNode>();
  const [panelElement, panelHeight] = usePanelHeight();
  const audioContext = useRef<AudioContext | undefined>(undefined);
  const mediaStream = useRef<MediaStream | undefined>(undefined);
  const hoverTimer = useRef<number | undefined>(undefined);
  const presentationRef = useRef<PanelPresentation>(PANEL_PRESENTATION.CAPSULE);
  const tabRef = useRef<PanelTab>(PANEL_TAB.SESSIONS);
  const credentialEditing = useRef(false);
  const pointerInside = useRef(false);
  const modeGeneration = useRef(0);

  const changeTab = useCallback((next: PanelTab) => {
    tabRef.current = next;
    setTab(next);
  }, []);

  const applyPresentation = useCallback(
    (next: PanelPresentation) => {
      presentationRef.current = next;
      setPresentation(next);
      // A panel that has closed reopens on the session list: settings are
      // somewhere you go, not a state the capsule remembers.
      if (next === PANEL_PRESENTATION.CAPSULE) changeTab(PANEL_TAB.SESSIONS);
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

  const handleHitRegionLeave = useCallback(() => {
    cancelHoverTransition();
    pointerInside.current = false;
    const current = presentationRef.current;
    if (current === PANEL_PRESENTATION.CAPSULE) return;
    // A key half-typed is the one thing the pointer must not be allowed to
    // discard. Everything else on the settings tab closes like the sessions
    // tab does.
    if (current === PANEL_PRESENTATION.PANEL && credentialEditing.current) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      if (presentationRef.current === PANEL_PRESENTATION.PEEK) {
        applyPresentation(PANEL_PRESENTATION.CAPSULE);
      } else if (presentationRef.current === PANEL_PRESENTATION.PANEL) {
        // Read again rather than trusting the answer from when this was
        // scheduled: an entry can begin inside the delay — pressing Connect and
        // reaching for the keyboard does exactly that — and a close decided
        // before it began would discard it.
        if (credentialEditing.current) return;
        void changeMode(false);
      }
    }, LEAVE_DELAY_MS);
  }, [applyPresentation, cancelHoverTransition, changeMode]);

  // An entry that ends while the pointer is already away — Escape out of the
  // key field, say — leaves the panel held open by nothing, because the pointer
  // cannot leave a second time. Releasing the hold runs the leave itself.
  const setCredentialEditing = useCallback(
    (editing: boolean) => {
      // Only a hold that existed can be released. The settings tab reports "not
      // editing" as it mounts too, and that is not the pointer leaving: opening
      // Settings from the tray does exactly that with the pointer on the menu
      // bar, which would otherwise close the panel on arrival.
      const released = credentialEditing.current && !editing;
      credentialEditing.current = editing;
      if (released && !pointerInside.current) handleHitRegionLeave();
    },
    [handleHitRegionLeave],
  );

  const submitProviderApiKey = useCallback(
    async (providerId: CredentialProviderId, apiKey: string | undefined) => {
      const result = await window.sidecar.setProviderApiKey(providerId, apiKey);
      setSettings(result.settings);
      return result.reason;
    },
    [],
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
      if (event.key !== "Escape" || presentation !== PANEL_PRESENTATION.PANEL) return;
      if (tab === PANEL_TAB.SETTINGS) changeTab(PANEL_TAB.SESSIONS);
      else void changeMode(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [changeMode, changeTab, presentation, tab]);

  if (!bootstrap || !display) return <div />;

  const visibleSessions = displaySessions(bootstrap, sessions);
  const tally = sessionTally(visibleSessions);
  const fixtureSpeaking = bootstrap.profile === "speaking";
  const hasAudioSignal = fixtureSpeaking || analyser !== undefined;
  const panelOpen = presentation === PANEL_PRESENTATION.PANEL;

  return (
    <div
      className="app-stage"
      data-presentation={presentation}
      data-notch={String(display.notch.hasNotch)}
      data-capture={String(bootstrap.captureMode)}
      style={{ ...notchStyle(display), ...panelHeightStyle(panelHeight) }}
    >
      {/* Capsule, peek and panel are all this one shape at different sizes, so
          the surface is never cross-faded — it is only ever resized. */}
      <span className="panel-surface" data-hit-region={HIT_REGION.SURFACE} aria-hidden="true" />

      {/* Inert while hidden: the panel keeps its full layout box behind
          `opacity: 0`, so its buttons stay focusable and the browser will scroll
          them into view, pushing the compact capsule off screen. */}
      <div className="expanded-stage" aria-hidden={!panelOpen} inert={!panelOpen}>
        <section className="expanded-panel" ref={panelElement} data-hit-region={HIT_REGION.PANEL}>
          <PanelBody
            sessions={visibleSessions}
            tab={tab}
            onTabChange={changeTab}
            settings={{
              microphoneStatus,
              microphoneActive: analyser !== undefined,
              microphoneError,
              onToggleMicrophone: () => void (analyser ? stopMicrophone() : startMicrophone()),
              settings,
              onSubmitProviderApiKey: submitProviderApiKey,
              onEditingChange: setCredentialEditing,
              onQuit: () => window.sidecar.quit(),
            }}
          />
        </section>
      </div>

      <NotchWings
        tally={tally}
        analyser={analyser}
        fixtureSpeaking={fixtureSpeaking}
        hasAudioSignal={hasAudioSignal}
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
