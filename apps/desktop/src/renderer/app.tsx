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
import { displaySessions, sessionTally, tallySummary } from "./session-model";

function usePointerPassthrough(onHitRegionEnter: () => void, onHitRegionLeave: () => void): void {
  const lastValue = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    const update = (interceptsPointer: boolean) => {
      if (lastValue.current === interceptsPointer) return;
      lastValue.current = interceptsPointer;
      window.sidecar.setPointerInterception(interceptsPointer);
      if (interceptsPointer) onHitRegionEnter();
      else onHitRegionLeave();
    };
    const handleMove = (event: MouseEvent) => {
      // `elementFromPoint` answers null for a point outside the viewport, which
      // a forwarded move can carry. Comparing that against null read as "still
      // inside", so leaving by the edge left the panel open until some other
      // event closed it.
      const target = document.elementFromPoint(event.clientX, event.clientY);
      update(Boolean(target?.closest("[data-hit-region]")));
    };
    const handleLeave = () => update(false);
    window.addEventListener("mousemove", handleMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", handleLeave);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      document.documentElement.removeEventListener("mouseleave", handleLeave);
    };
  }, [onHitRegionEnter, onHitRegionLeave]);
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
        void changeMode(false);
      }
    }, LEAVE_DELAY_MS);
  }, [applyPresentation, cancelHoverTransition, changeMode]);

  // An entry that ends while the pointer is already away — Escape out of the
  // key field, say — leaves the panel held open by nothing, because the pointer
  // cannot leave a second time. Releasing the hold runs the leave itself.
  const setCredentialEditing = useCallback(
    (editing: boolean) => {
      credentialEditing.current = editing;
      if (!editing && !pointerInside.current) handleHitRegionLeave();
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
  const handleCapsulePress = useCallback(() => {
    cancelHoverTransition();
    void changeMode(presentationRef.current !== PANEL_PRESENTATION.PANEL);
  }, [cancelHoverTransition, changeMode]);

  usePointerPassthrough(handleHitRegionEnter, handleHitRegionLeave);

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
      <span className="panel-surface" aria-hidden="true" />

      {/* Inert while hidden: the panel keeps its full layout box behind
          `opacity: 0`, so its buttons stay focusable and the browser will scroll
          them into view, pushing the compact capsule off screen. */}
      <div className="expanded-stage" aria-hidden={!panelOpen} inert={!panelOpen}>
        <section className="expanded-panel" ref={panelElement} data-hit-region>
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
          data-hit-region
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
