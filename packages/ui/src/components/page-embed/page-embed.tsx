import { type Ref, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import type { PageThumbFrame } from "../page-thumb/page-thumb.js";

/**
 * page-embed.tsx -- a page drawn in written words: the whole page, live, in a frame as wide as the words and as tall as the page, with no card around it.
 *
 * Where an agent shows a page, the page stands in the words that tell of it,
 * a transcript's or an Inbox thread's, rather than only behind a chip. It is
 * drawn on the words' own ground, as a picture is, with no border or fill of
 * ours around it and its corners square, so a page that leaves its root
 * clear reads as part of the words and one that paints its own ground
 * stands as a block flush with them. It is sandboxed as the caller says, and
 * may be read and pressed in as in its tab.
 *
 * Its height is the caller's to hand, as the page reports it: until it does,
 * the frame stands at a stand-in's height; once it has, at the page's whole
 * height, so the page is scrolled with the words rather than inside a box of
 * its own; and at a screenful where the page fills whatever frame holds it
 * (`@repo/features/page-size`'s `pageFitAfter`), since such a page has no
 * height of its own to stand at. The frame never scrolls itself, because
 * where scroll bars always show, one drawn while the page overflowed its
 * stand-in narrows the page, which then reports the height it has at that
 * narrower width and keeps the bar for good; a page past the runaway's bound
 * is read whole in its tab. Until the page has loaded the frame is
 * hidden over a quiet ground, because the blank document it loads through is
 * light only and would flash in a dark window. The frame loads only once it
 * nears the screen where the caller asks, so a long transcript loads the
 * pages it is read past, not every page it holds. What the page draws is the
 * task's, so the frame is left out of the screen recording.
 *
 * It draws no controls of its own. The row each caller draws above it opens
 * the page in its tab, and the tab fills the window from the panel's own
 * Expand panel, so a corner over the page would only cover its words with a
 * second way to the same place.
 */

/** How the frame stands: before the page says, as tall as it says, or a screenful for a page that fills its frame. */
export const PAGE_EMBED_HEIGHT = {
  STAND_IN: "stand-in",
  CONTENT: "content",
  FILL: "fill",
} as const;

export type PageEmbedHeight =
  | { readonly kind: typeof PAGE_EMBED_HEIGHT.STAND_IN }
  | { readonly kind: typeof PAGE_EMBED_HEIGHT.CONTENT; readonly height: number }
  | { readonly kind: typeof PAGE_EMBED_HEIGHT.FILL };

/** The frame's class and style for how it stands. */
function frameSize(height: PageEmbedHeight): {
  className: string;
  style: React.CSSProperties | undefined;
} {
  if (height.kind === PAGE_EMBED_HEIGHT.CONTENT) {
    return {
      className: "h-page-embed",
      style: cssCustomProperties({ "--page-embed-height": `${height.height}px` }),
    };
  }
  return {
    className:
      height.kind === PAGE_EMBED_HEIGHT.FILL ? "h-page-embed-fill" : "h-page-embed-stand-in",
    style: undefined,
  };
}

/** Whether the frame has loaded the page it names now, and the load to hand it. */
function useLoaded(src: string): { loaded: boolean; onLoaded: () => void } {
  const [loadedFrom, setLoadedFrom] = useState<string | undefined>(undefined);
  return { loaded: loadedFrom === src, onLoaded: () => setLoadedFrom(src) };
}

/** The page's own frame, hidden until it has loaded. */
function LiveFrame({
  frame,
  frameRef,
  loaded,
  onLoaded,
  className,
  style,
}: {
  frame: PageThumbFrame;
  frameRef?: Ref<HTMLIFrameElement> | undefined;
  loaded: boolean;
  onLoaded: () => void;
  className: string;
  style?: React.CSSProperties | undefined;
}): React.JSX.Element {
  return (
    <iframe
      ref={frameRef}
      className={[
        "ui-page-embed-frame block w-full border-0 transition-opacity duration-(--ui-duration-hover) ease-motion-exit",
        loaded ? "opacity-100" : "opacity-0",
        className,
      ].join(" ")}
      style={style}
      title={frame.title}
      src={frame.src}
      sandbox={frame.sandbox}
      allow=""
      referrerPolicy="no-referrer"
      loading={frame.lazy === true ? "lazy" : undefined}
      scrolling="no"
      onLoad={onLoaded}
    />
  );
}

/** A page drawn in words, live, as tall as `height` says. */
export function PageEmbed({
  frame,
  height,
  frameRef,
}: {
  /** The page: its address, the sandbox it runs under, its title for tooling, and whether it loads lazily. */
  frame: PageThumbFrame;
  /** How tall the frame stands, as the page reported. */
  height: PageEmbedHeight;
  /** The frame itself, which the caller hears the page's messages from. */
  frameRef?: Ref<HTMLIFrameElement> | undefined;
}): React.JSX.Element {
  const size = frameSize(height);
  const load = useLoaded(frame.src);
  return (
    <div
      className="ui-page-embed ph-no-capture bg-muted data-[loaded=true]:bg-transparent"
      data-loaded={String(load.loaded)}
    >
      <LiveFrame
        frame={frame}
        frameRef={frameRef}
        {...load}
        className={size.className}
        style={size.style}
      />
    </div>
  );
}
