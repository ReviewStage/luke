import { type ReactNode, useEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";

/**
 * landing-devices.tsx -- the landing's devices: a Mac window at 16:10 and a modern iPhone, each drawing a screen laid out at the device's own size and scaled to the room it is given.
 *
 * A screen inside is laid out at the size the app draws at (a 1280 by 800
 * window, a 393 by 852 phone), so its rows, bars, and type keep the app's
 * own proportions, and the device scales it to fit, measuring its own box
 * rather than the viewport. The window wears the app's frame (the sidebar's
 * ground around the sheet) and three quiet lights; the phone a thin even
 * bezel, deep corners, and the Dynamic Island. A pane is one column of the
 * window cut out at true size, for a page with no room to read the whole.
 * None is ever pressed: what they hold is inert, and a reader is told only
 * what it shows.
 */

/** The size each device lays its screen out at, in CSS pixels. */
const SCREEN = {
  WINDOW: { WIDTH: 1280, HEIGHT: 800 },
  PHONE: { WIDTH: 393, HEIGHT: 852 },
} as const;

/** How far the screen is scaled to fill `box`'s width, `width` wide as laid out; 1 until it is measured. */
function useFit(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const box = ref.current;
    // Note that a document with no layout, as jsdom's is, keeps the screen unscaled, because it has no box to measure.
    if (!box || typeof ResizeObserver === "undefined") return undefined;
    const watch = new ResizeObserver(([entry]) => {
      const room = entry?.contentRect.width ?? width;
      setScale(room > 0 ? room / width : 1);
    });
    watch.observe(box);
    return () => watch.disconnect();
  }, [width]);
  return { ref, style: cssCustomProperties({ "--ui-landing-fit": scale }) };
}

/** A Mac window, 16:10, drawing `children` laid out at 1280 by 800. */
export function LandingWindow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  const fit = useFit(SCREEN.WINDOW.WIDTH);
  return (
    <div className="ui-landing-window" role="img" aria-label={label}>
      <div ref={fit.ref} className="ui-landing-window-fit" style={fit.style}>
        <div className="ui-landing-window-screen" inert>
          <span className="ui-landing-window-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * One pane of a Mac window cut out of it, drawing `children` at the room's
 * own width and unscaled: what a page too narrow to read the whole window
 * shows in its place (`landing.css`), so its words stand at true size.
 */
export function LandingPane({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-landing-pane" role="img" aria-label={label}>
      <div className="ui-landing-pane-screen" inert>
        {children}
      </div>
    </div>
  );
}

/** A modern iPhone drawing `children` laid out at 393 by 852. */
export function LandingPhone({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  const fit = useFit(SCREEN.PHONE.WIDTH);
  return (
    <div className="ui-landing-phone" role="img" aria-label={label}>
      <div ref={fit.ref} className="ui-landing-phone-fit" style={fit.style}>
        <div className="ui-landing-phone-screen" inert>
          {children}
        </div>
      </div>
      <span className="ui-landing-phone-island" aria-hidden="true" />
    </div>
  );
}
