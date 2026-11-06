import { type RefObject, useLayoutEffect, useRef, useState } from "react";

const UNTIL_FOUND = "until-found";

const BEFORE_MATCH = "beforematch";

export function useUntilFound<Element extends HTMLElement>(
  hiding: boolean,
  onFound: () => void,
): RefObject<Element | null> {
  const rest = useRef<Element | null>(null);
  const [found] = useState(() => ({ current: onFound }));
  found.current = onFound;
  useLayoutEffect(() => {
    const element = rest.current;
    if (element === null) return;
    if (!hiding) {
      element.removeAttribute("hidden");
      return;
    }
    element.setAttribute("hidden", UNTIL_FOUND);
    const open = () => found.current();
    element.addEventListener(BEFORE_MATCH, open);
    return () => element.removeEventListener(BEFORE_MATCH, open);
  }, [hiding, found]);
  return rest;
}
