import { type ReactNode, useState } from "react";

/**
 * page-thumb.tsx -- a small, inert preview of a page or a picture in a frame of a page's shape.
 *
 * A thumb is a box of a window's shape (16 by 10), its corners a control's,
 * in a hairline over a quiet ground that holds its place until what it shows
 * has landed. A page (`frame`) is laid out four times the thumb's width, a
 * desktop window's, and scaled down by as much, fading in once loaded; the
 * frame takes no pointer, no focus, and no part in what is read aloud, and is
 * left out of the screen recording. A picture (`image`) fills it, and a
 * `glyph` stands in the middle where what it showed is gone. A thumb with
 * none of the three is the ground alone. What loaded is kept by its address,
 * so a newer version's frame holds its place again until it loads.
 *
 * It comes as a card's preview, as wide as its container, or as a row's
 * tile, a line of media tall. It takes no class or style: its outer layout
 * is its container's.
 */

/** How big a thumb is: as wide as the card it stands in, or a row's small tile. */
export const PAGE_THUMB_SIZE = {
  CARD: "card",
  ROW: "row",
} as const;

export type PageThumbSize = (typeof PAGE_THUMB_SIZE)[keyof typeof PAGE_THUMB_SIZE];

/** A page drawn small: its address, the sandbox it runs under, and the title it is named by for tooling. */
export interface PageThumbFrame {
  title: string;
  src: string;
  sandbox: string;
  /** Whether the frame loads only once it is near the screen. */
  lazy?: boolean | undefined;
}

/** A page or a picture, small and inert. */
export function PageThumb({
  size = PAGE_THUMB_SIZE.CARD,
  frame,
  image,
  glyph,
}: {
  size?: PageThumbSize;
  /** A page to draw small. */
  frame?: PageThumbFrame | undefined;
  /** A picture's address, to fill the thumb. */
  image?: string | undefined;
  /** A glyph standing in the middle where what the thumb showed is gone. */
  glyph?: ReactNode;
}): React.JSX.Element {
  const [loadedFrom, setLoadedFrom] = useState<string | undefined>(undefined);
  return (
    <span
      className={frame === undefined ? "luke-page-thumb" : "luke-page-thumb ph-no-capture"}
      data-size={size}
      data-loaded={String(frame !== undefined && loadedFrom === frame.src)}
      data-missing={glyph === undefined ? undefined : ""}
    >
      {image === undefined ? null : (
        <img className="luke-page-thumb-image" src={image} alt="" draggable={false} />
      )}
      {frame === undefined ? null : (
        <iframe
          className="luke-page-thumb-frame"
          title={frame.title}
          src={frame.src}
          sandbox={frame.sandbox}
          allow=""
          referrerPolicy="no-referrer"
          loading={frame.lazy === true ? "lazy" : undefined}
          tabIndex={-1}
          aria-hidden="true"
          onLoad={() => setLoadedFrom(frame.src)}
        />
      )}
      {glyph}
    </span>
  );
}
