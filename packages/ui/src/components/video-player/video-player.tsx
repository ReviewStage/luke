import { CONVERSATION_MEDIA_TYPE } from "@luke/features/conversation-picture-wire";
import { useEffect, useState } from "react";
import { PlayIcon } from "../../face/glyphs.js";

/**
 * video-player.tsx -- a video an agent recorded of what it did, drawn where a picture of it would be, and played in the file viewer it opens, as a picture is enlarged there.
 *
 * Where a picture would be drawn, in a transcript, an inbox item, or a
 * task's chat, a video is its still (`VideoStill`): its first frame, a play
 * mark over it, and how long it runs, which the place wraps in the same
 * press a picture's tile is (`PictureTile`), so a video opens as a picture
 * does. The viewer plays it (`VideoPlayer`) as large as the card lets it,
 * at once and muted, with the browser's own controls, Full screen among
 * them; the viewer's header has the one Download, so the controls offer none.
 *
 * The bytes arrive as a picture's do, as a `data:` URL the window's picture
 * reads hold (`picture-cache.ts`, the inbox's and the chat's own), and play
 * from a `blob:` address made of them here and let go of as the video goes,
 * because neither window's content policy lets media load from a `data:`
 * address, where both allow `blob:`. What holds either keeps it out of the
 * screen recording, as it keeps a picture (`ph-no-capture`).
 */

/** What a video is named for a reader, its words after it. */
const VIDEO_LABEL = "Video";

/** The seconds in a minute, for how long a video runs. */
const MINUTE_S = 60;

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

/** How long a video runs, as a player says it: minutes and two-digit seconds. */
function runningTime(seconds: number): string {
  const whole = Math.round(seconds);
  return `${String(Math.floor(whole / MINUTE_S))}:${String(whole % MINUTE_S).padStart(2, "0")}`;
}

/** What a reader is told a video is: its words after "Video", or "Video" alone. */
function videoLabel(label: string): string {
  return label === "" ? VIDEO_LABEL : `${VIDEO_LABEL}: ${label}`;
}

/**
 * The `blob:` address a video's `data:` URL plays from, made from its bytes
 * here and let go of as the video goes: neither window's policy lets media
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

/**
 * A video drawn where a picture would be: its first frame at its own shape,
 * a play mark over it, and how long it runs once its file says. Nothing
 * here plays; the place wraps it in the press that opens the viewer.
 */
export function VideoStill({
  dataUrl,
  label,
  fill = false,
}: {
  dataUrl: string;
  /** What the video shows, in words: its caption or its alt text; empty where it has none. */
  label: string;
  /** Whether it fills the frame its place gives it, as a set's tile does, rather than standing at its own size. */
  fill?: boolean | undefined;
}): React.JSX.Element {
  const url = useBlobUrl(dataUrl);
  const [seconds, setSeconds] = useState<number>();
  return (
    <span className="luke-video-still" data-fill={fill} role="img" aria-label={videoLabel(label)}>
      {url === undefined ? null : (
        // Note that the still carries no captions track, because an agent's recording of its screen has no sound.
        <video
          className="luke-video-still-video"
          src={url}
          aria-hidden="true"
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            if (Number.isFinite(duration)) setSeconds(duration);
          }}
        />
      )}
      <span className="luke-video-still-play" aria-hidden="true">
        <PlayIcon />
      </span>
      {seconds === undefined ? null : (
        <span className="luke-video-still-time" aria-hidden="true">
          {runningTime(seconds)}
        </span>
      )}
    </span>
  );
}

/**
 * A video played in the file viewer: as large as the card lets it at its
 * own shape, playing at once and muted, with the browser's own controls,
 * Full screen among them, and no Download, which the viewer's header has.
 */
export function VideoPlayer({
  dataUrl,
  label,
  size,
}: {
  dataUrl: string;
  /** What the video shows, in words: its caption, its alt text, or its file's name; empty where it has none. */
  label: string;
  /** Its size in pixels, where the place drawing it knows it. */
  size?: VideoSize | undefined;
}): React.JSX.Element | null {
  const url = useBlobUrl(dataUrl);
  if (url === undefined) return null;
  return (
    // Note that the player carries no captions track, because an agent's recording of its screen has no sound.
    <video
      className="luke-video-player"
      src={url}
      width={size?.width}
      height={size?.height}
      aria-label={videoLabel(label)}
      controls
      controlsList="nodownload"
      autoPlay
      muted
      playsInline
      preload="auto"
    />
  );
}
