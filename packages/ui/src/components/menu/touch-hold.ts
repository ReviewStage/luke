/**
 * touch-hold.ts -- a touch held still on an element with a context menu opens that menu, as a long press does on a phone: `menu.tsx`'s `useMenu` uses it, and so does an app's hover hint over a control a tap presses.
 *
 * The one place in the menu that arms a raw timer, kept apart so the
 * repository's raw-timer allowlist (`tools/anti-slop/effect-edges.json`)
 * names this file rather than the whole menu. Only the first finger down
 * (`isPrimary`) counts toward a hold: a second finger, as a pinch's, starts
 * none and lets go of the first one's.
 */

import { useEffect, useRef, useState } from "react";

/**
 * How long a touch is held before it opens the menu a right-click would, in
 * milliseconds: the platforms' own long press. It is a gesture's threshold
 * rather than a motion, so it mirrors no motion token, which reduced motion
 * and capture runs zero; a hold zeroed would open the menu on every tap.
 */
const LONG_PRESS_MS = 500;
/** How far a held touch may drift, in CSS pixels, before it is a scroll or a drag rather than a long press. */
const LONG_PRESS_SLOP = 8;

/** A touch down on a context menu's element: the element, which pointer, where it went down, and the hold's timer while it still counts toward a long press. */
interface TouchPress {
  element: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  timer: number | undefined;
}

/** Where a held touch went down, in the window's CSS pixels, which the menu hangs from. */
export interface HeldPoint {
  readonly x: number;
  readonly y: number;
}

/** Whether a press on `target` went down in a control inside `carrier` that keeps its menu (`NO_CONTEXT_MENU`). */
function refusesMenu(target: EventTarget, carrier: HTMLElement): boolean {
  const zone = target instanceof Element ? target.closest("[data-no-context-menu]") : null;
  return zone !== null && zone !== carrier && carrier.contains(zone);
}

/**
 * A touch's long press on an element, a context menu's or a hint's; it
 * hands the point the touch went down at to `open` once the hold is done.
 *
 * Note that the touch is followed at the window's capture phase rather than
 * on the element, because a list or a tab strip that drags its rows
 * captures the pointer on itself once it moves, and the element would hear
 * neither the drag nor the release that should let the hold go. Such a
 * capture is a drag begun, which lets the hold go of itself, though the
 * finger then rests within the slop.
 */
export function useTouchHold() {
  const press = useRef<TouchPress | undefined>(undefined);
  // Whether the touch still down opened the menu by its hold.
  const held = useRef(false);
  // Note that the handlers are made once, so the window's listeners are the same ones to remove.
  const [touch] = useState(() => {
    const stopCounting = () => {
      const pending = press.current;
      if (pending === undefined) return;
      window.clearTimeout(pending.timer);
      pending.timer = undefined;
    };
    const letGo = () => {
      stopCounting();
      press.current = undefined;
      window.removeEventListener("pointermove", moved, true);
      window.removeEventListener("pointerup", ended, true);
      window.removeEventListener("pointercancel", ended, true);
      window.removeEventListener("scroll", stopCounting, true);
      window.removeEventListener("gotpointercapture", captured, true);
    };
    function moved(event: PointerEvent) {
      const pending = press.current;
      if (pending === undefined || event.pointerId !== pending.pointerId) return;
      const drift = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
      if (drift > LONG_PRESS_SLOP) stopCounting();
    }
    // Note that the touch's own capture, a browser's on what it went down on, is no drag.
    function captured(event: PointerEvent) {
      const pending = press.current;
      if (pending === undefined || event.pointerId !== pending.pointerId) return;
      if (event.target instanceof Node && pending.element.contains(event.target)) return;
      stopCounting();
    }
    // Note that a cancelled touch makes no touchend, so the hold is over with it.
    function ended(event: PointerEvent) {
      if (event.pointerId !== press.current?.pointerId) return;
      if (event.type === "pointercancel") held.current = false;
      letGo();
    }
    return {
      letGo,
      /** Whether a touch is down and still counting toward its long press. */
      counting: () => press.current?.timer !== undefined,
      /** The touch down opened the menu some other way, so its hold is spent. */
      claim: () => {
        stopCounting();
        held.current = true;
      },
      /** A press going down: a touch starts counting, toward `open` at the point it went down. */
      start: (event: React.PointerEvent<HTMLElement>, open: (point: HeldPoint) => void) => {
        letGo();
        held.current = false;
        if (event.pointerType !== "touch" || !event.isPrimary) return;
        if (refusesMenu(event.target, event.currentTarget)) return;
        const { currentTarget: element, pointerId, clientX: x, clientY: y } = event;
        const timer = window.setTimeout(() => {
          stopCounting();
          held.current = true;
          open({ x, y });
        }, LONG_PRESS_MS);
        press.current = { element, pointerId, x, y, timer };
        window.addEventListener("pointermove", moved, true);
        window.addEventListener("pointerup", ended, true);
        window.addEventListener("pointercancel", ended, true);
        window.addEventListener("scroll", stopCounting, true);
        window.addEventListener("gotpointercapture", captured, true);
      },
      // Note that a touch's end comes after its pointerup, and refusing it is
      // what keeps the browser from making a mousedown and a click of it.
      touchEnd: (event: React.TouchEvent<HTMLElement>) => {
        if (!held.current) return;
        held.current = false;
        event.preventDefault();
      },
    };
  });
  useEffect(() => touch.letGo, [touch]);
  return { ...touch, held };
}
