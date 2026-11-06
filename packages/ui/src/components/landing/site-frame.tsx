import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { MOTION_TOKEN, tokenTiming } from "../../motion-timing.js";
import { LandingWordmark } from "./landing-wordmark.js";

/**
 * site-frame.tsx -- the frame every page of the public site stands in: the margin grid's rails, a bar that floats once the page scrolls, and the foot's links over the wordmark in dots.
 *
 * Two hairline rails run the page's length at the content's edges, and a
 * rule across them (`SiteRule`) wears a cross where it meets each. The bar
 * spans the page at its top and, once the reader scrolls, narrows into a
 * floating pill on the ground's surface over the rails; its header keeps
 * one height and the bar stands in it out of the page's flow, so floating
 * moves nothing under it. The foot holds the site's links over the
 * product's wordmark set in copper dots (`landing-wordmark.tsx`). The
 * landing (`LandingPage`) and every other public page (`PublicPage`) are
 * drawn in it, so the site reads as one. It is drawn in `landing.css`.
 *
 * The bar floats as the window's panes open (docs/DESIGN.md, "Layout lands
 * at once"): it lands in its new layout on the frame the scroll crosses the
 * line, and replays the trip from a snapshot of where it was drawn. Its
 * ground and edge are uncovered or covered from their old shape by a clip,
 * and each of its pieces glides from where it stood on a transform, so no
 * word reflows on the way. A scroll back part way through starts every part
 * again from where it had got to.
 */

/**
 * How far the reader scrolls before the bar floats, and how near the top
 * they come back before it spans the page again, in CSS pixels. Note that
 * the two differ, because a phone's scroll bounces past the top and its
 * toolbar's collapse nudges the offset, which would flip one threshold back
 * and forth mid-animation.
 */
const FLOAT = { AFTER: 24, BEFORE: 4 } as const;

/** The bar's two ground layers, its edge and the fill over it, each clipped to the bar's shape (landing.css). */
const GROUND_LAYERS = ["::before", "::after"] as const;

/** The name the bar's motion plays under, so a change part way through finds what to stop. */
const FLOAT_MOTION = "site-bar-float";

/** Less than this, in CSS pixels, is not a move worth playing nor a change of size. */
const STILL = 0.5;

/** Where each of the bar's elements was drawn, and how each ground layer was clipped and colored. */
interface BarDrawn {
  boxes: Map<Element, DOMRect>;
  layers: Keyframe[];
}

/** Where each element in the bar is drawn now, a glide under way included. */
function boxesIn(bar: Element): Map<Element, DOMRect> {
  const boxes = new Map<Element, DOMRect>();
  for (const element of bar.querySelectorAll("*"))
    boxes.set(element, element.getBoundingClientRect());
  return boxes;
}

/** How a ground layer is clipped and colored now, a motion under way included. */
function layerPose(header: Element, layer: string): Keyframe {
  const style = getComputedStyle(header, layer);
  return { clipPath: style.clipPath, backgroundColor: style.backgroundColor };
}

/**
 * Glides each of `parent`'s pieces from where it was drawn to where it now
 * stands. Note that a piece the change resized, a row spread across the
 * bar's width, is not moved itself: its own pieces are, each holding its
 * size, so nothing that holds words changes shape mid-motion.
 */
function glidePieces(
  parent: Element,
  was: Map<Element, DOMRect>,
  now: Map<Element, DOMRect>,
  timing: KeyframeAnimationOptions,
): void {
  for (const piece of parent.children) {
    const from = was.get(piece);
    const to = now.get(piece);
    if (from === undefined || to === undefined) continue;
    if (Math.abs(from.width - to.width) >= STILL || Math.abs(from.height - to.height) >= STILL) {
      glidePieces(piece, was, now, timing);
      continue;
    }
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < STILL && Math.abs(dy) < STILL) continue;
    piece.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], timing);
  }
}

/**
 * Floats the bar under `header`, or spans the page with it again: the new
 * layout lands at once, and the trip is replayed from where the bar was
 * drawn, a trip under way included, on the shape's motion tokens. Reduced
 * motion and a capture run zero those tokens, so the bar lands with nothing
 * played.
 */
function float(header: HTMLElement, bar: Element, floating: boolean): void {
  const timing = tokenTiming(header, MOTION_TOKEN.DURATION_SHAPE, MOTION_TOKEN.EASE_PANE);
  const before: BarDrawn | undefined =
    timing === undefined
      ? undefined
      : { boxes: boxesIn(bar), layers: GROUND_LAYERS.map((layer) => layerPose(header, layer)) };
  for (const motion of header.getAnimations({ subtree: true })) {
    if (motion.id === FLOAT_MOTION) motion.cancel();
  }
  header.dataset.floating = String(floating);
  if (timing === undefined || before === undefined) return;
  const played = { ...timing, id: FLOAT_MOTION };
  // Note that everything is measured before anything plays, so the layout is worked out once.
  const after = boxesIn(bar);
  const layers = GROUND_LAYERS.map((layer) => layerPose(header, layer));
  GROUND_LAYERS.forEach((pseudoElement, index) => {
    header.animate([before.layers[index] ?? {}, layers[index] ?? {}], { ...played, pseudoElement });
  });
  glidePieces(bar, before.boxes, after, played);
}

/**
 * Floats the bar once the page has scrolled past the bar's own height. Note
 * that the page opens as it stands, so a reload part way down lands the bar
 * floating rather than playing the trip there, and before the first frame is
 * drawn, so no frame shows it spanning the page.
 */
function useFloatingBar(header: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = header.current;
    const bar = element?.firstElementChild;
    if (element === null || element === undefined || bar === null || bar === undefined) return;
    let floating = window.scrollY > FLOAT.AFTER;
    element.dataset.floating = String(floating);
    const read = (): void => {
      const next = floating ? window.scrollY > FLOAT.BEFORE : window.scrollY > FLOAT.AFTER;
      if (next === floating) return;
      floating = next;
      float(element, bar, next);
    };
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [header]);
}

/** A rule across the page, a cross where it meets each rail. */
export function SiteRule(): React.JSX.Element {
  return (
    <div className="ui-landing-rule" aria-hidden="true">
      <i />
      <i />
    </div>
  );
}

/**
 * The bar's links to the site's own pages, set apart from the actions after
 * them by a hairline; a page narrower than a phone's leaves them to the foot,
 * which links them too.
 */
export function SiteBarPages({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="ui-landing-bar-pages">{children}</span>;
}

/** The site's frame: `bar` and its `barCall` over the page's `children`, over the `footer` and the wordmark. */
export function SiteFrame({
  bar,
  barCall,
  footer,
  children,
}: {
  /** The site's wordmark and links, laid across the bar; none draws no bar. */
  bar?: ReactNode;
  /** The bar's call at its end, which a page narrower than a phone's leaves out. */
  barCall?: ReactNode;
  /** The site's closing links and notices; none draws no foot. */
  footer?: ReactNode;
  /** The page itself, its `main` among it. */
  children: ReactNode;
}): React.JSX.Element {
  const header = useRef<HTMLElement>(null);
  useFloatingBar(header);
  return (
    <div className="ui-landing-page">
      <div className="ui-landing-rails" aria-hidden="true" />
      {bar === undefined || bar === null ? null : (
        <header ref={header} className="ui-landing-bar">
          <div className="ui-landing-bar-in">
            {bar}
            {barCall === undefined ? null : <span className="ui-landing-bar-call">{barCall}</span>}
          </div>
        </header>
      )}
      {children}
      {footer === undefined || footer === null ? null : (
        <footer className="ui-landing-foot">
          <div className="ui-landing-foot-links">{footer}</div>
          <div className="ui-landing-foot-art">
            <LandingWordmark />
          </div>
        </footer>
      )}
    </div>
  );
}
