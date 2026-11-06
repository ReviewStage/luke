import { useCallback, useLayoutEffect, useRef, useState } from "react";

const DISCLOSURE_MOTION = {
  OPENING: "opening",
  CLOSING: "closing",
} as const;
export type DisclosureMotion = (typeof DISCLOSURE_MOTION)[keyof typeof DISCLOSURE_MOTION];

export interface Disclosure {
  readonly mounted: boolean;
  readonly leaving: boolean;
  readonly ref: (element: HTMLElement | null) => void;
}

export function disclosureMotion(opened: boolean, leaving: boolean): DisclosureMotion | undefined {
  if (leaving) return DISCLOSURE_MOTION.CLOSING;
  return opened ? DISCLOSURE_MOTION.OPENING : undefined;
}

export function runningMotions(element: HTMLElement): Animation[] {
  return "getAnimations" in element ? element.getAnimations() : [];
}

export function useDisclosure(open: boolean, onGone?: () => void): Disclosure {
  const [was, setWas] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const held = useRef<HTMLElement | null>(null);
  const gone = useRef(onGone);
  gone.current = onGone;
  const ref = useCallback((element: HTMLElement | null) => {
    held.current = element;
  }, []);
  if (open !== was) {
    setWas(open);
    setLeaving(!open);
  }

  useLayoutEffect(() => {
    if (!leaving) return undefined;
    const exits = held.current === null ? [] : runningMotions(held.current);
    const leave = () => {
      setLeaving(false);
      gone.current?.();
    };
    if (exits.length === 0) {
      leave();
      return undefined;
    }
    let current = true;
    const left = new Set(exits);
    for (const exit of exits) {
      const ended = () => {
        left.delete(exit);
        if (current && left.size === 0) leave();
      };
      exit.addEventListener("finish", ended, { once: true });
      exit.addEventListener("cancel", ended, { once: true });
    }
    return () => {
      current = false;
    };
  }, [leaving]);

  return { mounted: open || leaving, leaving, ref };
}
