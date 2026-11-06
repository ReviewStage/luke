import { type ReactNode, useEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";

const SCREEN = {
  WINDOW: { WIDTH: 1280, HEIGHT: 800 },
  PHONE: { WIDTH: 393, HEIGHT: 852 },
} as const;

function useFit(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const box = ref.current;
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
