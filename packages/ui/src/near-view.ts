import { useCallback, useLayoutEffect, useState } from "react";

/**
 * near-view.ts -- whether an element stands near the screen in the column that scrolls it, and how tall it stood as it went away.
 *
 * A long column of heavy things, an Inbox thread's pictures and videos say,
 * draws each only while it stands within a screenful of what is shown, and a
 * box as tall as it last stood everywhere else, so what a phone holds at once
 * is a few screens' worth however long the thread runs, and the column never
 * moves under the reader as they come and go. Near is measured against the
 * column that scrolls the element, the nearest scrolling ancestor, or the
 * window where there is none, because an observer's margin widens only its
 * root, and a scrolling ancestor between them would clip the element at its
 * own edge. It is read once as the element is placed, before the window
 * paints, so a thing drawn again where it already stood never blinks out, and
 * then followed as the column scrolls. Where nothing observes the view, as
 * under a test's document, everything is near.
 */

/** How far past what is shown, above and below, a thing counts as near: a screenful of its column. */
const NEAR_MARGIN = "100% 0px";

/** The overflow values under which an element scrolls what it holds. */
const SCROLLING: ReadonlySet<string> = new Set(["auto", "scroll", "overlay"]);

/** Where an element stands: near the screen or not, and how tall it stood as it last went away, none before it has. */
export interface NearView {
  readonly near: boolean;
  readonly height: number | undefined;
}

/**
 * The nearest ancestor that scrolls `element` up and down, none where the
 * window does. Note that it must hold more than it shows, because a row
 * that scrolls sideways computes as scrolling up and down too, and would
 * stand near whatever the column showed.
 */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    if (SCROLLING.has(getComputedStyle(at).overflowY) && at.scrollHeight > at.clientHeight) {
      return at;
    }
  }
  return null;
}

/** Whether `box` stands within a screenful of the column `root` shows, the window's where it is none. */
function standsNear(box: DOMRect, root: HTMLElement | null): boolean {
  const shown = root?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  const room = shown.bottom - shown.top;
  return box.bottom >= shown.top - room && box.top <= shown.bottom + room;
}

/**
 * Whether the element handed through the returned door stands near the
 * screen, and its height as it last went away. Note that the door may be
 * handed a new element, the thing itself near and the box standing in for it
 * away, and each is followed in its turn.
 */
export function useNearView(): [(element: HTMLElement | null) => void, NearView] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<NearView>(() => ({
    near: typeof IntersectionObserver === "undefined",
    height: undefined,
  }));
  useLayoutEffect(() => {
    if (element === null || typeof IntersectionObserver === "undefined") return undefined;
    const root = scrollerOf(element);
    // A thing going away is held at the height it stood; one coming near keeps the height it had.
    const follow = (near: boolean, box: DOMRectReadOnly) =>
      setView((now) =>
        now.near === near ? now : { near, height: near ? now.height : box.height },
      );
    follow(standsNear(element.getBoundingClientRect(), root), element.getBoundingClientRect());
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry !== undefined) follow(entry.isIntersecting, entry.boundingClientRect);
      },
      { root, rootMargin: NEAR_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const place = useCallback((next: HTMLElement | null) => setElement(next), []);
  return [place, view];
}
