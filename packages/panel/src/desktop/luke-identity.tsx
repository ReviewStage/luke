import { PRODUCT_NAME } from "@luke/features/product-name";
import { SidebarIdentity, WingFace } from "@luke/ui";
import { useRef } from "react";
import { useFaceHover, useFaceMotion } from "../luke-face-mood.js";
import { useMotionHeld } from "../use-motion-held.js";

/**
 * The app at the head of the sidebar: its face and its name. The head does not
 * say what the app is doing; the face answers the pointer with its tricks. A
 * surface that is ours but not the app itself, the web's admin dashboard,
 * names itself under its name (`qualifier`), muted, so the head reads as the
 * app's and still says where the reader is.
 */
export function LukeIdentity({ qualifier }: { qualifier?: string | undefined }): React.JSX.Element {
  // The box the hover is read against, not the face itself: the drawing is
  // remounted for every play, and the hover has to survive the trick it fires.
  const faceElement = useRef<HTMLSpanElement>(null);
  const face = useFaceMotion(useMotionHeld(), useFaceHover(faceElement));
  return (
    <SidebarIdentity
      name={PRODUCT_NAME}
      qualifier={qualifier}
      faceRef={faceElement}
      face={<WingFace key={face.play} motion={face.motion} fill />}
    />
  );
}
