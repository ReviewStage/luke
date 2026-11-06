import { type ReactNode, type Ref, useState } from "react";
import { AspectRatio } from "../../shadcn/aspect-ratio.js";
import { useBlobUrl } from "../video-player/video-player.js";

export const PAGE_THUMB_SIZE = {
  CARD: "card",
  ROW: "row",
} as const;

export type PageThumbSize = (typeof PAGE_THUMB_SIZE)[keyof typeof PAGE_THUMB_SIZE];

const THUMB_RATIO = 16 / 10;

const SIZE_CLASS: Record<PageThumbSize, string> = {
  [PAGE_THUMB_SIZE.CARD]: "block",
  [PAGE_THUMB_SIZE.ROW]: "inline-flex h-page-thumb-row items-center justify-center",
};

export interface PageThumbFrame {
  title: string;
  src: string;
  sandbox: string;
  lazy?: boolean | undefined;
}

function VideoStill({ dataUrl }: { dataUrl: string }): React.JSX.Element | null {
  const url = useBlobUrl(dataUrl);
  if (url === undefined) return null;
  return (
    <video
      className="ui-page-thumb-image pointer-events-none size-full object-cover"
      src={url}
      muted
      playsInline
      preload="metadata"
      tabIndex={-1}
      aria-hidden="true"
    />
  );
}

export function PageThumb({
  size = PAGE_THUMB_SIZE.CARD,
  frame,
  frameRef,
  image,
  video,
  glyph,
}: {
  size?: PageThumbSize;
  frame?: PageThumbFrame | undefined;
  frameRef?: Ref<HTMLIFrameElement> | undefined;
  image?: string | undefined;
  video?: string | undefined;
  glyph?: ReactNode;
}): React.JSX.Element {
  const [loadedFrom, setLoadedFrom] = useState<string | undefined>(undefined);
  return (
    <AspectRatio
      as="span"
      ratio={THUMB_RATIO}
      className={[
        "ui-page-thumb group/page-thumb flex-none overflow-hidden rounded-control border border-border bg-muted text-muted-foreground",
        SIZE_CLASS[size],
        glyph === undefined ? "" : "[&_svg]:size-control-icon",
        frame === undefined ? "" : "ph-no-capture",
      ]
        .filter((part) => part !== "")
        .join(" ")}
      data-size={size}
      data-loaded={String(frame !== undefined && loadedFrom === frame.src)}
      data-missing={glyph === undefined ? undefined : ""}
    >
      {image === undefined ? null : (
        <img
          className="ui-page-thumb-image size-full object-cover"
          src={image}
          alt=""
          draggable={false}
        />
      )}
      {video === undefined ? null : <VideoStill dataUrl={video} />}
      {frame === undefined ? null : (
        <iframe
          ref={frameRef}
          className="ui-page-thumb-frame pointer-events-none absolute top-0 left-0 h-[400%] w-[400%] origin-top-left scale-25 border-0 opacity-0 transition-opacity duration-(--ui-duration-hover) ease-motion-exit group-data-[loaded=true]/page-thumb:opacity-100"
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
    </AspectRatio>
  );
}
