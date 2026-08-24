import { FIXTURE_EPOCH_MS, fixtureSnapshot } from "@sidecar/fixtures";
import {
  OptionsIcon,
  observedAgoLabel,
  ProviderMark,
  SessionRow,
  WingFace,
  wingMarkCapacity,
} from "@sidecar/panel";
import {
  CAPSULE_SIDE_WIDTH,
  compareSessionsByUrgency,
  MOTION_DURATION_MS,
  PANEL_WIDTH,
  PEEK_SIDE_GROWTH,
  SESSION_URGENCY,
  type SessionUrgency,
  urgencyLabel,
} from "@sidecar/surface";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

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

/**
 * The wing's marks as the renderer's `sessionTally` seats them, first to need
 * a person first: each chat counts under the app holding it — the lead of its
 * application marks — or under its provider's own where no app holds one.
 */
const WING_PROVIDERS = MOCK_SESSIONS.map(
  (session) => session.applications?.[0]?.id ?? session.providerId,
).filter((markId, index, all) => all.indexOf(markId) === index);

/**
 * `wingMarkCapacity` and its constants in the renderer's notch-wings.tsx: what
 * one wing costs to fill, so the peek counts its remainder and the panel does
 * not have to. The insets are `--panel-inset` on the far side, where the marks
 * start level with the tab bar and the rows, plus `--wing-inset` beside the
 * housing.
 */
const PEEK_CAPACITY = wingMarkCapacity(CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH);
const PANEL_CAPACITY = wingMarkCapacity((PANEL_WIDTH - HOUSING_WIDTH) / 2);

/** `--duration-exit`: a shrinking wing keeps its marks until their fade ends. */
const MARK_EXIT_MS = MOTION_DURATION_MS.EXIT;

/**
 * `observedAgoLabel` in the renderer, read against the fixture's own epoch so
 * the page's labels match the product's evidence captures exactly.
 */
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

  const mockStyle =
    panelHeight === undefined
      ? undefined
      : cssCustomProperties({ "--panel-height": `${panelHeight}px` });

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
                    // SAFETY: React.CSSProperties omits the declared --row-index custom property.
                    <article
                      className="session-row"
                      data-state={session.urgency}
                      style={{ "--row-index": index + 1 } as CSSProperties}
                      key={session.id}
                    >
                      <SessionRow
                        providerId={session.providerId}
                        cloud={session.location === "cloud"}
                        title={session.title}
                        detail={session.detail}
                        working={session.urgency === SESSION_URGENCY.WORKING}
                        complete={session.urgency === SESSION_URGENCY.COMPLETE}
                        place={session.branch ?? session.repository}
                        branch={Boolean(session.branch)}
                        when={observedAgoLabel(session.observedAt, FIXTURE_EPOCH_MS)}
                      />
                    </article>
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
