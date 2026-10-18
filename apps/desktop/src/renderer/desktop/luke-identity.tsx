import { useFaceHover, useFaceMotion } from "@luke/panel/luke-face-mood";
import { usePrefersReducedMotion } from "@luke/panel/use-reduced-motion";
import { WingFace } from "@luke/ui";
import { useRef } from "react";

/** No one speaking: the head of the sidebar does not follow a call. */
const QUIET = { speaking: false, microphoneLive: false } as const;

/**
 * Luke at the head of the sidebar: his face and his name. A call is drawn by
 * its call bar on its own task and by the call card everywhere else, so the
 * head neither animates with the voice nor says what it is doing; the face
 * still answers the pointer with its tricks, which are Luke's and not the
 * call's.
 */
export function LukeIdentity(): React.JSX.Element {
  // The box the hover is read against, not the face itself: the drawing is
  // remounted for every play, and the hover has to survive the trick it fires.
  const faceElement = useRef<HTMLSpanElement>(null);
  const face = useFaceMotion(QUIET, usePrefersReducedMotion(), useFaceHover(faceElement));
  return (
    <div className="sidebar-identity">
      <span className="sidebar-identity-face" ref={faceElement}>
        <WingFace key={face.play} motion={face.motion} repeat={face.repeat} />
      </span>
      <span className="sidebar-identity-copy">
        <span className="sidebar-identity-name">Luke</span>
      </span>
    </div>
  );
}
