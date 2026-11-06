import { type Ref, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import type { PageThumbFrame } from "../page-thumb/page-thumb.js";

export const PAGE_EMBED_HEIGHT = {
  STAND_IN: "stand-in",
  CONTENT: "content",
  FILL: "fill",
} as const;

export type PageEmbedHeight =
  | { readonly kind: typeof PAGE_EMBED_HEIGHT.STAND_IN }
  | { readonly kind: typeof PAGE_EMBED_HEIGHT.CONTENT; readonly height: number }
  | { readonly kind: typeof PAGE_EMBED_HEIGHT.FILL };

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

function useLoaded(src: string): { loaded: boolean; onLoaded: () => void } {
  const [loadedFrom, setLoadedFrom] = useState<string | undefined>(undefined);
  return { loaded: loadedFrom === src, onLoaded: () => setLoadedFrom(src) };
}

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

export function PageEmbed({
  frame,
  height,
  frameRef,
}: {
  frame: PageThumbFrame;
  height: PageEmbedHeight;
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
