import { fixtureSnapshot, SESSION_LOCATION, SESSION_STATE, type SessionState } from "@sidecar/core";
import { useEffect, useState } from "react";

/**
 * The hero visual: a CSS recreation of Luke's compact capsule expanding into
 * its session panel. It renders the product's smoke fixture directly so the
 * sessions cannot drift from the app it represents.
 */
const MOCK_MODE = {
  COMPACT: "compact",
  EXPANDED: "expanded",
} as const;

type MockMode = (typeof MOCK_MODE)[keyof typeof MOCK_MODE];

const STATE_LABEL: Record<SessionState, string> = {
  [SESSION_STATE.WORKING]: "Working",
  [SESSION_STATE.ATTENTION]: "Needs you",
  [SESSION_STATE.COMPLETE]: "Complete",
  [SESSION_STATE.UNKNOWN]: "Idle",
};

const STATE_PRIORITY: readonly SessionState[] = [
  SESSION_STATE.ATTENTION,
  SESSION_STATE.WORKING,
  SESSION_STATE.COMPLETE,
  SESSION_STATE.UNKNOWN,
];

const MOCK_SESSIONS = fixtureSnapshot("smoke").sessions.toSorted(
  (left, right) => STATE_PRIORITY.indexOf(left.state) - STATE_PRIORITY.indexOf(right.state),
);

const ATTENTION_COUNT = MOCK_SESSIONS.filter(
  (session) => session.state === SESSION_STATE.ATTENTION,
).length;

/** The compact dot takes the most urgent state, exactly as the renderer does. */
const COMPACT_INDICATOR_STATE: SessionState =
  ATTENTION_COUNT > 0 ? SESSION_STATE.ATTENTION : SESSION_STATE.WORKING;

const MOCK_LABEL = `Luke's notch capsule expanding into its session panel, listing ${MOCK_SESSIONS.map(
  (session) =>
    `${session.title} on ${session.provider}, ${STATE_LABEL[session.state].toLowerCase()}`,
).join("; ")}.`;

/* ── How busy the idle hero feels ─────────────────────────────────────────────
 *
 * The mock drives itself until a pointer enters it. Two knobs decide whether
 * that reads as "alive" or as "a GIF that will not sit still":
 *
 *   PHASE_MS      how long each state holds before the next one.
 *   SETTLE_AFTER  how many times the panel opens before the mock stops cycling
 *                 and simply stays open. `null` cycles forever.
 *
 * Settling after a single open won: cycling forever keeps demonstrating the
 * product's one gesture to a reader who arrives late, but it also moves in the
 * corner of the eye for as long as anyone is reading the copy below it. One
 * open shows the gesture, then leaves the most informative state — the full
 * session list — on screen and gets out of the way.
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
          // A hover opens the panel deliberately, so it counts toward settling
          // exactly as an auto-open does. Without this, hovering inside the
          // first phase leaves `opens` at zero and the mock collapses once more
          // after the pointer leaves — the opposite of what SETTLE_AFTER is for.
          if (mode !== MOCK_MODE.EXPANDED) setOpens((count) => count + 1);
          setMode(MOCK_MODE.EXPANDED);
        }}
        onPointerLeave={() => {
          setHovering(false);
        }}
      >
        <span className="mock-frame" />

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
            <div className="mock-body">
              <div className="mock-tab-bar">
                <span className="mock-tab-thumb" />
                <span className="mock-tab" data-active="true">
                  Sessions
                </span>
                <span className="mock-tab" data-active="false">
                  Settings
                </span>
              </div>

              <div className="mock-session-list">
                {MOCK_SESSIONS.map((session) => (
                  <article className="mock-session-row" key={session.id}>
                    {/* The app leads with licensed provider marks. The public
                        mock uses a state dot so it does not republish them. */}
                    <span className={`mock-status-mark ${session.state}`} />
                    <span className="mock-session-copy">
                      <strong>{session.title}</strong>
                      <small>
                        {session.provider}
                        {session.location === SESSION_LOCATION.CLOUD ? " · Cloud" : ""}
                        {session.detail ? ` · ${session.detail}` : ""}
                      </small>
                    </span>
                    <span className={`mock-session-status ${session.state}`}>
                      {STATE_LABEL[session.state]}
                    </span>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
