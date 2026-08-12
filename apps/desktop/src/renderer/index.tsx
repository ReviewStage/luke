import {
  ATTENTION_DISPOSITION,
  type NormalizedSession,
  SESSION_STATE,
  SESSION_STATUS,
  type SessionState,
} from "@sidecar/core";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AppBootstrap,
  DisplayDiagnostic,
  MicrophoneStatus,
  WindowMode,
} from "../shared/contracts";

const stateLabels: Record<SessionState, string> = {
  [SESSION_STATE.WORKING]: "Working",
  [SESSION_STATE.ATTENTION]: "Needs attention",
  [SESSION_STATE.COMPLETE]: "Complete",
  [SESSION_STATE.UNKNOWN]: "Observed",
};

const statusLabels: Record<NormalizedSession["status"], string> = {
  [SESSION_STATUS.WORKING]: "Working",
  [SESSION_STATUS.WAITING]: "Waiting",
  [SESSION_STATUS.COMPLETE]: "Complete",
  [SESSION_STATUS.UNKNOWN]: "Observed",
};

interface DisplaySession {
  id: string;
  title: string;
  provider: string;
  detail: string;
  state: SessionState;
  label: string;
}

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

function Waveform({
  analyser,
  speaking = false,
}: {
  analyser?: AnalyserNode;
  speaking?: boolean;
}): React.JSX.Element {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const fixtureLevels = [0.42, 0.62, 0.82, 1, 0.78, 0.58, 0.38];

  useEffect(() => {
    // Fixture speech is intentionally static so screenshots and recordings are
    // repeatable. Only a live microphone analyser needs animation frames.
    if (!analyser) return;

    const values = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let animationFrame = 0;
    let wasSpeaking = false;
    let lastVoiceAt = 0;
    const draw = () => {
      let rms = 0;
      analyser.getByteTimeDomainData(values);
      let energy = 0;
      for (const value of values) {
        const normalized = (value - 128) / 128;
        energy += normalized * normalized;
      }
      rms = Math.min(1, Math.sqrt(energy / values.length) * 4.5);
      const now = performance.now();
      if (rms > 0.12) lastVoiceAt = now;
      const nextSpeaking = now - lastVoiceAt < 220;
      if (nextSpeaking !== wasSpeaking) {
        wasSpeaking = nextSpeaking;
        setVoiceActive(wasSpeaking);
      }
      bars.current.forEach((bar, index) => {
        if (!bar) return;
        const variation = 0.72 + Math.sin(frame / 9 + index * 0.9) * 0.18;
        bar.style.transform = `scaleY(${0.2 + rms * variation})`;
      });
      frame += 1;
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationFrame);
      setVoiceActive(false);
    };
  }, [analyser]);

  const isSpeaking = speaking || voiceActive;

  return (
    <span
      className="waveform"
      role="img"
      aria-label="Live speech activity"
      aria-hidden={!isSpeaking}
      data-speaking={String(isSpeaking)}
    >
      {[0, 1, 2, 3, 4, 5, 6].map((index) => (
        <span
          className="waveform-bar"
          key={index}
          ref={(element) => {
            bars.current[index] = element;
          }}
          style={speaking ? { transform: `scaleY(${fixtureLevels[index]})` } : undefined}
        />
      ))}
    </span>
  );
}

function notchStyle(display: DisplayDiagnostic): CSSProperties {
  return {
    "--notch-top-inset": `${display.notch.topInset}px`,
    "--notch-housing-width": `${display.notch.housingWidth}px`,
  } as CSSProperties;
}

function sessionNeedsAttention(session: NormalizedSession): boolean {
  return (
    session.status === SESSION_STATUS.WAITING ||
    session.attention.disposition !== ATTENTION_DISPOSITION.SILENT
  );
}

function sessionState(session: NormalizedSession): SessionState {
  if (sessionNeedsAttention(session)) return SESSION_STATE.ATTENTION;
  if (session.status === SESSION_STATUS.COMPLETE) return SESSION_STATE.COMPLETE;
  if (session.status === SESSION_STATUS.UNKNOWN) return SESSION_STATE.UNKNOWN;
  return SESSION_STATE.WORKING;
}

function displaySessions(bootstrap: AppBootstrap, sessions: readonly NormalizedSession[]) {
  if (bootstrap.captureMode) {
    return bootstrap.fixture.sessions.map(
      (session): DisplaySession => ({
        ...session,
        label: stateLabels[session.state],
      }),
    );
  }

  return sessions.map(
    (session): DisplaySession => ({
      id: session.providerSessionId,
      title: session.title,
      provider: session.provider.displayName,
      detail: session.summary ?? statusLabels[session.status],
      state: sessionState(session),
      label: statusLabels[session.status],
    }),
  );
}

function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [sessions, setSessions] = useState<readonly NormalizedSession[]>([]);
  const [display, setDisplay] = useState<DisplayDiagnostic>();
  const [mode, setMode] = useState<WindowMode>("compact");
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>("not-determined");
  const [microphoneError, setMicrophoneError] = useState<string>();
  const [analyser, setAnalyser] = useState<AnalyserNode>();
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
  const attention = visibleSessions.filter(
    (session) => session.state === SESSION_STATE.ATTENTION,
  ).length;
  const active = visibleSessions.filter(
    (session) => session.state === SESSION_STATE.WORKING,
  ).length;
  const fixtureSpeaking = bootstrap.profile === "speaking";
  const hasAudioSignal = fixtureSpeaking || analyser !== undefined;
  const indicatorState =
    attention > 0
      ? SESSION_STATE.ATTENTION
      : active > 0
        ? SESSION_STATE.WORKING
        : SESSION_STATE.UNKNOWN;
  const hasLiveSessions = !bootstrap.captureMode && sessions.length > 0;
  const sessionSummary =
    visibleSessions.length === 0
      ? "No sessions observed"
      : active > 0
        ? "Active sessions observed"
        : "No active sessions observed";
  const style = notchStyle(display);

  return (
    <div className="app-stage" data-mode={mode} style={style}>
      <div className="compact-stage" aria-hidden={mode !== "compact"}>
        {display.notch.hasNotch ? <span className="notch-housing" aria-hidden="true" /> : null}
        {hasAudioSignal ? (
          <div className="compact-waveform">
            <Waveform
              analyser={mode === "compact" ? analyser : undefined}
              speaking={mode === "compact" && fixtureSpeaking}
            />
          </div>
        ) : null}
        <div
          className="compact-hover-target"
          data-hit-region
          role="status"
          aria-label={
            attention > 0
              ? `${attention} session${attention === 1 ? "" : "s"} needs attention`
              : sessionSummary
          }
          onPointerEnter={() => scheduleMode(true)}
          onPointerLeave={cancelHoverTransition}
        />
        <div className="compact-indicator-target" aria-hidden="true">
          <span className={`compact-indicator ${indicatorState}`} />
        </div>
      </div>

      <div
        className="expanded-stage"
        aria-hidden={mode !== "expanded"}
        data-hit-region
        onPointerEnter={cancelHoverTransition}
        onPointerLeave={() => scheduleMode(false)}
      >
        <section className="expanded-panel">
          <header className="panel-header">
            <div className="header-status">
              {hasAudioSignal ? (
                <Waveform
                  analyser={mode === "expanded" ? analyser : undefined}
                  speaking={mode === "expanded" && fixtureSpeaking}
                />
              ) : (
                <span className={`header-indicator ${indicatorState}`} />
              )}
              <span className="header-copy">
                <strong>{hasAudioSignal ? "Audio active" : "Monitoring"}</strong>
                <small>
                  {attention > 0
                    ? `${attention} session${attention === 1 ? "" : "s"} needs attention`
                    : sessionSummary}
                </small>
              </span>
            </div>
          </header>

          <div className="summary-row">
            <div>
              <p className="eyebrow">Notch sidecar</p>
              <h1>Agent activity</h1>
              <p className="subtle">
                {bootstrap.captureMode
                  ? "Synthetic sessions · no credentials or live transcripts"
                  : "Live sessions · no credentials or transcripts retained"}
              </p>
            </div>
            <span className="fixture-badge">
              {hasLiveSessions ? "LIVE" : bootstrap.captureMode ? "FIXTURE · SMOKE" : "IDLE"}
            </span>
          </div>

          <div className="session-list">
            {visibleSessions.map((item) => (
              <article className="session-row" key={item.id}>
                <span className={`status-mark ${item.state}`} />
                <span className="session-copy">
                  <strong>{item.title}</strong>
                  <small>
                    {item.provider} · {item.detail}
                  </small>
                </span>
                <span className={`session-status ${item.state}`}>{item.label}</span>
              </article>
            ))}
          </div>

          <footer className="panel-footer">
            <div className="diagnostics">
              <span>Electron {bootstrap.electronVersion}</span>
              <span>{bootstrap.packaged ? "Packaged" : "Development"}</span>
              <span>{display.notch.hasNotch ? "Hardware notch" : "Top-center fallback"}</span>
              <span>{display.notch.source}</span>
            </div>
            <div className="footer-actions">
              <span className={`permission ${microphoneStatus}`}>Mic: {microphoneStatus}</span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void (analyser ? stopMicrophone() : startMicrophone())}
              >
                {analyser ? "Stop microphone" : "Start microphone"}
              </button>
              <button type="button" className="quiet-button" onClick={() => window.sidecar.quit()}>
                Quit
              </button>
            </div>
            {microphoneError ? <p className="error-message">{microphoneError}</p> : null}
          </footer>
        </section>
      </div>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Renderer root element is missing");
createRoot(rootElement).render(<App />);
