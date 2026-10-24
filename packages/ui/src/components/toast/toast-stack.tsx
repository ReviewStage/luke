import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { MOTION_TOKEN, tokenTiming } from "../../motion-timing.js";
import { ANNOUNCE, Announcer, useAnnounce } from "../announcer/announcer.js";
import { TOAST_LOOK, type ToastLook } from "./toast.js";

/**
 * toast-stack.tsx -- the toasts standing, in the window's bottom-right corner, and the window's `Announcer` that says them.
 *
 * The stack is a landmark over whatever docks at the window's foot, taking no
 * pointer itself, so only a toast with something to press stands in the way
 * of what is under it. Each toast a change moves glides from where it was
 * drawn to where it now stands, on the spring small elements ride, read from
 * the tokens at the stack so reduced motion and a capture run play nothing.
 *
 * What each toast says reaches assistive tech through the window's one pair
 * of live regions, the `Announcer` the stack mounts beside it, since the
 * host mounts the stack with the window rather than with any toast: what was
 * done or is asked politely, and what was refused as an alert, each said
 * once the words the host hands it change. Where the stack mounts (a portal
 * to the body, say) is the host's.
 *
 * In the compact look, for a window too small for the card (the floating call
 * window), the stack spans the window's foot a step in from each side
 * rather than standing in its corner, and its toasts are drawn compact.
 */

/** Less than this, in CSS pixels, is not a move worth playing. */
const STILL = 0.5;

/** Glides each toast a change moved from where it was drawn to where it now stands. */
function useStackGlide(): RefObject<HTMLOListElement | null> {
  const list = useRef<HTMLOListElement>(null);
  const drawn = useRef(new Map<Element, number>());
  useLayoutEffect(() => {
    const root = list.current;
    if (root === null) return;
    // Note that an empty stack, as it stands nearly always, reads nothing: reading the tokens or a box lays out the whole window, and the stack is drawn again with everything around it.
    if (root.children.length === 0) {
      if (drawn.current.size > 0) drawn.current = new Map();
      return;
    }
    const timing = tokenTiming(root, MOTION_TOKEN.DURATION_FAST, MOTION_TOKEN.SPRING_FAST);
    const next = new Map<Element, number>();
    for (const toast of root.children) {
      const top = toast.getBoundingClientRect().top;
      const was = drawn.current.get(toast);
      next.set(toast, top);
      if (was === undefined || Math.abs(was - top) < STILL || timing === undefined) continue;
      toast.animate([{ transform: `translateY(${was - top}px)` }, { transform: "none" }], timing);
    }
    drawn.current = next;
  });
  return list;
}

/** The stack, named as a landmark, its toasts oldest first, and the window's `Announcer`, told what the newest toasts say. */
export function ToastStack({
  label,
  polite,
  alert,
  look = TOAST_LOOK.CARD,
  children,
}: {
  /** What the stack is called, as a landmark among the window's regions. */
  label: string;
  /** What the polite region says: what was done or is asked, or nothing. */
  polite: string;
  /** What the alert region says: what was refused, or nothing. */
  alert: string;
  /** Where it stands: the window's corner for cards, or across its foot for lines, its toasts drawn in the same look. */
  look?: ToastLook;
  /** The toasts, each a `Toast`, oldest first. */
  children: ReactNode;
}): React.JSX.Element {
  const list = useStackGlide();
  useAnnounce(ANNOUNCE.POLITE, polite);
  useAnnounce(ANNOUNCE.ALERT, alert);
  return (
    <>
      <section
        className="luke-toast-stack pointer-events-none fixed z-toast"
        data-look={look}
        aria-label={label}
      >
        <ol ref={list} className="m-0 flex list-none flex-col gap-toast-gap p-0">
          {children}
        </ol>
      </section>
      <Announcer />
    </>
  );
}
