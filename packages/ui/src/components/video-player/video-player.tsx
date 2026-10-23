import { CONVERSATION_MEDIA_TYPE } from "@luke/features/conversation-picture-wire";
import { useEffect, useRef, useState } from "react";
import { ExpandIcon } from "../../face/glyphs.js";
import { notePictureOrigin } from "../../picture-expand.js";
import { BUTTON_SIZE, BUTTON_VARIANT, IconButton } from "../button/button.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, Card } from "../card/card.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * video-player.tsx -- a video an agent recorded of what it did, played where a picture of it would be drawn, in its transcript, its inbox item, and its task's chat, and in the file viewer an Expand opens.
 *
 * Where a picture would be drawn, the video plays in place (`INLINE`), in a
 * frame that hugs it at its own shape up to its column's width, with the
 * browser's own controls, Full screen among them, so a press plays it rather
 * than enlarging it as a picture's does. A place that has a viewer to open
 * hands `onExpand`, and an Expand button stands in the frame's corner while
 * the pointer is over it or the keyboard is in it; a press pauses the video
 * here and opens the viewer, which grows from the frame as it grows from a
 * picture's tile. In the viewer (`VIEWER`) the video plays at once, as large
 * as the card lets it, and offers no Download, which the viewer's header has.
 *
 * The bytes arrive as a picture's do, as a `data:` URL the window's picture
 * reads hold (`picture-cache.ts`, the inbox's and the chat's own), and play
 * from a `blob:` address made of them here and let go of as the player goes,
 * because neither window's content policy lets media load from a `data:`
 * address, where both allow `blob:`. What holds the player keeps it out of
 * the screen recording, as it keeps a picture (`ph-no-capture`).
 */

/** What the player is named for a reader, its words after it. */
const VIDEO_LABEL = "Video";

/** What the corner's button is named, and its hint. */
const EXPAND_LABEL = "Expand";

/** Where a video plays: in place of a picture, or in the file viewer. */
export const VIDEO_PLAYER_PLACE = {
  INLINE: "inline",
  VIEWER: "viewer",
} as const;

export type VideoPlayerPlace = (typeof VIDEO_PLAYER_PLACE)[keyof typeof VIDEO_PLAYER_PLACE];

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

/** A video played in place of a picture or in the viewer, with the browser's own controls. */
export function VideoPlayer({
  dataUrl,
  label,
  size,
  place = VIDEO_PLAYER_PLACE.INLINE,
  onExpand,
}: {
  dataUrl: string;
  /** What the video shows, in words: its caption, its alt text, or its file's name; empty where it has none. */
  label: string;
  /** Its size in pixels, where the place drawing it knows it, so the frame holds its shape before its first frame. */
  size?: VideoSize | undefined;
  /** Where it plays, which sets how large it stands and whether it starts at once. */
  place?: VideoPlayerPlace | undefined;
  /** Opens the video in the viewer; without one, no Expand stands in its corner. */
  onExpand?: (() => void) | undefined;
}): React.JSX.Element {
  const url = useBlobUrl(dataUrl);
  const video = useRef<HTMLVideoElement>(null);
  const viewer = place === VIDEO_PLAYER_PLACE.VIEWER;
  const expand = () => {
    const shown = video.current;
    if (shown !== null) {
      shown.pause();
      notePictureOrigin(shown);
    }
    onExpand?.();
  };
  const player =
    url === undefined ? null : (
      // Note that the player carries no captions track, because an agent's recording of its screen has no sound.
      <video
        ref={video}
        className="luke-video-player-video"
        src={url}
        width={size?.width}
        height={size?.height}
        aria-label={label === "" ? VIDEO_LABEL : `${VIDEO_LABEL}: ${label}`}
        controls
        controlsList={viewer ? "nodownload" : undefined}
        autoPlay={viewer}
        muted
        playsInline
        preload={viewer ? "auto" : "metadata"}
      />
    );
  // In the viewer the card around it is the viewer's own.
  if (viewer)
    return (
      <span className="luke-video-player" data-place={place}>
        {player}
      </span>
    );
  return (
    <Card
      as={CARD_ELEMENT.SPAN}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      className="luke-video-player"
      data-place={place}
    >
      {player}
      {onExpand === undefined ? null : (
        <span className="luke-video-player-expand">
          <Tooltip label={EXPAND_LABEL}>
            <IconButton
              icon={<ExpandIcon />}
              label={EXPAND_LABEL}
              variant={BUTTON_VARIANT.INK}
              size={BUTTON_SIZE.COMPACT}
              onClick={expand}
            />
          </Tooltip>
        </span>
      )}
    </Card>
  );
}
