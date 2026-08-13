import { useEffect, useState } from "react";

/**
 * The hero visual: a CSS recreation of Luke's compact capsule expanding into
 * its session panel. There are no product screenshots in this repository, and
 * the landing page must build without the desktop workspace, so this mirrors
 * `@sidecar/core`'s value set locally instead of depending on it. Any drift is
 * cosmetic; the source of truth is `SESSION_STATE` in
 * `packages/sidecar-core/src/fixtures.ts`.
 */
const MOCK_SESSION_STATE = {
  WORKING: "working",
  ATTENTION: "attention",
  COMPLETE: "complete",
} as const;

type MockSessionState = (typeof MOCK_SESSION_STATE)[keyof typeof MOCK_SESSION_STATE];

const MOCK_MODE = {
  COMPACT: "compact",
  EXPANDED: "expanded",
} as const;

type MockMode = (typeof MOCK_MODE)[keyof typeof MOCK_MODE];

interface MockSession {
  id: string;
  title: string;
  provider: string;
  detail: string;
  state: MockSessionState;
  label: string;
}

/**
 * The repository's smoke fixture, rendered with text-only provider names.
 * Conductor's brand mark is licensed for the product's provider rows only.
 */
const MOCK_SESSIONS: readonly MockSession[] = [
  {
    id: "codex-bootstrap",
    title: "Bootstrap the desktop shell",
    provider: "Codex",
    detail: "Testing Electron window semantics",
    state: MOCK_SESSION_STATE.WORKING,
    label: "Working",
  },
  {
    id: "claude-review",
    title: "Review trust constraints",
    provider: "Claude Code",
    detail: "One architecture decision is ready",
    state: MOCK_SESSION_STATE.ATTENTION,
    label: "Needs attention",
  },
  {
    id: "conductor-workspace",
    title: "Observe a cloud workspace",
    provider: "Conductor",
    detail: "Cloud session metadata only · no live credentials",
    state: MOCK_SESSION_STATE.COMPLETE,
    label: "Complete",
  },
];

const ATTENTION_COUNT = MOCK_SESSIONS.filter(
  (session) => session.state === MOCK_SESSION_STATE.ATTENTION,
).length;

/** The compact dot takes the most urgent state, exactly as the renderer does. */
const COMPACT_INDICATOR_STATE: MockSessionState =
  ATTENTION_COUNT > 0 ? MOCK_SESSION_STATE.ATTENTION : MOCK_SESSION_STATE.WORKING;

const MOCK_LABEL = `Luke's notch capsule expanding into its session panel, listing ${MOCK_SESSIONS.map(
  (session) => `${session.title} on ${session.provider}, ${session.label.toLowerCase()}`,
).join("; ")}.`;

/* ── Reserved decision: how busy should the idle hero feel? ───────────────────
 *
 * The mock drives itself until a pointer enters it. Two knobs decide whether
 * that reads as "alive" or as "a GIF that will not sit still":
 *
 *   PHASE_MS      how long each state holds before the next one.
 *   SETTLE_AFTER  how many times the panel opens before the mock stops cycling
 *                 and simply stays open. `null` cycles forever.
 *
 * TODO(charles): pick these two values. The trade-off: cycling forever keeps
 * demonstrating the product's one gesture to a reader who arrives late or
 * scrolls back up, but it also moves in the corner of the eye for as long as
 * anyone is reading the copy below it. Settling shows the gesture a couple of
 * times, then leaves the most informative state — the full session list — on
 * screen and gets out of the way.
 *
 * `SETTLE_AFTER` is typed rather than `as const` so that `null` stays a
 * reachable option; the AGENTS.md `as const` convention covers fixed value
 * sets, not tuning constants.
 */
const AUTO_CYCLE: { readonly PHASE_MS: number; readonly SETTLE_AFTER: number | null } = {
  PHASE_MS: 3000,
  SETTLE_AFTER: 1,
};

/** The next state the idle mock should move to, or `undefined` to settle. */
function nextAutoCycleMode(current: MockMode, opensSoFar: number): MockMode | undefined {
  if (current === MOCK_MODE.COMPACT) return MOCK_MODE.EXPANDED;
  if (AUTO_CYCLE.SETTLE_AFTER !== null && opensSoFar >= AUTO_CYCLE.SETTLE_AFTER) return undefined;
  return MOCK_MODE.COMPACT;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Re-read on mount: the preference can change between the lazy initializer
    // and this effect, and it can change again while the page is open.
    setReduced(query.matches);
    const handleChange = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };
    query.addEventListener("change", handleChange);
    return () => {
      query.removeEventListener("change", handleChange);
    };
  }, []);

  return reduced;
}

export function NotchMock(): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<MockMode>(MOCK_MODE.COMPACT);
  const [opens, setOpens] = useState(0);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    if (reducedMotion || hovering) return;
    const next = nextAutoCycleMode(mode, opens);
    if (!next) return;

    // A re-arming timeout rather than an interval: the cycle has to be able to
    // stop itself, and not arming is simpler than clearing from inside a tick.
    // It is also symmetric under StrictMode's double invoke — the first timer
    // is cleared before the second is armed, so only one ever runs.
    const timer = window.setTimeout(() => {
      setMode(next);
      if (next === MOCK_MODE.EXPANDED) setOpens((count) => count + 1);
    }, AUTO_CYCLE.PHASE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [hovering, mode, opens, reducedMotion]);

  // Someone who asked for less motion gets the panel that carries the most
  // information, held still. No timer is ever armed in that case.
  const displayMode = reducedMotion ? MOCK_MODE.EXPANDED : mode;

  return (
    <div className="mock-wrapper">
      {/* Pointer handlers with no keyboard equivalent are deliberate: hovering
          only reaches a state the auto-cycle already shows on its own, so it
          adds emphasis rather than information. The whole mock is one labelled
          image to assistive technology. */}
      <div
        className="mock"
        data-mode={displayMode}
        role="img"
        aria-label={MOCK_LABEL}
        onPointerEnter={() => {
          setHovering(true);
          setMode(MOCK_MODE.EXPANDED);
        }}
        onPointerLeave={() => {
          setHovering(false);
        }}
      >
        <span className="mock-frame" />
        <span className="mock-glow" />

        {/* Both stages keep their full layout box behind `opacity: 0`, so the
            hidden one is marked inert for the same reason the app marks its
            own: without it, find-in-page matches invisible session titles and
            a drag selects text nobody can see. */}
        <div className="mock-compact" inert={displayMode !== MOCK_MODE.COMPACT}>
          <span className="mock-housing" />
          <span className="mock-indicator-target">
            <span className={`mock-indicator ${COMPACT_INDICATOR_STATE}`} />
          </span>
        </div>

        <div className="mock-expanded" inert={displayMode !== MOCK_MODE.EXPANDED}>
          <section className="mock-panel">
            <header className="mock-header">
              <div className="mock-header-status">
                <span className="mock-header-indicator" />
                <span className="mock-header-copy">
                  <strong>Monitoring</strong>
                  <small>
                    {ATTENTION_COUNT} session{ATTENTION_COUNT === 1 ? "" : "s"} needs attention
                  </small>
                </span>
              </div>
            </header>

            <div className="mock-body">
              <div className="mock-summary">
                <div>
                  <p className="mock-eyebrow">Notch sidecar</p>
                  <p className="mock-title">Agent activity</p>
                  <p className="mock-subtle">Live sessions · no transcripts retained</p>
                </div>
                <span className="mock-badge">LIVE</span>
              </div>

              <div className="mock-session-list">
                {MOCK_SESSIONS.map((session) => (
                  <article className="mock-session-row" key={session.id}>
                    <span className={`mock-status-mark ${session.state}`} />
                    <span className="mock-session-copy">
                      <strong>{session.title}</strong>
                      <small>
                        {session.provider} · {session.detail}
                      </small>
                    </span>
                    <span className={`mock-session-status ${session.state}`}>{session.label}</span>
                  </article>
                ))}
              </div>
            </div>

            <footer className="mock-footer">
              <div className="mock-diagnostics">
                <span>Electron 43.3.0</span>
                <span>Packaged</span>
                <span>Hardware notch</span>
                <span>appkit</span>
              </div>
              <div className="mock-footer-actions">
                <span className="mock-quiet-button">Settings</span>
                <span className="mock-quiet-button">Quit</span>
              </div>
            </footer>
          </section>
        </div>
      </div>
    </div>
  );
}
