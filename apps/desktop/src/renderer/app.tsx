import type { NormalizedSession } from "@sidecar/core";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type {
  AppBootstrap,
  DisplayDiagnostic,
  MicrophoneStatus,
  WindowMode,
} from "../shared/contracts";
import { NotchWings } from "./notch-wings";
import { PanelBody } from "./panel-body";
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
      const target = document.elementFromPoint(event.clientX, event.clientY);
      update(target?.closest("[data-hit-region]") !== null);
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

function displaySummary(bootstrap: AppBootstrap, display: DisplayDiagnostic): string {
  const build = bootstrap.packaged ? "Packaged" : "Development";
  const attachment = display.notch.hasNotch ? "hardware notch" : "top-center fallback";
  return `${build} · ${attachment} · ${display.notch.source}`;
}

export function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [sessions, setSessions] = useState<readonly NormalizedSession[]>([]);
  const [display, setDisplay] = useState<DisplayDiagnostic>();
  const [mode, setMode] = useState<WindowMode>("compact");
  const [tab, setTab] = useState<PanelTab>(PANEL_TAB.SESSIONS);
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>("not-determined");
  const [microphoneError, setMicrophoneError] = useState<string>();
  const [analyser, setAnalyser] = useState<AnalyserNode>();
  const [panelElement, panelHeight] = usePanelHeight();
  const audioContext = useRef<AudioContext | undefined>(undefined);
  const mediaStream = useRef<MediaStream | undefined>(undefined);
  const hoverTimer = useRef<number | undefined>(undefined);
  const modeRef = useRef<WindowMode>("compact");
  const modeGeneration = useRef(0);

  const updateMode = useCallback((nextMode: WindowMode) => {
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

  const applyAuthoritativeMode = useCallback(
    (nextMode: WindowMode) => {
      // A lifecycle notification can originate outside this renderer (for
      // example from the tray). Ignore an older IPC result that arrives later.
      modeGeneration.current += 1;
      updateMode(nextMode);
    },
    [updateMode],
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

  const changeMode = useCallback(
    async (expanded: boolean) => {
      const targetMode: WindowMode = expanded ? "expanded" : "compact";
      const previousMode = modeRef.current;
      const generation = modeGeneration.current + 1;
      modeGeneration.current = generation;
      modeRef.current = targetMode;
      // The main process owns the ordering of the window resize against this
      // animation, so both directions are the same call from here.
      try {
        const confirmedMode = await window.sidecar.setExpanded(expanded);
        if (modeGeneration.current === generation) updateMode(confirmedMode);
      } catch (error) {
        if (modeGeneration.current === generation) modeRef.current = previousMode;
        throw error;
      }
    },
    [updateMode],
  );

  const cancelHoverTransition = useCallback(() => {
    if (hoverTimer.current === undefined) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  }, []);

  const scheduleMode = useCallback(
    (expanded: boolean) => {
      cancelHoverTransition();
      hoverTimer.current = window.setTimeout(
        () => {
          hoverTimer.current = undefined;
          void changeMode(expanded);
        },
        expanded ? 70 : 180,
      );
    },
    [cancelHoverTransition, changeMode],
  );

  const handleHitRegionEnter = useCallback(() => {
    if (modeRef.current === "compact") scheduleMode(true);
    else cancelHoverTransition();
  }, [cancelHoverTransition, scheduleMode]);

  const handleHitRegionLeave = useCallback(() => {
    if (modeRef.current === "compact") cancelHoverTransition();
    else scheduleMode(false);
  }, [cancelHoverTransition, scheduleMode]);

  usePointerPassthrough(handleHitRegionEnter, handleHitRegionLeave);

  useEffect(() => {
    const bootstrapGeneration = modeGeneration.current;
    void window.sidecar.getBootstrap().then((value) => {
      setBootstrap(value);
      setSessions(value.sessions);
      setDisplay(value.display);
      if (modeGeneration.current === bootstrapGeneration) applyAuthoritativeMode(value.mode);
      setMicrophoneStatus(value.microphoneStatus);
      if (value.profile === "microphone") {
        window.setTimeout(() => void startMicrophone(), 500);
      }
      window.sidecar.notifyReady();
    });
    const removeLifecycle = window.sidecar.onLifecycle((eventName) => {
      if (eventName === "mode:compact") applyAuthoritativeMode("compact");
      if (eventName === "mode:expanded") applyAuthoritativeMode("expanded");
    });
    const removeMicrophone = window.sidecar.onStartMicrophone(() => {
      void startMicrophone();
    });
    const removeDisplay = window.sidecar.onDisplayChanged(setDisplay);
    const removeSessions = window.sidecar.onSessionsChanged(setSessions);
    return () => {
      cancelHoverTransition();
      removeLifecycle();
      removeMicrophone();
      removeDisplay();
      removeSessions();
      void stopMicrophone();
    };
  }, [applyAuthoritativeMode, cancelHoverTransition, startMicrophone, stopMicrophone]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && mode === "expanded") void changeMode(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [changeMode, mode]);

  if (!bootstrap || !display) return <div />;

  const visibleSessions = displaySessions(bootstrap, sessions);
  const tally = sessionTally(visibleSessions);
  const fixtureSpeaking = bootstrap.profile === "speaking";
  const hasAudioSignal = fixtureSpeaking || analyser !== undefined;

  return (
    <div
      className="app-stage"
      data-mode={mode}
      data-capture={String(bootstrap.captureMode)}
      style={{ ...notchStyle(display), ...panelHeightStyle(panelHeight) }}
    >
      {/* The surface fills the window in compact mode and the measured panel in
          expanded mode, so the capsule and the panel are one black shape that
          stretches with the window instead of two that cross-fade. */}
      <span className="panel-surface" aria-hidden="true" />

      {/* Inert while hidden: the panel keeps its full layout box behind
          `opacity: 0`, so its buttons stay focusable and the browser will scroll
          them into view, pushing the compact capsule off screen. */}
      <div className="expanded-stage" aria-hidden={mode !== "expanded"} inert={mode !== "expanded"}>
        <section
          className="expanded-panel"
          ref={panelElement}
          data-hit-region
          onPointerEnter={cancelHoverTransition}
          onPointerLeave={() => scheduleMode(false)}
        >
          <PanelBody
            sessions={visibleSessions}
            tab={tab}
            onTabChange={setTab}
            settings={{
              microphoneStatus,
              microphoneActive: analyser !== undefined,
              microphoneError,
              onToggleMicrophone: () => void (analyser ? stopMicrophone() : startMicrophone()),
              onQuit: () => window.sidecar.quit(),
              displaySummary: displaySummary(bootstrap, display),
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

      <div className="compact-stage" inert={mode !== "compact"}>
        <div
          className="compact-hover-target"
          data-hit-region
          aria-hidden="true"
          title={tallySummary(tally)}
          onPointerEnter={() => scheduleMode(true)}
          onPointerLeave={cancelHoverTransition}
        />
      </div>
    </div>
  );
}
