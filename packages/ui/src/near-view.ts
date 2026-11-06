import { useCallback, useLayoutEffect, useState } from "react";

const NEAR_MARGIN = "100% 0px";

const SCROLLING: ReadonlySet<string> = new Set(["auto", "scroll", "overlay"]);

export interface NearView {
  readonly near: boolean;
  readonly height: number | undefined;
}

function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    if (SCROLLING.has(getComputedStyle(at).overflowY) && at.scrollHeight > at.clientHeight) {
      return at;
    }
  }
  return null;
}

function standsNear(box: DOMRect, root: HTMLElement | null): boolean {
  const shown = root?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  const room = shown.bottom - shown.top;
  return box.bottom >= shown.top - room && box.top <= shown.bottom + room;
}

export function useNearView(): [(element: HTMLElement | null) => void, NearView] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<NearView>(() => ({
    near: typeof IntersectionObserver === "undefined",
    height: undefined,
  }));
  useLayoutEffect(() => {
    if (element === null || typeof IntersectionObserver === "undefined") return undefined;
    const root = scrollerOf(element);
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
