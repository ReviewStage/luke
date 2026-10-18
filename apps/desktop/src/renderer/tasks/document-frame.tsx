import type { Actor } from "@luke/ui/actor-model";
import type { ReactNode } from "react";
import { ActorRef } from "../actor-ref";
import { RelativeTime } from "./relative-time";

/**
 * document-frame.tsx -- what every document of the window is drawn in, a plan's, a version's, and an issue's alike: the column it scrolls in, and the line under its title.
 *
 * A document scrolls in its own column (`.plan-document-scroll`): its
 * page's inset around it and the room for its last line under it, its
 * edges faded, its words selectable, and Luke's accent for its caret; its
 * body stands at the page's measure in the plan's type (`.plan-body` under
 * `.desktop-document`). Under its title one muted line says who created
 * it and when, then what its page says of its last edit, each phrase
 * wrapping whole (`.plan-byline`). Drawing every document through these,
 * rather than each page through a frame of its own, is what keeps a plan,
 * its versions, and an issue the same width, inset, and look.
 */

/** The class of a document's own scrolling column, which a part of it finds its scroller by. */
export const DOCUMENT_SCROLL_CLASS = "plan-document-scroll";

/** A document's own scrolling column, at the page's inset, its edges faded. */
export function DocumentScroll({
  ref,
  children,
}: {
  ref?: React.Ref<HTMLDivElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div ref={ref} className={`${DOCUMENT_SCROLL_CLASS} scroll-fade`}>
      {children}
    </div>
  );
}

/**
 * The line under a document's title: "Created by [Charles] Charles Pan ·
 * 3d ago", or "Created · 3d ago" where nobody is named, then `edited`, the
 * page's own phrase for its last edit, where it has one. The creator hangs
 * their card, and the time moves on with `now`.
 */
export function DocumentByline({
  creator,
  createdAt,
  now,
  edited,
}: {
  creator: Actor | undefined;
  createdAt: number;
  now: number;
  /** The phrase for the last edit, "Last edited by [Luke] Luke · 2h ago"; none where nothing changed since it was created. */
  edited?: ReactNode;
}): React.JSX.Element {
  return (
    <p className="plan-byline">
      <span className="actor-line">
        {creator === undefined ? "Created" : "Created by "}
        {creator === undefined ? null : <ActorRef actor={creator} sentence />}
        {" · "}
        <RelativeTime at={createdAt} now={now} ago />
      </span>
      {/* Note that the space between the phrases is read, not drawn: the line's gap draws it. */}
      {edited === undefined ? null : (
        <>
          {" "}
          <span className="actor-line plan-byline-edited">{edited}</span>
        </>
      )}
    </p>
  );
}
