import {
  getShaderColorFromString,
  meshGradientFragmentShader,
  ShaderMount,
} from "@paper-design/shaders";
import { FIXTURE_EPOCH_MS, fixtureSnapshot } from "@sidecar/fixtures";
import {
  lastActivityLabel,
  OptionsIcon,
  ProviderMark,
  SessionRow,
  WingFace,
  wingMarkCapacity,
  wingPileOffset,
} from "@sidecar/panel";
import {
  CAPSULE_SIDE_WIDTH,
  compareSessionsByUrgency,
  MOTION_DURATION_MS,
  PANEL_WIDTH,
  PEEK_SIDE_GROWTH,
  SESSION_URGENCY,
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
 * In the product the pointer drives those presentations. On the page the mock
 * drives itself, on a loop: capsule → peek → panel, a long pause open, then
 * folded back down to walk again. The open panel is the page's real hero —
 * the state that shows what Luke is for — so it holds most of every lap, and
 * the motion around it is seen by everyone rather than staged behind a scroll
 * or a hover. Under reduced motion the loop never runs and the panel is
 * simply there.
 */
const MOCK_MODE = {
  CAPSULE: "capsule",
  PEEK: "peek",
  PANEL: "panel",
} as const;

type MockMode = (typeof MOCK_MODE)[keyof typeof MOCK_MODE];

/**
 * How long each presentation holds before the loop moves on. The capsule
 * keeps a beat so the product is seen at rest before it answers; the peek
 * holds long enough for the marks to be read once the surface settles; the
 * panel holds far longest, because the pause on the open state
 * is the point and the walk exists to frame it.
 */
const CYCLE = {
  [MOCK_MODE.CAPSULE]: { holdMs: 1000, next: MOCK_MODE.PEEK },
  [MOCK_MODE.PEEK]: { holdMs: 1200, next: MOCK_MODE.PANEL },
  [MOCK_MODE.PANEL]: { holdMs: 6000, next: MOCK_MODE.CAPSULE },
} as const satisfies Record<MockMode, { holdMs: number; next: MockMode }>;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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

/**
 * The wing's marks as the renderer's `sessionTally` seats them, first to need
 * a person first: each chat counts under the app holding it — the lead of its
 * application marks — or under its provider's own where no app holds one.
 */
const WING_PROVIDERS = MOCK_SESSIONS.map(
  (session) => session.applications?.[0]?.id ?? session.providerId,
).filter((markId, index, all) => all.indexOf(markId) === index);

/**
 * `wingMarkCapacity` in `@sidecar/panel`: how many marks a wing of each width
 * lays flat. Whatever a state cannot hold is truncated rather than counted,
 * and the capsule's own side holds one.
 */
const PEEK_CAPACITY = wingMarkCapacity(CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH);
const PANEL_CAPACITY = wingMarkCapacity((PANEL_WIDTH - HOUSING_WIDTH) / 2);

/**
 * The display the mock sits in, painted by Paper's mesh gradient — bundled
 * and pinned, so the page carries its own shader instead of fetching one at
 * runtime. The palette runs indigo into the product's cyan with one violet
 * spot: bright enough that the pure-black capsule and panel cut a hard
 * silhouette, dark enough that the art stays a backdrop rather than a rival.
 */
const BACKDROP_COLORS = ["#0c1430", "#20308f", "#5cd5ff", "#123f6e", "#7a5cff"];
const BACKDROP_DISTORTION = 0.85;
const BACKDROP_SWIRL = 0.5;
const BACKDROP_SPEED = 0.5;

/**
 * `lastActivityLabel` in the renderer, read against the fixture's own epoch so
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
  // The loop never runs under reduced motion, where a timed tour is exactly
  // the motion the visitor asked not to see: the panel is there from the
  // first paint, not popped in by a mount effect.
  const [mode, setMode] = useState<MockMode>(() =>
    window.matchMedia(REDUCED_MOTION_QUERY).matches ? MOCK_MODE.PANEL : MOCK_MODE.CAPSULE,
  );
  const [panelHeight, setPanelHeight] = useState<number>();

  useEffect(() => {
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
    let timer: number;
    const hold = (current: MockMode) => {
      const { holdMs, next } = CYCLE[current];
      timer = window.setTimeout(() => {
        setMode(next);
        hold(next);
      }, holdMs);
    };
    hold(MOCK_MODE.CAPSULE);
    return () => window.clearTimeout(timer);
  }, []);

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

  // Mounted imperatively because ShaderMount owns its canvas. Reduced motion
  // holds the gradient at its first frame rather than hiding it — a still
  // image is not motion — and the query is watched live, so toggling the
  // setting mid-visit answers like the rest of the mock does. A machine
  // without WebGL throws here, leaving the frame's own gradient as the
  // display.
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = backdrop.current;
    if (!host) return;
    const reduceMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    let mount: ShaderMount | undefined;
    try {
      mount = new ShaderMount(
        host,
        meshGradientFragmentShader,
        {
          u_fit: 1,
          u_scale: 1,
          u_rotation: 0,
          u_originX: 0.5,
          u_originY: 0.5,
          u_offsetX: 0,
          u_offsetY: 0,
          u_worldWidth: 0,
          u_worldHeight: 0,
          u_colors: BACKDROP_COLORS.map((color) => getShaderColorFromString(color)),
          u_colorsCount: BACKDROP_COLORS.length,
          u_distortion: BACKDROP_DISTORTION,
          u_swirl: BACKDROP_SWIRL,
          u_grainMixer: 0,
          u_grainOverlay: 0,
        },
        undefined,
        reduceMotion.matches ? 0 : BACKDROP_SPEED,
      );
    } catch {
      // Nothing to do: the backdrop div stays empty over the frame.
    }
    const applySpeed = () => mount?.setSpeed(reduceMotion.matches ? 0 : BACKDROP_SPEED);
    reduceMotion.addEventListener("change", applySpeed);
    return () => {
      reduceMotion.removeEventListener("change", applySpeed);
      mount?.dispose();
    };
  }, []);

  // The wing is bounded by the shape its state draws, so its mark capacity is
  // too — and the loop's fold from panel back to capsule shrinks it, so a
  // shrinking capacity waits out the exit fade, as the renderer's does, and
  // no mark is unmounted mid-fade.
  const capacity = mode === MOCK_MODE.PANEL ? PANEL_CAPACITY : PEEK_CAPACITY;
  const [drawnCapacity, setDrawnCapacity] = useState(capacity);
  if (capacity > drawnCapacity) setDrawnCapacity(capacity);
  useEffect(() => {
    if (capacity >= drawnCapacity) return;
    const timer = window.setTimeout(() => setDrawnCapacity(capacity), MOTION_DURATION_MS.EXIT);
    return () => window.clearTimeout(timer);
  }, [capacity, drawnCapacity]);

  const providers = WING_PROVIDERS.slice(0, drawnCapacity);

  const mockStyle =
    panelHeight === undefined
      ? undefined
      : cssCustomProperties({ "--panel-height": `${panelHeight}px` });

  return (
    <div className="mock-stage">
      {/* One labelled image: nothing inside is a control,
          so the whole recreation reads as a single illustration. The hidden
          stage stays inert so find-in-page cannot match invisible titles and
          a drag cannot select text nobody can see. */}
      <div className="mock" data-mode={mode} role="img" aria-label={MOCK_LABEL} style={mockStyle}>
        <span className="mock-frame" />
        <div className="mock-backdrop" ref={backdrop} />

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
                      when={lastActivityLabel(session.lastActivityAt, FIXTURE_EPOCH_MS)}
                    />
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* The wings: Luke beside the housing on one side, the marks of what
              he is watching beside it on the other — piled at rest, spread
              flat once the shape has room. */}
        <div className="wing wing-left">
          <div className="wing-inner">
            <WingFace />
          </div>
        </div>

        <div className="wing wing-right">
          <div className="wing-inner">
            <span className="wing-marks">
              {providers.map((providerId, index) => (
                <span
                  className="wing-mark"
                  key={providerId}
                  data-piled={String(index === 0)}
                  style={cssCustomProperties({ "--mark-rest": `${wingPileOffset(index)}px` })}
                >
                  <ProviderMark providerId={providerId} />
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
