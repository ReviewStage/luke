/**
 * heading-away.ts -- a document's name as its page's bar picks it up: the words its header's `h1` reads, and whether that heading has scrolled up out of view.
 *
 * A document is named once, in its page, by its header (`PageHeader`). Once
 * the reader scrolls past that header, the page's bar (`Toolbar`) shows the
 * same name, quietly, so it is never lost; once the heading is back, the
 * bar's copy goes. `DetailPage` and `SettingsPage` each watch their own
 * header this way, so a page wires nothing by hand.
 *
 * The name is read from the heading as it is drawn, its words a reader hears
 * (what is hidden from them, a face's initials, left out), so a title that is
 * more than words (a face beside a name) still hands the bar plain words, and
 * a placeholder title hands it none.
 */

import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

/** What a page's bar picks up from its header: the heading's words, and whether the heading has scrolled away. */
export type HeadingAway = {
  readonly name: string;
  readonly away: boolean;
};

/** The words `heading` reads to a reader: its text, less what is hidden from them, its spaces collapsed. */
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

/**
 * The name the `h1` inside `header` reads, and whether it has scrolled up out
 * of `root`'s view, as an intersection observer over `root` reports it. Note
 * that `root` is the box whose top edge the content scrolls under, which may
 * be the scroller itself or the box that holds it, because an observer clips
 * by every scroller between the heading and its root. A heading not yet
 * reported on, or with no observer to report on it, has not scrolled away.
 */
export function useHeadingAway(
  root: RefObject<HTMLElement | null>,
  header: RefObject<HTMLElement | null>,
): HeadingAway {
  const [name, setName] = useState("");
  const [away, setAway] = useState(false);
  // Note that the words are read after every draw, because a title renamed while it is away must reach the bar too; an unchanged name sets nothing.
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
