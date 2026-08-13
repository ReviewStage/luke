import { fixtureSnapshot, SESSION_LOCATION, SESSION_STATE, type SessionState } from "@sidecar/core";
import { useState } from "react";

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

export function NotchMock(): React.JSX.Element {
  const [mode, setMode] = useState<MockMode>(MOCK_MODE.COMPACT);

  return (
    <div className="mock-wrapper">
      {/* Pointer handlers with no keyboard equivalent are deliberate: hovering
          changes only the presentation of this labelled image. Touch pointers
          cannot hover, so they leave the illustration compact. */}
      <div
        className="mock"
        data-mode={mode}
        role="img"
        aria-label={MOCK_LABEL}
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          setMode(MOCK_MODE.EXPANDED);
        }}
        onPointerLeave={() => {
          setMode(MOCK_MODE.COMPACT);
        }}
      >
        <span className="mock-frame" />

        {/* Both stages keep their full layout box behind `opacity: 0`, so the
            hidden one is marked inert for the same reason the app marks its
            own: without it, find-in-page matches invisible session titles and
            a drag selects text nobody can see. */}
        <div className="mock-compact" inert={mode !== MOCK_MODE.COMPACT}>
          <span className="mock-housing" />
          <span className="mock-indicator-target">
            <span className={`mock-indicator ${COMPACT_INDICATOR_STATE}`} />
          </span>
        </div>

        <div className="mock-expanded" inert={mode !== MOCK_MODE.EXPANDED}>
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
