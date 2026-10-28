import { DIFF_INDICATORS, INLINE_DIFF } from "@luke/settings/diff-view";
import { cssCustomProperties } from "@luke/ui";
import { useEffect, useState } from "react";
import { LINE_HEIGHT_RATIO } from "../code-type.js";
import type { DiffLook } from "../diff-view/contract.js";
import {
  litSelection,
  pointedRange,
  type SnippetLines,
  snippetPatch,
  snippetRange,
} from "./code-snippet-model.js";
import { PierreDiff, useDiffLook } from "./file-diff.js";

/**
 * code-snippet.tsx -- a snippet of a file as Luke draws every line of one: Pierre's diff (`../diff-view/`) holding the snippet's lines as a hunk that changes nothing, numbered from where they sit in the file, the lines pointed at lit; an inbox item's code.
 *
 * The lines follow View settings as a File tab's and a diff's do: the
 * theme, the type, wrap and the numbers, drawn unified with no marks and no
 * tints, so the lines read as the file's own (`code-snippet-model.ts`). A
 * snippet is mounted as it comes near the view, a list of many cards
 * mounting only those read, and coloured off the window's thread in the
 * pool its diffs share (`pooled`), plain until the colours land.
 */

/** How far past the view a snippet is mounted, so it is drawn by the time it is scrolled to. */
const NEAR_VIEW_MARGIN = "800px 0px";

/**
 * Whether an element has come near the view, and the door it is handed
 * through; near once, it stays so. Where nothing observes the view, as
 * under a test's document, it is near at once.
 */
function useNearView(): [(element: HTMLElement | null) => void, boolean] {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (near || element === null) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: NEAR_VIEW_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, element]);
  return [setElement, near];
}

/** How a snippet is drawn: the File tabs' theme, type, wrap and numbers, unified, with nothing marked or tinted, since nothing in it changed. */
function useSnippetLook(): DiffLook {
  return {
    ...useDiffLook(false),
    indicators: DIFF_INDICATORS.NONE,
    inlineDiff: INLINE_DIFF.NONE,
    backgrounds: false,
  };
}

/**
 * A snippet's lines drawn by the diff bundle once near the view, those it
 * points at lit. Until it is near, and while the bundle loads, the place
 * stands empty at about the height the lines will take, so a list does not
 * jump as cards mount.
 */
export function CodeSnippet({ code }: { code: SnippetLines }): React.JSX.Element | null {
  const [place, near] = useNearView();
  const look = useSnippetLook();
  const patch = snippetPatch(code);
  const drawn = snippetRange(code);
  if (patch === undefined || drawn === undefined) return null;
  if (!near) {
    return (
      <div
        ref={place}
        className="h-snippet-pending"
        style={cssCustomProperties({
          "--snippet-rows": code.lines.length,
          "--snippet-row": `${Number(look.fontSize) * Number(LINE_HEIGHT_RATIO[look.lineHeight])}px`,
        })}
      />
    );
  }
  return (
    <PierreDiff
      patch={patch}
      look={look}
      selected={litSelection(pointedRange(code))}
      excerpt
      pooled
      className="diff-view code-snippet select-text"
    />
  );
}
