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
 * window cut out, laid out at least as wide as a narrow column of the app
 * and scaled to the room, for a page with no room to read the whole. None
 * is ever pressed: what they hold is inert, and a reader is told only what
 * it shows.
 */

/**
 * The size each device lays its screen out at, in CSS pixels; a pane's is
 * its least width, the one `landing.css`'s pane proportions are drawn for.
 */
const SCREEN = {
  WINDOW: { WIDTH: 1280, HEIGHT: 800 },
  PHONE: { WIDTH: 393, HEIGHT: 852 },
  PANE: { WIDTH: 440 },
} as const;

/** The width of the box `ref` names, once it is measured. */
function useRoom() {
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | undefined>(undefined);
  useEffect(() => {
    const box = ref.current;
    // Note that a document with no layout, as jsdom's is, keeps the screen unscaled, because it has no box to measure.
    if (!box || typeof ResizeObserver === "undefined") return undefined;
    const watch = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      setRoom(width > 0 ? width : undefined);
    });
    watch.observe(box);
    return () => watch.disconnect();
  }, []);
  return [ref, room] as const;
}

/** How far the screen is scaled to fill its box's width, `width` wide as laid out; 1 until it is measured. */
function useFit(width: number) {
  const [ref, room] = useRoom();
  return {
    ref,
    style: cssCustomProperties({ "--ui-landing-fit": room === undefined ? 1 : room / width }),
  };
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
 * One pane of a Mac window cut out of it: what a page too narrow to read the
 * whole window shows in its place (`landing.css`). It lays `children` out at
 * the room's width, or 440 where the room is narrower, and scales them down
 * to fit, so a phone's column draws the app's own column a little smaller
 * rather than a wrapped one at full size; its box keeps the proportions its
 * scene sets.
 */
export function LandingPane({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  const [ref, room] = useRoom();
  const width = Math.max(room ?? SCREEN.PANE.WIDTH, SCREEN.PANE.WIDTH);
  const style = cssCustomProperties({
    "--ui-landing-fit": room === undefined ? 1 : room / width,
    "--ui-landing-pane-width": `${width}px`,
  });
  return (
    <div className="ui-landing-pane" role="img" aria-label={label}>
      <div ref={ref} className="ui-landing-pane-fit" style={style}>
        <div className="ui-landing-pane-screen" inert>
          {children}
        </div>
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
