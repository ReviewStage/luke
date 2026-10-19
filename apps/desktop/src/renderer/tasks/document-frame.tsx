import { RelativeTime } from "@luke/panel/tasks/relative-time";
import { SCROLL_FADE, SCROLL_GUTTER, ScrollArea } from "@luke/ui";
import type { Actor } from "@luke/ui/actor-model";
import type { ReactNode } from "react";
import { ActorRef } from "../actor-ref";

/**
 * document-frame.tsx -- what every document of the window is drawn in, a plan's, a version's, and an issue's alike: the column it scrolls in, and the line under its title.
 *
 * A document scrolls in its own column, a `ScrollArea` with its edges
 * faded, its bar's room kept, and one block inside it (`.plan-document-body`):
 * its page's inset around it and the room for its last line under it, its
 * words selectable, and Luke's accent for its caret; its
 * body stands at the page's measure in the plan's type (`.plan-body` under
 * `.desktop-document`). Under its title one muted line says who created
 * it and when, then what its page says of its last edit, each phrase
 * wrapping whole (`.plan-byline`). Drawing every document through these,
 * rather than each page through a frame of its own, is what keeps a plan,
 * its versions, and an issue the same width, inset, and look.
 */

/** The class of the block a document stands in, inside its scrolling column. */
const DOCUMENT_BODY_CLASS = "plan-document-body";

/** The scrolling column a part of a document stands in; none outside one. */
export function documentScrollerOf(element: Element): HTMLElement | undefined {
  const body = element.closest(`.${DOCUMENT_BODY_CLASS}`);
  return body?.parentElement ?? undefined;
}

/** A document's own scrolling column, its edges faded, the block inside it at the page's inset. */
export function DocumentScroll({
  ref,
  children,
}: {
  ref?: React.Ref<HTMLDivElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ScrollArea ref={ref} fade={SCROLL_FADE.BOTH} gutter={SCROLL_GUTTER.STABLE}>
      <div className={DOCUMENT_BODY_CLASS}>{children}</div>
    </ScrollArea>
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
