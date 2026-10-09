import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reports an element's own height, for what only a measurement can say: the
 * caption's stack is as tall as its words wrapped.
 */
export function useMeasuredHeight(): [(element: HTMLElement | null) => void, number | undefined] {
  const observer = useRef<ResizeObserver | undefined>(undefined);
  const [height, setHeight] = useState<number>();

  // A callback ref rather than an effect: the measured element can mount
  // after the first render.
  const measured = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = undefined;
    if (!element) return;
    const measure = () => setHeight(Math.ceil(element.getBoundingClientRect().height));
    const nextObserver = new ResizeObserver(measure);
    // The border box, because that is the box the bounding rect reports: the
    // caption's room arrives as padding on the panel, which grows the shape
    // without ever touching the content box, and a content-box observer would
    // sleep through it — leaving the surface and the caption's rest position
    // sized to a height the panel no longer has.
    nextObserver.observe(element, { box: "border-box" });
    observer.current = nextObserver;
    measure();
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [measured, height];
}
