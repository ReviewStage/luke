import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { MOTION_TOKEN, tokenTiming } from "../../motion-timing.js";
import { ANNOUNCE, Announcer, useAnnounce } from "../announcer/announcer.js";

const STILL = 0.5;

function useStackGlide(): RefObject<HTMLOListElement | null> {
  const list = useRef<HTMLOListElement>(null);
  const drawn = useRef(new Map<Element, number>());
  useLayoutEffect(() => {
    const root = list.current;
    if (root === null) return;
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

export function ToastStack({
  label,
  polite,
  alert,
  children,
}: {
  label: string;
  polite: string;
  alert: string;
  children: ReactNode;
}): React.JSX.Element {
  const list = useStackGlide();
  useAnnounce(ANNOUNCE.POLITE, polite);
  useAnnounce(ANNOUNCE.ALERT, alert);
  return (
    <>
      <section className="ui-toast-stack pointer-events-none fixed z-toast" aria-label={label}>
        <ol ref={list} className="m-0 flex list-none flex-col gap-toast-gap p-0">
          {children}
        </ol>
      </section>
      <Announcer />
    </>
  );
}
