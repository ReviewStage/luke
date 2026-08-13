import {
  CAPSULE_SIDE_WIDTH,
  FIXTURE_EPOCH_MS,
  fixtureSnapshot,
  PANEL_WIDTH,
  PEEK_SIDE_GROWTH,
  SESSION_LOCATION,
  SESSION_STATE,
  type SessionState,
} from "@sidecar/core";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

/**
 * The hero visual: a CSS recreation of Luke's real surface, ported from
 * `apps/desktop/src/renderer`. It draws the product's smoke fixture and moves
 * through the product's own presentations — the capsule at rest, the peek
 * under the pointer, the panel on a press — on the same sampled spring, so the
 * page and the app read as one piece of software.
 */
const MOCK_MODE = {
  CAPSULE: "capsule",
  PEEK: "peek",
  PANEL: "panel",
} as const;

type MockMode = (typeof MOCK_MODE)[keyof typeof MOCK_MODE];

/** `PEEK_ENTER_DELAY_MS` and `LEAVE_DELAY_MS` in the renderer's panel-state.ts. */
const PEEK_ENTER_DELAY_MS = 60;
const LEAVE_DELAY_MS = 110;

/**
 * The attract pass: one peek shortly after load, put away again a beat later,
 * so a visitor who never reaches for the art still sees the capsule answer.
 * The product does the same on first launch with `startPeeked`.
 */
const ATTRACT_ENTER_MS = 1_200;
const ATTRACT_HOLD_MS = 2_600;

/** The values a MacBook's notch reports, matching the renderer's fixture. */
const HOUSING_WIDTH = 210;

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

/**
 * The rows as the product arranges them: most urgent first, and within one
 * state the one that moved most recently. A fixture row whose provider said
 * nothing states its own state, exactly as the renderer's display model does.
 */
const MOCK_SESSIONS = fixtureSnapshot("smoke")
  .sessions.map((session) => ({
    ...session,
    detail: session.detail || STATE_LABEL[session.state],
  }))
  .toSorted(
    (left, right) =>
      STATE_PRIORITY.indexOf(left.state) - STATE_PRIORITY.indexOf(right.state) ||
      right.observedAt - left.observedAt,
  );

const ATTENTION_COUNT = MOCK_SESSIONS.filter(
  (session) => session.state === SESSION_STATE.ATTENTION,
).length;

/** The state the count badge and the capsule adopt, as `sessionTally` decides it. */
const TALLY_STATE: SessionState =
  ATTENTION_COUNT > 0 ? SESSION_STATE.ATTENTION : SESSION_STATE.WORKING;

/** `tallyCaption` in the renderer: the caption names its own number. */
const TALLY_CAPTION =
  ATTENTION_COUNT > 0 ? `${ATTENTION_COUNT} ${ATTENTION_COUNT === 1 ? "needs" : "need"} you` : "";

const TALLY_SUMMARY = `${MOCK_SESSIONS.length} sessions tracked, ${ATTENTION_COUNT} needing you`;

/** Providers in the order the wing draws them: first to need a person first. */
const WING_PROVIDERS = MOCK_SESSIONS.map((session) => session.providerId).filter(
  (providerId, index, all) => all.indexOf(providerId) === index,
);

/**
 * `wingMarkCapacity` and its constants in the renderer's notch-wings.tsx: what
 * one wing costs to fill, so the peek counts its remainder and the panel does
 * not have to.
 */
const WING_INSETS = 18;
const FACE_AND_GAP = 26;
const MARK_WIDTH = 14;
const MARK_AND_GAP = 21;

function wingMarkCapacity(sideWidth: number): number {
  const beyondFirst = Math.floor(
    (sideWidth - WING_INSETS - FACE_AND_GAP - MARK_WIDTH) / MARK_AND_GAP,
  );
  return Math.max(1, 1 + beyondFirst);
}

const PEEK_CAPACITY = wingMarkCapacity(CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH);
const PANEL_CAPACITY = wingMarkCapacity((PANEL_WIDTH - HOUSING_WIDTH) / 2);

/** `--duration-exit`: a shrinking wing keeps its marks until their fade ends. */
const MARK_EXIT_MS = 90;

/**
 * `observedAgoLabel` in the renderer, read against the fixture's own epoch so
 * the page's labels match the product's evidence captures exactly.
 */
function observedAgoLabel(observedAt: number): string {
  const elapsedMinutes = Math.floor((FIXTURE_EPOCH_MS - observedAt) / 60_000);
  if (elapsedMinutes < 1) return "Now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
}

const MOCK_LABEL = `Luke's session panel, listing ${MOCK_SESSIONS.map(
  (session) =>
    `${session.title} on ${session.provider}, ${STATE_LABEL[session.state].toLowerCase()}`,
).join("; ")}.`;

/**
 * Where the product draws a licensed provider mark, the public mock draws a
 * quiet geometric sigil instead, so the page republishes nobody's brand. One
 * shape per fixture provider, stroked on the same 24-box and weight as the
 * renderer's own glyphs, so the wings and the rows still tell one story.
 */
const AGENT_SIGILS: readonly React.JSX.Element[] = [
  <circle key="ring" cx="12" cy="12" r="7.6" />,
  <rect key="tile" x="5.2" y="5.2" width="13.6" height="13.6" rx="3.4" />,
  <path key="delta" d="M12 4.8 20 18.9H4z" />,
  <path key="lozenge" d="M12 4.2 19.8 12 12 19.8 4.2 12z" />,
  <path key="hex" d="M12 4.4l6.6 3.8v7.6L12 19.6l-6.6-3.8V8.2z" />,
];

function AgentSigil({
  providerId,
}: {
  providerId: (typeof WING_PROVIDERS)[number];
}): React.JSX.Element {
  const sigil = AGENT_SIGILS[WING_PROVIDERS.indexOf(providerId) % AGENT_SIGILS.length];
  return (
    <svg
      className="provider-mark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {sigil}
    </svg>
  );
}

/**
 * Luke's face at rest, traced from `design/brand/` like the nav's mark but on
 * the square window the renderer's own face uses, so it sits in the wing at
 * the same size and place the product keeps it. Still, because stillness is
 * the face's usual condition: it only moves when something happens to it.
 */
function WingFace(): React.JSX.Element {
  return (
    <svg className="luke-face" viewBox="48 51 146 146" fill="none" aria-hidden="true">
      <g transform="rotate(-8 120 124)">
        <path
          d="M 104 84 V 150 Q 104 164 118 164 Q 140 164 168 142"
          fill="none"
          stroke="currentColor"
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="78" cy="92" r="12" fill="currentColor" />
        <circle cx="162" cy="92" r="12" fill="currentColor" />
      </g>
    </svg>
  );
}

/** The renderer's own cloud badge: ours rather than a brand, drawn filled. */
function CloudBadge(): React.JSX.Element {
  return (
    <span className="cloud-badge">
      <svg viewBox="0 0 20 14" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M4.5 14a4.5 4.5 0 0 1-1.259-8.82 7 7 0 0 1 13.518 0A4.5 4.5 0 0 1 15.5 14z" />
      </svg>
    </span>
  );
}

/** The renderer's options glyph, on the header line the product spends it on. */
function OptionsIcon(): React.JSX.Element {
  return (
    <svg
      className="options-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.6 8.4h5.2" />
      <path d="M13.2 8.4h7.2" />
      <circle cx="11" cy="8.4" r="2.2" />
      <path d="M3.6 15.6h2.6" />
      <path d="M10.6 15.6h9.8" />
      <circle cx="8.4" cy="15.6" r="2.2" />
    </svg>
  );
}

function BranchGlyph(): React.JSX.Element {
  return (
    <svg className="row-branch-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="4.2" cy="3.4" r="1.55" />
        <circle cx="4.2" cy="12.6" r="1.55" />
        <circle cx="11.8" cy="5.2" r="1.55" />
        <path d="M4.2 5v6M11.8 6.9c0 2.5-2.6 3-5.4 3.4" />
      </g>
    </svg>
  );
}

function CheckGlyph(): React.JSX.Element {
  return (
    <svg className="row-check" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path
        d="M2.4 6.6l2.5 2.5 4.7-5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One session, drawn exactly as the renderer's `SessionRow` draws a fixture row. */
function MockSessionRow({
  session,
  index,
}: {
  session: (typeof MOCK_SESSIONS)[number];
  index: number;
}): React.JSX.Element {
  const place = session.branch ?? session.repository;
  return (
    <article
      className="session-row"
      data-state={session.state}
      style={{ "--row-index": index + 1 } as CSSProperties}
    >
      <span className="row-mark">
        <AgentSigil providerId={session.providerId} />
        {session.location === SESSION_LOCATION.CLOUD ? <CloudBadge /> : null}
      </span>
      <span className="row-copy">
        <strong>{session.title}</strong>
        <small className="row-doing">
          {session.state === SESSION_STATE.WORKING ? (
            <span className="row-spinner" aria-hidden="true" />
          ) : null}
          {session.state === SESSION_STATE.COMPLETE ? <CheckGlyph /> : null}
          <span className="row-doing-text">{session.detail}</span>
        </small>
        {place ? (
          <small className="row-place">
            {session.branch ? <BranchGlyph /> : null}
            <span>{place}</span>
          </small>
        ) : null}
      </span>
      <small className="row-when">{observedAgoLabel(session.observedAt)}</small>
    </article>
  );
}

export function NotchMock(): React.JSX.Element {
  const [mode, setMode] = useState<MockMode>(MOCK_MODE.CAPSULE);
  const [panelHeight, setPanelHeight] = useState<number>();
  const modeRef = useRef<MockMode>(MOCK_MODE.CAPSULE);
  const hoverTimer = useRef<number>(undefined);
  const interacted = useRef(false);

  const applyMode = useCallback((next: MockMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  const cancelHoverTransition = useCallback(() => {
    if (hoverTimer.current === undefined) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  }, []);

  /** The pointer arriving: the capsule peeks after the product's own delay. */
  const enterShape = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType === "touch") return;
      interacted.current = true;
      cancelHoverTransition();
      if (modeRef.current !== MOCK_MODE.CAPSULE) return;
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = undefined;
        if (modeRef.current === MOCK_MODE.CAPSULE) applyMode(MOCK_MODE.PEEK);
      }, PEEK_ENTER_DELAY_MS);
    },
    [applyMode, cancelHoverTransition],
  );

  /** The pointer leaving: peek and panel close on the same short delay. */
  const leaveShape = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType === "touch") return;
      cancelHoverTransition();
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = undefined;
        if (modeRef.current !== MOCK_MODE.CAPSULE) applyMode(MOCK_MODE.CAPSULE);
      }, LEAVE_DELAY_MS);
    },
    [applyMode, cancelHoverTransition],
  );

  /** The strip is a button: pressing it opens the panel, or closes it again. */
  const pressStrip = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.detail > 0) event.currentTarget.blur();
      interacted.current = true;
      cancelHoverTransition();
      applyMode(modeRef.current === MOCK_MODE.PANEL ? MOCK_MODE.CAPSULE : MOCK_MODE.PANEL);
    },
    [applyMode, cancelHoverTransition],
  );

  // One unprompted peek after load, exactly once, and never over a visitor
  // who has already taken the pointer to it. Reduced motion skips the theater:
  // with every transition at 1ms an unasked-for state change is just a blink.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const enter = window.setTimeout(() => {
      if (!interacted.current && modeRef.current === MOCK_MODE.CAPSULE) {
        applyMode(MOCK_MODE.PEEK);
      }
    }, ATTRACT_ENTER_MS);
    const leave = window.setTimeout(() => {
      if (!interacted.current && modeRef.current === MOCK_MODE.PEEK) {
        applyMode(MOCK_MODE.CAPSULE);
      }
    }, ATTRACT_ENTER_MS + ATTRACT_HOLD_MS);
    return () => {
      window.clearTimeout(enter);
      window.clearTimeout(leave);
    };
  }, [applyMode]);

  // Escape closes an open panel, as it does in the product.
  useEffect(() => {
    if (mode !== MOCK_MODE.PANEL) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelHoverTransition();
      applyMode(MOCK_MODE.CAPSULE);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [applyMode, cancelHoverTransition, mode]);

  // `useShapeHeight` in the renderer: the black surface ends where the content
  // does, so the panel's height is measured rather than guessed.
  const observer = useRef<ResizeObserver>(undefined);
  const measurePanel = useCallback((element: HTMLElement | null) => {
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

  // The wing is bounded by the shape its state draws, so its mark capacity is
  // too — and a shrinking capacity waits out the exit fade, as the renderer's
  // does, so no mark is unmounted mid-fade.
  const capacity = mode === MOCK_MODE.PANEL ? PANEL_CAPACITY : PEEK_CAPACITY;
  const [drawnCapacity, setDrawnCapacity] = useState(capacity);
  if (capacity > drawnCapacity) setDrawnCapacity(capacity);
  useEffect(() => {
    if (capacity >= drawnCapacity) return;
    const timer = window.setTimeout(() => setDrawnCapacity(capacity), MARK_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [capacity, drawnCapacity]);

  const overflowing = WING_PROVIDERS.length > drawnCapacity;
  const providers = WING_PROVIDERS.slice(0, overflowing ? drawnCapacity - 1 : drawnCapacity);
  const unshown = WING_PROVIDERS.length - providers.length;

  const panelOpen = mode === MOCK_MODE.PANEL;

  return (
    <div className="mock-wrapper">
      <div
        className="mock"
        data-mode={mode}
        style={
          {
            ...(panelHeight === undefined ? {} : { "--panel-height": `${panelHeight}px` }),
          } as CSSProperties
        }
      >
        <span className="mock-frame" />

        {/* Capsule, peek and panel are all this one shape at different sizes,
            so the surface is never cross-faded — it is only ever resized. */}
        <span className="panel-surface" aria-hidden="true" />

        {/* Inert while hidden, as in the product: the panel keeps its full
            layout box behind `opacity: 0`, so find-in-page and focus must not
            reach into it. */}
        <div className="expanded-stage" aria-hidden={!panelOpen} inert={!panelOpen}>
          <section
            className="expanded-panel"
            ref={measurePanel}
            role="img"
            aria-label={MOCK_LABEL}
            onPointerEnter={enterShape}
            onPointerLeave={leaveShape}
          >
            <div className="body">
              <div className="panel-header" style={{ "--row-index": 0 } as CSSProperties}>
                <div
                  className="tab-bar"
                  style={{ "--tab-count": 2, "--tab-index": 0 } as CSSProperties}
                >
                  <span className="tab-thumb" />
                  <span className="tab" data-active="true">
                    Sessions
                  </span>
                  <span className="tab" data-active="false">
                    Settings
                  </span>
                </div>
                <span className="options-button">
                  <OptionsIcon />
                </span>
              </div>
              <div className="session-list">
                {MOCK_SESSIONS.map((session, index) => (
                  <MockSessionRow key={session.id} session={session} index={index} />
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* The wings: Luke nearest the housing, what he is watching unfolding
            outward on one side, the count and its caption on the other. */}
        <div className="wing wing-left" aria-hidden="true">
          <div className="wing-inner">
            <span className="wing-marks">
              {providers.map((providerId) => (
                <span className="wing-mark" key={providerId}>
                  <AgentSigil providerId={providerId} />
                </span>
              ))}
              {unshown > 0 ? <span className="wing-more">+{unshown}</span> : null}
            </span>
            <WingFace />
          </div>
        </div>

        <div className="wing wing-right" aria-hidden="true">
          <div className="wing-inner">
            <span className="count-badge" data-state={TALLY_STATE}>
              <span className="count-value">{MOCK_SESSIONS.length}</span>
              <span className="count-caption">{TALLY_CAPTION}</span>
            </span>
          </div>
        </div>

        {/* The press target tracks the drawn shape, snapping rather than
            animating, exactly like the renderer's compact-hover-target. */}
        <button
          type="button"
          className="compact-hover-target"
          aria-expanded={panelOpen}
          aria-label={`${TALLY_SUMMARY}. ${panelOpen ? "Close" : "Open"} the panel`}
          onMouseDown={(event) => event.preventDefault()}
          onPointerEnter={enterShape}
          onPointerLeave={leaveShape}
          onClick={pressStrip}
        />
      </div>
    </div>
  );
}
