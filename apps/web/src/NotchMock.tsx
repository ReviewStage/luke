import {
  CAPSULE_SIDE_WIDTH,
  compareSessionsByUrgency,
  FIXTURE_EPOCH_MS,
  fixtureSnapshot,
  MOTION_DURATION_MS,
  PANEL_WIDTH,
  PEEK_SIDE_GROWTH,
  SESSION_LOCATION,
  SESSION_URGENCY,
  type SessionUrgency,
  urgencyLabel,
} from "@sidecar/core";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { CloudBadge, ProviderMark } from "./provider-marks";

/**
 * The hero visual: a CSS recreation of Luke's real surface, ported from
 * `apps/desktop/src/renderer`. It draws the product's smoke fixture and moves
 * through the product's own presentations — the capsule at rest, the peek,
 * the panel — on the same sampled spring, so the page and the app read as one
 * piece of software.
 *
 * In the product the pointer drives those presentations. On the page the
 * scroll does: the mock pins while the visitor scrolls through its section
 * and steps capsule → peek → panel as they go, so the motion is seen by
 * everyone who reaches the hero — including everyone on a phone — instead of
 * only by whoever thought to hover an unlabelled strip.
 */
const MOCK_MODE = {
  CAPSULE: "capsule",
  PEEK: "peek",
  PANEL: "panel",
} as const;

type MockMode = (typeof MOCK_MODE)[keyof typeof MOCK_MODE];

/**
 * Where each presentation begins, as a share of the pinned travel — from the
 * moment the pin catches to the moment the section lets it go. The capsule
 * keeps a beat at the start so arriving at the section shows the product at
 * rest before it answers; the panel takes the back of the travel, so it is
 * open for the whole of the pin's tail and is what the section leaves the
 * visitor looking at.
 */
const PEEK_AT = 0.1;
const PANEL_AT = 0.35;

/** The values a MacBook's notch reports, matching the renderer's fixture. */
const HOUSING_WIDTH = 210;

/**
 * The rows as the product arranges them: most urgent first, and within one
 * state the one that moved most recently. A fixture row whose provider said
 * nothing states its own state, exactly as the renderer's display model does.
 */
const MOCK_SESSIONS = fixtureSnapshot("smoke")
  .sessions.map((session) => ({
    ...session,
    detail: session.detail || urgencyLabel(session.urgency),
  }))
  .toSorted(compareSessionsByUrgency);

const ATTENTION_COUNT = MOCK_SESSIONS.filter(
  (session) => session.urgency === SESSION_URGENCY.ATTENTION,
).length;

/** The urgency the count badge and the capsule adopt, as `sessionTally` decides it. */
const TALLY_URGENCY: SessionUrgency =
  ATTENTION_COUNT > 0 ? SESSION_URGENCY.ATTENTION : SESSION_URGENCY.WORKING;

/** `tallyCaption` in the renderer: the caption names its own number. */
const TALLY_CAPTION =
  ATTENTION_COUNT > 0 ? `${ATTENTION_COUNT} ${ATTENTION_COUNT === 1 ? "needs" : "need"} you` : "";

/** Providers in the order the wing draws them: first to need a person first. */
const WING_PROVIDERS = MOCK_SESSIONS.map((session) => session.providerId).filter(
  (providerId, index, all) => all.indexOf(providerId) === index,
);

/**
 * `wingMarkCapacity` and its constants in the renderer's notch-wings.tsx: what
 * one wing costs to fill, so the peek counts its remainder and the panel does
 * not have to. The insets are `--panel-inset` on the far side, where the marks
 * start level with the tab bar and the rows, plus `--wing-inset` beside the
 * housing.
 */
const WING_INSETS = 29;
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
const MARK_EXIT_MS = MOTION_DURATION_MS.EXIT;

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

const MOCK_LABEL = `Luke's notch capsule expanding into its session panel, listing ${MOCK_SESSIONS.map(
  (session) =>
    `${session.title} on ${session.provider}, ${urgencyLabel(session.urgency).toLowerCase()}`,
).join("; ")}.`;

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
      data-state={session.urgency}
      // SAFETY: React.CSSProperties omits custom properties; --row-index is a declared custom property.
      style={{ "--row-index": index + 1 } as CSSProperties}
    >
      <span className="row-mark">
        <ProviderMark providerId={session.providerId} />
        {session.location === SESSION_LOCATION.CLOUD ? <CloudBadge /> : null}
      </span>
      <span className="row-copy">
        <strong>{session.title}</strong>
        <small className="row-doing">
          {session.urgency === SESSION_URGENCY.WORKING ? (
            <span className="row-spinner" aria-hidden="true" />
          ) : null}
          {session.urgency === SESSION_URGENCY.COMPLETE ? <CheckGlyph /> : null}
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
  const scrollSection = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);

  const applyMode = useCallback((next: MockMode) => {
    if (modeRef.current === next) return;
    modeRef.current = next;
    setMode(next);
  }, []);

  // The scroll is the whole interaction. Progress is the pin's own travel —
  // from where the sticky top catches the art to where the section's end
  // releases it — read entirely off layout-resolved values. Nothing here is
  // the live viewport: `window.innerHeight` shrinks and grows as a phone's
  // URL bar collapses, and a threshold measured against it jumps mid-scroll,
  // which is the very bounce the runway's `svh` units exist to avoid. Each
  // presentation holds its share of the travel in either direction:
  // scrolling back up folds the panel down to the peek and the peek back
  // into the capsule.
  useEffect(() => {
    const section = scrollSection.current;
    const pinned = pin.current;
    if (!section || !pinned) return;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      // The sticky offset is written in svh, so its used value only moves on
      // a real viewport change — orientation, not browser chrome. It is the
      // zero point and nothing else: the pin catches at `top = pinTop` and
      // the section lets go at `top = pinTop + pin - section`, so the travel
      // between the two is their difference alone, with the offset already
      // spent anchoring the start.
      const pinTop = Number.parseFloat(getComputedStyle(pinned).top) || 0;
      const travel = section.offsetHeight - pinned.offsetHeight;
      if (travel <= 0) {
        applyMode(MOCK_MODE.PANEL);
        return;
      }
      const progress = (pinTop - section.getBoundingClientRect().top) / travel;
      applyMode(
        progress >= PANEL_AT
          ? MOCK_MODE.PANEL
          : progress >= PEEK_AT
            ? MOCK_MODE.PEEK
            : MOCK_MODE.CAPSULE,
      );
    };
    const schedule = () => {
      frame ??= window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [applyMode]);

  // `useShapeHeight` in the renderer: the black surface ends where the content
  // does, so the panel's height is measured rather than guessed. Measured as
  // layout height, not `getBoundingClientRect()`: the mock is drawn under
  // `scale(var(--mock-scale))`, and a rect is post-transform — feeding that
  // back into the surface's own coordinate space cut the shape short by the
  // scale, which left the last rows drawn past the black on every phone.
  const observer = useRef<ResizeObserver>(undefined);
  const measurePanel = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = undefined;
    if (!element) return;
    const measure = () => setPanelHeight(element.offsetHeight);
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

  const mockStyle: CSSProperties = {};
  if (panelHeight !== undefined) {
    mockStyle["--panel-height"] = `${panelHeight}px`;
  }

  return (
    <div className="mock-scroll" ref={scrollSection}>
      <div className="mock-pin" ref={pin}>
        {/* One labelled image: nothing inside is a control,
            so the whole recreation reads as a single illustration. The hidden
            stage stays inert so find-in-page cannot match invisible titles and
            a drag cannot select text nobody can see. */}
        <div className="mock" data-mode={mode} role="img" aria-label={MOCK_LABEL} style={mockStyle}>
          <span className="mock-frame" />

          {/* Capsule, peek and panel are all this one shape at different sizes,
              so the surface is never cross-faded — it is only ever resized. */}
          <span className="panel-surface" />

          <div className="expanded-stage" inert>
            <section className="expanded-panel" ref={measurePanel}>
              <div className="body">
                <div
                  className="panel-header"
                  // SAFETY: React.CSSProperties omits custom properties; --row-index is a declared custom property.
                  style={{ "--row-index": 0 } as CSSProperties}
                >
                  <div
                    className="tab-bar"
                    // SAFETY: React.CSSProperties omits custom properties; --tab-count and --tab-index are declared custom properties.
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

          {/* The wings: Luke nearest the housing, what he is watching resting
              against the shape's far edge, the count and its caption on the
              other side. */}
          <div className="wing wing-left">
            <div className="wing-inner">
              <span className="wing-marks">
                {providers.map((providerId) => (
                  <span className="wing-mark" key={providerId}>
                    <ProviderMark providerId={providerId} />
                  </span>
                ))}
                {unshown > 0 ? <span className="wing-more">+{unshown}</span> : null}
              </span>
              <WingFace />
            </div>
          </div>

          <div className="wing wing-right">
            <div className="wing-inner">
              <span className="count-badge" data-state={TALLY_URGENCY}>
                <span className="count-value">{MOCK_SESSIONS.length}</span>
                <span className="count-caption">{TALLY_CAPTION}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
