import { SidebarIdentity, WingFace } from "@luke/ui";
import { useRef } from "react";
import { useFaceHover, useFaceMotion } from "../luke-face-mood.js";
import { useMotionHeld } from "../use-motion-held.js";

/**
 * Luke at the head of the sidebar: his face and his name. The head does not
 * say what Luke is doing; the face answers the pointer with its tricks. A
 * surface that is Luke's but not the app itself, the web's admin dashboard,
 * names itself under his name (`qualifier`), muted, so the head reads as the
 * app's and still says where the reader is.
 */
export function LukeIdentity({ qualifier }: { qualifier?: string | undefined }): React.JSX.Element {
  // The box the hover is read against, not the face itself: the drawing is
  // remounted for every play, and the hover has to survive the trick it fires.
  const faceElement = useRef<HTMLSpanElement>(null);
  const face = useFaceMotion(useMotionHeld(), useFaceHover(faceElement));
  return (
    <SidebarIdentity
      name="Luke"
      qualifier={qualifier}
      faceRef={faceElement}
      face={<WingFace key={face.play} motion={face.motion} fill />}
    />
  );
}
