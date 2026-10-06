import { useEffect, useRef } from "react";

/**
 * The hero: a recording of a real planning call, cut in Screen Studio. It
 * starts muted, as a browser only lets a page start a video that way, and
 * the player's own controls pause it, scrub it, and turn the sound on.
 * Under reduced motion it waits on its first frame for a press of play.
 */

const DEMO = {
  SOURCE: "/luke-demo.mp4",
  POSTER: "/luke-demo-poster.jpg",
  WIDTH: 1240,
  HEIGHT: 864,
} as const;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const DEMO_LABEL =
  "A one-minute recording of a planning call: Luke asks about a budgeting feature while the plan fills in beside him.";

export function DemoVideo(): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null);

  // Note that the prerender has no window to ask about motion, so playback
  // starts after mount. `muted` is set on the element rather than as a prop,
  // because React writes the prop to the property alone and a browser reads
  // the attribute when it decides whether autoplay is allowed.
  useEffect(() => {
    const element = video.current;
    if (!element || window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
    element.muted = true;
    element.play().catch(() => undefined);
  }, []);

  return (
    <div className="mx-[calc(50%-min(480px,50vw-16px))] mt-12">
      {/* biome-ignore lint/a11y/useMediaCaption: Luke's side of the call is captioned in the recording itself; a track for the developer's side waits on a transcript. */}
      <video
        ref={video}
        className="block h-auto w-full rounded-xl border border-border bg-black shadow-xl"
        src={DEMO.SOURCE}
        poster={DEMO.POSTER}
        width={DEMO.WIDTH}
        height={DEMO.HEIGHT}
        aria-label={DEMO_LABEL}
        controls
        loop
        playsInline
        preload="auto"
      />
    </div>
  );
}
