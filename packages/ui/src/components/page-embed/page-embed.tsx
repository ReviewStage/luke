import { type Ref, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import type { PageThumbFrame } from "../page-thumb/page-thumb.js";

/**
 * page-embed.tsx -- a page drawn in written words: the whole page, live, in a frame as wide as the words and as tall as the page, up to a screenful.
 *
 * Where an agent shows a page, the page stands in the words that tell of it,
 * a transcript's or an Inbox thread's, rather than only behind a chip. It is
 * a card's corners and hairline around the page's own frame, sandboxed as the
 * caller says, which the page may be read and pressed in as in its tab.
 *
 * Its height is the caller's to hand, as the page reports it: until it does,
 * the frame stands at a stand-in's height, and once it has, at the page's,
 * up to a screenful, past which the page scrolls inside it. Until the page
 * has loaded the frame is hidden over a quiet ground, because the blank
 * document it loads through is light only and would flash in a dark window.
 * The frame loads only once it nears the screen where the caller asks, so a
 * long transcript loads the pages it is read past, not every page it holds.
 * What the page draws is the task's, so the frame is left out of the screen
 * recording.
 */

/** A page drawn in words, live, as tall as `height` says, up to a screenful. */
export function PageEmbed({
  frame,
  height,
  frameRef,
}: {
  /** The page: its address, the sandbox it runs under, its title for tooling, and whether it loads lazily. */
  frame: PageThumbFrame;
  /** The page's height in CSS pixels, as it reported it; none until it has. */
  height: number | undefined;
  /** The frame itself, which the caller hears the page's messages from. */
  frameRef?: Ref<HTMLIFrameElement> | undefined;
}): React.JSX.Element {
  const [loadedFrom, setLoadedFrom] = useState<string | undefined>(undefined);
  const loaded = loadedFrom === frame.src;
  return (
    <div
      className="ui-page-embed ph-no-capture group/page-embed overflow-hidden rounded-card border border-border bg-muted"
      data-loaded={String(loaded)}
    >
      <iframe
        ref={frameRef}
        className={[
          "ui-page-embed-frame block w-full border-0 opacity-0 transition-opacity duration-(--ui-duration-hover) ease-motion-exit group-data-[loaded=true]/page-embed:opacity-100",
          height === undefined ? "h-page-embed-stand-in" : "h-page-embed",
        ].join(" ")}
        style={
          height === undefined
            ? undefined
            : cssCustomProperties({ "--page-embed-height": `${height}px` })
        }
        title={frame.title}
        src={frame.src}
        sandbox={frame.sandbox}
        allow=""
        referrerPolicy="no-referrer"
        loading={frame.lazy === true ? "lazy" : undefined}
        onLoad={() => setLoadedFrom(frame.src)}
      />
    </div>
  );
}
