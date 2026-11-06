import { useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 8;

interface TouchPress {
  element: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  timer: number | undefined;
}

export interface HeldPoint {
  readonly x: number;
  readonly y: number;
}

function refusesMenu(target: EventTarget, carrier: HTMLElement): boolean {
  const zone = target instanceof Element ? target.closest("[data-no-context-menu]") : null;
  return zone !== null && zone !== carrier && carrier.contains(zone);
}

export function useTouchHold() {
  const press = useRef<TouchPress | undefined>(undefined);
  const held = useRef(false);
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
    function captured(event: PointerEvent) {
      const pending = press.current;
      if (pending === undefined || event.pointerId !== pending.pointerId) return;
      if (event.target instanceof Node && pending.element.contains(event.target)) return;
      stopCounting();
    }
    function ended(event: PointerEvent) {
      if (event.pointerId !== press.current?.pointerId) return;
      if (event.type === "pointercancel") held.current = false;
      letGo();
    }
    return {
      letGo,
      counting: () => press.current?.timer !== undefined,
      claim: () => {
        stopCounting();
        held.current = true;
      },
      start: (
        event: React.PointerEvent<HTMLElement>,
        open: (point: HeldPoint) => void,
        counts: { readonly mouse?: boolean } = {},
      ) => {
        letGo();
        held.current = false;
        const mouseHeld =
          counts.mouse === true && event.pointerType === "mouse" && event.button === 0;
        if ((event.pointerType !== "touch" && !mouseHeld) || !event.isPrimary) return;
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
