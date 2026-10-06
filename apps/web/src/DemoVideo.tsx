import { useEffect, useRef, useState } from "react";

/**
 * The hero: a recording of a real planning call, cut in Screen Studio. It
 * plays muted on a loop, as a browser only lets a page start a video, and
 * the sound button turns Luke's voice on. Under reduced motion it waits on
 * its first frame with the player's own controls.
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
  const [muted, setMuted] = useState(true);
  const [reduced, setReduced] = useState(false);

  // Note that the prerender has no window to ask about motion, so playback
  // starts after mount. `muted` is set on the element rather than as a prop,
  // because React writes the prop to the property alone and a browser reads
  // the attribute when it decides whether autoplay is allowed.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = true;
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      setReduced(true);
      return;
    }
    element.play().catch(() => setReduced(true));
  }, []);

  const toggleSound = () => {
    const element = video.current;
    if (!element) return;
    element.muted = !element.muted;
    setMuted(element.muted);
    if (!element.muted && element.paused) element.play().catch(() => undefined);
  };

  return (
    <div className="relative mx-[calc(50%-min(480px,50vw-16px))] mt-12">
      {/* biome-ignore lint/a11y/useMediaCaption: Luke's side of the call is captioned in the recording itself; a track for the developer's side waits on a transcript. */}
      <video
        ref={video}
        className="block h-auto w-full rounded-xl border border-border bg-black shadow-xl"
        src={DEMO.SOURCE}
        poster={DEMO.POSTER}
        width={DEMO.WIDTH}
        height={DEMO.HEIGHT}
        aria-label={DEMO_LABEL}
        controls={reduced}
        loop
        playsInline
        preload="auto"
      />
      {reduced ? null : (
        <button
          type="button"
          className="absolute right-3 bottom-3 rounded-md bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/85 motion-reduce:transition-none"
          onClick={toggleSound}
        >
          {muted ? "Turn sound on" : "Mute"}
        </button>
      )}
    </div>
  );
}
