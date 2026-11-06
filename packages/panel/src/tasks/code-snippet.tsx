import { DIFF_INDICATORS, INLINE_DIFF } from "@repo/settings/diff-view";
import { cssCustomProperties } from "@repo/ui";
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

const NEAR_VIEW_MARGIN = "800px 0px";

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

function useSnippetLook(): DiffLook {
  return {
    ...useDiffLook(false),
    indicators: DIFF_INDICATORS.NONE,
    inlineDiff: INLINE_DIFF.NONE,
    backgrounds: false,
  };
}

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
