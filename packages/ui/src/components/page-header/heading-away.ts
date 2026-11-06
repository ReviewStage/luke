import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

export type HeadingAway = {
  readonly name: string;
  readonly away: boolean;
};

function headingWords(heading: Element): string {
  const walker = document.createTreeWalker(
    heading,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node instanceof Element && node.getAttribute("aria-hidden") === "true"
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    },
  );
  let words = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) words += node.textContent ?? "";
  }
  return words.replace(/\s+/gu, " ").trim();
}

export function useHeadingAway(
  root: RefObject<HTMLElement | null>,
  header: RefObject<HTMLElement | null>,
): HeadingAway {
  const [name, setName] = useState("");
  const [away, setAway] = useState(false);
  useLayoutEffect(() => {
    const heading = header.current?.querySelector("h1");
    setName(heading === null || heading === undefined ? "" : headingWords(heading));
  });
  useEffect(() => {
    const scroller = root.current;
    const heading = header.current?.querySelector("h1");
    if (scroller === null || heading === null || heading === undefined) return undefined;
    if (typeof IntersectionObserver === "undefined") return undefined;
    const seen = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry === undefined) return;
        const top = entry.rootBounds?.top ?? 0;
        setAway(!entry.isIntersecting && entry.boundingClientRect.bottom <= top);
      },
      { root: scroller },
    );
    seen.observe(heading);
    return () => seen.disconnect();
  }, [root, header]);
  return { name, away };
}
