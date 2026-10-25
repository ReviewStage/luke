import { SidebarIdentity, WingFace } from "@luke/ui";
import { useRef } from "react";
import { useFaceHover, useFaceMotion } from "../luke-face-mood.js";
import { useMotionHeld } from "../use-motion-held.js";

/** No one speaking: the head of the sidebar does not follow a call. */
const QUIET = { speaking: false, microphoneLive: false } as const;

/**
 * Luke at the head of the sidebar: his face and his name. A call is drawn by
 * its call bar on its own task and by the call card everywhere else, so the
 * head neither animates with the voice nor says what it is doing; the face
 * still answers the pointer with its tricks, which are Luke's and not the
 * call's. A surface that is Luke's but not the app itself, the web's admin
 * dashboard, names itself under his name (`qualifier`), muted, so the head
 * reads as the app's and still says where the reader is.
 */
export function LukeIdentity({ qualifier }: { qualifier?: string | undefined }): React.JSX.Element {
  // The box the hover is read against, not the face itself: the drawing is
  // remounted for every play, and the hover has to survive the trick it fires.
  const faceElement = useRef<HTMLSpanElement>(null);
  const face = useFaceMotion(QUIET, useMotionHeld(), useFaceHover(faceElement));
  return (
    <SidebarIdentity
      name="Luke"
      qualifier={qualifier}
      faceRef={faceElement}
      face={<WingFace key={face.play} motion={face.motion} repeat={face.repeat} fill />}
    />
  );
}
