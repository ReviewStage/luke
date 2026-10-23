import { CONVERSATION_MEDIA_TYPE } from "@luke/features/conversation-picture-wire";
import { useEffect, useState } from "react";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, Card } from "../card/card.js";

/**
 * video-player.tsx -- a video an agent recorded of what it did, played where a picture of it would be drawn: in its transcript, its inbox item, and its task's chat.
 *
 * The bytes arrive as a picture's do, as a `data:` URL the window's picture
 * reads hold (`picture-cache.ts`, the inbox's and the chat's own), and play
 * from a `blob:` address made of them here and let go of as the player
 * goes, because neither window's content policy lets media load from a
 * `data:` address, where both allow `blob:`. The frame hugs the video at
 * its own shape up to its column's width, on black while its first frame
 * loads; a place that knows the video's size hands it (`size`), so the
 * frame holds the video's place before its first frame, and one that does
 * not lets the video size itself. The player is the browser's own, with its
 * controls, muted, since an agent's recording of its screen has no sound.
 * What holds the player keeps it out of the screen recording, as it keeps
 * a picture (`ph-no-capture`).
 */

/** What the player is named for a reader, its words after it. */
const VIDEO_LABEL = "Video";

/** A video's size in pixels, as its file states it. */
export interface VideoSize {
  readonly width: number;
  readonly height: number;
}

/** The media type a `data:` URL names, as the picture reads spell one. */
export function dataUrlMediaType(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";"));
}

/** Whether a `data:` URL a picture read answered holds a video, played rather than drawn. */
export function isVideoDataUrl(dataUrl: string): boolean {
  return dataUrlMediaType(dataUrl) === CONVERSATION_MEDIA_TYPE.WEBM;
}

/**
 * The `blob:` address a video's `data:` URL plays from, made from its bytes
 * here and let go of as the player goes: neither window's policy lets media
 * load from a `data:` address, nor fetch one, where both allow `blob:`.
 */
function useBlobUrl(dataUrl: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const made = URL.createObjectURL(new Blob([bytes], { type: dataUrlMediaType(dataUrl) }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [dataUrl]);
  return url;
}

/** A video's player once its bytes are in: at its own shape up to the column's, with the player's own controls. */
export function VideoPlayer({
  dataUrl,
  label,
  size,
}: {
  dataUrl: string;
  /** What the video shows, in words: its caption or its alt text; empty where it has none. */
  label: string;
  /** Its size in pixels, where the place drawing it knows it. */
  size?: VideoSize | undefined;
}): React.JSX.Element {
  const url = useBlobUrl(dataUrl);
  return (
    <Card
      as={CARD_ELEMENT.SPAN}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      className="luke-video-player"
      style={
        size === undefined
          ? undefined
          : { aspectRatio: `${String(size.width)} / ${String(size.height)}` }
      }
    >
      {url === undefined ? null : (
        // Note that the player carries no captions track, because an agent's recording of its screen has no sound.
        <video
          className="luke-video-player-video"
          src={url}
          width={size?.width}
          height={size?.height}
          aria-label={label === "" ? VIDEO_LABEL : `${VIDEO_LABEL}: ${label}`}
          controls
          muted
          playsInline
          preload="metadata"
        />
      )}
    </Card>
  );
}
