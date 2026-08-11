import type { SessionState } from "@sidecar/core";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AppBootstrap,
  DisplayDiagnostic,
  MicrophoneStatus,
  WindowMode,
} from "../shared/contracts";

const stateLabels: Record<SessionState, string> = {
  working: "Working",
  attention: "Needs attention",
  complete: "Complete",
};

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
  const container = useRef<HTMLSpanElement | null>(null);
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const fixtureLevels = [0.42, 0.62, 0.82, 1, 0.78, 0.58, 0.38];

  useEffect(() => {
    // Fixture speech is intentionally static so screenshots and recordings are
    // repeatable. Only a live microphone analyser needs animation frames.
    if (!analyser) return;

    const values = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let animationFrame = 0;
    let wasSpeaking = speaking;
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
      const nextSpeaking = speaking || now - lastVoiceAt < 220;
      if (nextSpeaking !== wasSpeaking) {
        wasSpeaking = nextSpeaking;
        container.current?.setAttribute("data-speaking", String(wasSpeaking));
        container.current?.setAttribute("aria-hidden", String(!wasSpeaking));
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
      container.current?.setAttribute("data-speaking", "false");
      container.current?.setAttribute("aria-hidden", "true");
    };
  }, [analyser, speaking]);

  return (
    <span
      ref={container}
      className="waveform"
      role="img"
      aria-label="Live speech activity"
      aria-hidden={!speaking}
      data-speaking={String(speaking)}
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

function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [display, setDisplay] = useState<DisplayDiagnostic>();
  const [mode, setMode] = useState<WindowMode>("compact");
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>("not-determined");
  const [microphoneError, setMicrophoneError] = useState<string>();
  const [analyser, setAnalyser] = useState<AnalyserNode>();
  const audioContext = useRef<AudioContext | undefined>(undefined);
  const mediaStream = useRef<MediaStream | undefined>(undefined);
  const hoverTimer = useRef<number | undefined>(undefined);
  const modeRef = useRef<WindowMode>("compact");

  const updateMode = useCallback((nextMode: WindowMode) => {
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

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

    try {
      await stopMicrophone();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      const context = new AudioContext({ latencyHint: "interactive" });
      const source = context.createMediaStreamSource(stream);
      const nextAnalyser = context.createAnalyser();
      nextAnalyser.fftSize = 256;
      nextAnalyser.smoothingTimeConstant = 0.82;
      source.connect(nextAnalyser);
      mediaStream.current = stream;
      audioContext.current = context;
      setAnalyser(nextAnalyser);
    } catch (error) {
      setMicrophoneError(error instanceof Error ? error.message : String(error));
    }
  }, [stopMicrophone]);

  const changeMode = useCallback(
    async (expanded: boolean) => {
      const targetMode: WindowMode = expanded ? "expanded" : "compact";
      const previousMode = modeRef.current;
      modeRef.current = targetMode;
      try {
        const confirmedMode = await window.sidecar.setExpanded(expanded);
        updateMode(confirmedMode);
      } catch (error) {
        modeRef.current = previousMode;
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
    void window.sidecar.getBootstrap().then((value) => {
      setBootstrap(value);
      setDisplay(value.display);
      updateMode(value.mode);
      setMicrophoneStatus(value.microphoneStatus);
      if (value.profile === "microphone") {
        window.setTimeout(() => void startMicrophone(), 500);
      }
      window.sidecar.notifyReady();
    });
    const removeLifecycle = window.sidecar.onLifecycle((eventName) => {
      if (eventName === "mode:compact") updateMode("compact");
      if (eventName === "mode:expanded") updateMode("expanded");
    });
    const removeMicrophone = window.sidecar.onStartMicrophone(() => {
      void startMicrophone();
    });
    const removeDisplay = window.sidecar.onDisplayChanged(setDisplay);
    return () => {
      cancelHoverTransition();
      removeLifecycle();
      removeMicrophone();
      removeDisplay();
      void stopMicrophone();
    };
  }, [cancelHoverTransition, startMicrophone, stopMicrophone, updateMode]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && mode === "expanded") void changeMode(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [changeMode, mode]);

  if (!bootstrap || !display) return <div />;

  const attention = bootstrap.fixture.sessions.filter(
    (session) => session.state === "attention",
  ).length;
  const fixtureSpeaking = bootstrap.profile === "speaking";
  const hasAudioSignal = fixtureSpeaking || analyser !== undefined;
  const indicatorState = attention > 0 ? "attention" : "working";
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
              : "Sessions are active"
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
                    : "All sessions are moving"}
                </small>
              </span>
            </div>
          </header>

          <div className="summary-row">
            <div>
              <p className="eyebrow">Notch sidecar</p>
              <h1>Agent activity</h1>
              <p className="subtle">Synthetic sessions · no credentials or live transcripts</p>
            </div>
            <span className="fixture-badge">FIXTURE · SMOKE</span>
          </div>

          <div className="session-list">
            {bootstrap.fixture.sessions.map((item) => (
              <article className="session-row" key={item.id}>
                <span className={`status-mark ${item.state}`} />
                <span className="session-copy">
                  <strong>{item.title}</strong>
                  <small>
                    {item.provider} · {item.detail}
                  </small>
                </span>
                <span className={`session-status ${item.state}`}>{stateLabels[item.state]}</span>
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
