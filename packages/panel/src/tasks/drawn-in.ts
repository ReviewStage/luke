import { useLayoutEffect, useState } from "react";

export function drawnIn(view: Element | null, selector: string): boolean {
  const element = view?.querySelector(selector);
  return element !== null && element !== undefined && getComputedStyle(element).display !== "none";
}

export function useFloatsOver(view: Element | null, over: string, beside: string): boolean {
  const [floats, setFloats] = useState(false);
  useLayoutEffect(() => {
    if (view === null) return undefined;
    const read = () => setFloats(drawnIn(view, over) && !drawnIn(view, beside));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(view);
    return () => observer.disconnect();
  }, [view, over, beside]);
  return floats;
}
