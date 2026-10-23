import { CONVERSATION_MEDIA_TYPE } from "@luke/features/conversation-picture-wire";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  ExitFullScreenIcon,
  ExpandIcon,
  FullScreenIcon,
  PauseIcon,
  PlayIcon,
} from "../../face/glyphs.js";
import { notePictureOrigin } from "../../picture-expand.js";
import { BUTTON_VARIANT, IconButton } from "../button/button.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, Card } from "../card/card.js";
import { SLIDER_LENGTH, Slider } from "../slider/slider.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * video-player.tsx -- a video an agent recorded of what it did, played where a picture of it would be drawn, in its transcript, its inbox item, and its task's chat, and in the file viewer an Expand opens.
 *
 * The player is Luke's own rather than the browser's: a bar along the
 * video's foot of the same icon buttons, glyphs, and slider the window draws
 * everywhere, with play and pause, how far it has run of how long, a
 * scrubber, Expand where the place has a viewer to open, and Full screen. A
 * press on the video itself plays or pauses it, and while focus is in the
 * player, Space or K does too and the left and right arrows seek five
 * seconds, kept from the place around it, such as the viewer whose arrows
 * walk its files; a button's own Space presses the button. The bar stands while the
 * video is paused and, with a pointer, fades while it plays until the
 * pointer or the keyboard is in it; on a touch screen it always stands. Full
 * screen fills the screen with the frame, the bar with it, and Escape or its
 * button brings it back. There is no volume, since an agent's recording of
 * its screen has no sound, and no Download, which the viewer's header has.
 *
 * Where a picture would be drawn, the video plays in place (`INLINE`), in a
 * frame that hugs it at its own shape up to its column's width. A place that
 * has a viewer to open hands `onExpand`: Expand pauses the video here and
 * opens the viewer, which grows from the frame as it grows from a picture's
 * tile. In the viewer (`VIEWER`) the video plays at once, as large as the
 * card lets it.
 *
 * The bytes arrive as a picture's do, as a `data:` URL the window's picture
 * reads hold (`picture-cache.ts`, the inbox's and the chat's own), and play
 * from a `blob:` address made of them here and let go of as the player goes,
 * because neither window's content policy lets media load from a `data:`
 * address, where both allow `blob:`. What holds the player keeps it out of
 * the screen recording, as it keeps a picture (`ph-no-capture`).
 */

/** What the player and its controls are named for a reader. */
const VIDEO_LABEL = {
  VIDEO: "Video",
  PLAYER: "Video player",
  PLAY: "Play",
  PAUSE: "Pause",
  SEEK: "Seek",
  EXPAND: "Expand",
  FULL_SCREEN: "Full screen",
  EXIT_FULL_SCREEN: "Exit full screen",
} as const;

/** The seconds in a minute, for how far a video has run. */
const MINUTE_S = 60;

/** How finely the scrubber moves, in seconds. */
const SEEK_STEP_S = 0.1;

/** How far an arrow key seeks, in seconds. */
const ARROW_SEEK_S = 5;

/** The keys that play or pause the player while focus is in it. */
const TOGGLE_KEYS: ReadonlySet<string> = new Set([" ", "k", "K"]);

/** How far each arrow seeks, in seconds, while focus is in the player. */
const SEEK_KEYS: ReadonlyMap<string, number> = new Map([
  ["ArrowLeft", -ARROW_SEEK_S],
  ["ArrowRight", ARROW_SEEK_S],
]);

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

/** Where a video stands in its run, as the bar draws it. */
interface Playback {
  readonly playing: boolean;
  readonly at: number;
  readonly duration: number;
}

/** The media type a `data:` URL names, as the picture reads spell one. */
export function dataUrlMediaType(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";"));
}

/** Whether a `data:` URL a picture read answered holds a video, played rather than drawn. */
export function isVideoDataUrl(dataUrl: string): boolean {
  return dataUrlMediaType(dataUrl) === CONVERSATION_MEDIA_TYPE.WEBM;
}

/** How far a video has run, as a player says it: minutes and two-digit seconds. */
function runningTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / MINUTE_S))}:${String(whole % MINUTE_S).padStart(2, "0")}`;
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

/**
 * Whether `frame` fills the screen, and the press that toggles it. Note that
 * the frame is what fills it, not the video, so the bar comes with it.
 */
function useFullScreen(frame: RefObject<HTMLElement | null>): [boolean, () => void] {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const follow = () => setFull(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", follow);
    return () => document.removeEventListener("fullscreenchange", follow);
  }, [frame]);
  const toggle = () => {
    if (document.fullscreenElement === frame.current) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    frame.current?.requestFullscreen().catch(() => undefined);
  };
  return [full, toggle];
}

/**
 * Asks a video whose file states no length for it, once its metadata is in.
 * Note that a WebM a recorder wrote as it went states none, which the
 * browser reports as infinite, so it is sought past its end once, which
 * makes the browser read the length, and brought back to its start as the
 * length lands (`onDurationChange`).
 */
function probeLength(video: HTMLVideoElement): void {
  if (!Number.isFinite(video.duration)) video.currentTime = Number.MAX_SAFE_INTEGER;
}

/** Plays a paused video, or pauses a playing one. */
function toggleOf(video: HTMLVideoElement | null): void {
  if (video === null) return;
  if (video.paused) video.play().catch(() => undefined);
  else video.pause();
}

/**
 * Answers a key pressed while focus is in the player: plays or pauses, or
 * seeks, and keeps the key from the place around it. Note that Space on one
 * of the bar's buttons is left to the button, which it presses.
 */
function playerKey(event: React.KeyboardEvent<HTMLElement>, video: HTMLVideoElement | null): void {
  if (video === null || event.metaKey || event.ctrlKey || event.altKey) return;
  const onButton = event.target instanceof HTMLButtonElement;
  const seek = SEEK_KEYS.get(event.key);
  if (TOGGLE_KEYS.has(event.key) && !(onButton && event.key === " ")) {
    // A held key plays or pauses once, not again with each repeat; a held arrow goes on seeking.
    if (!event.repeat) toggleOf(video);
  } else if (seek !== undefined) {
    const end = Number.isFinite(video.duration) ? video.duration : video.currentTime;
    video.currentTime = Math.min(end, Math.max(0, video.currentTime + seek));
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

/** One of the bar's buttons, its name its hint. */
function BarButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <IconButton icon={icon} label={label} variant={BUTTON_VARIANT.MEDIA} onClick={onPress} />
    </Tooltip>
  );
}

/** The bar along a video's foot: play or pause, how far of how long, the scrubber, Expand, and Full screen. */
function VideoBar({
  playback,
  full,
  onToggle,
  onSeek,
  onExpand,
  onFullScreen,
}: {
  playback: Playback;
  full: boolean;
  onToggle: () => void;
  onSeek: (at: number) => void;
  onExpand: (() => void) | undefined;
  onFullScreen: () => void;
}): React.JSX.Element {
  const time = `${runningTime(playback.at)} / ${runningTime(playback.duration)}`;
  return (
    <span className="luke-video-player-bar">
      <BarButton
        label={playback.playing ? VIDEO_LABEL.PAUSE : VIDEO_LABEL.PLAY}
        icon={playback.playing ? <PauseIcon /> : <PlayIcon />}
        onPress={onToggle}
      />
      <span className="luke-video-player-time">{time}</span>
      <Slider
        label={VIDEO_LABEL.SEEK}
        value={playback.at}
        max={playback.duration}
        step={SEEK_STEP_S}
        length={SLIDER_LENGTH.FILL}
        valueText={time}
        onChange={onSeek}
      />
      {onExpand === undefined || full ? null : (
        <BarButton label={VIDEO_LABEL.EXPAND} icon={<ExpandIcon />} onPress={onExpand} />
      )}
      <BarButton
        label={full ? VIDEO_LABEL.EXIT_FULL_SCREEN : VIDEO_LABEL.FULL_SCREEN}
        icon={full ? <ExitFullScreenIcon /> : <FullScreenIcon />}
        onPress={onFullScreen}
      />
    </span>
  );
}

/** A video played in place of a picture or in the viewer, under Luke's own bar. */
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
  /** Opens the video in the viewer; without one, the bar offers no Expand. */
  onExpand?: (() => void) | undefined;
}): React.JSX.Element {
  const url = useBlobUrl(dataUrl);
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLSpanElement>(null);
  const [full, toggleFullScreen] = useFullScreen(frame);
  const [playback, setPlayback] = useState<Playback>({ playing: false, at: 0, duration: 0 });
  const viewer = place === VIDEO_PLAYER_PLACE.VIEWER;
  const read = (shown: HTMLVideoElement) => {
    const duration = Number.isFinite(shown.duration) ? shown.duration : 0;
    // Note that the time is held within the length, because the seek that reads a length stands past it a moment.
    setPlayback({ playing: !shown.paused, at: Math.min(shown.currentTime, duration), duration });
  };
  const expand =
    onExpand === undefined
      ? undefined
      : () => {
          const shown = video.current;
          if (shown !== null) {
            shown.pause();
            notePictureOrigin(shown);
          }
          onExpand();
        };
  const seek = (at: number) => {
    if (video.current !== null) video.current.currentTime = at;
  };
  const player = (
    // biome-ignore lint/a11y/useSemanticElements: a player holds a video and its bar, not a form's controls, so it is no `<fieldset>`.
    <span
      ref={frame}
      className="luke-video-player-frame"
      data-playing={playback.playing}
      data-full={full}
      // Note that the frame takes focus, so a press on the video leaves the keys with the player.
      tabIndex={-1}
      role="group"
      aria-label={VIDEO_LABEL.PLAYER}
      // Note that the player hears a key before the control it lands on, because the scrubber's
      // slider steps on an arrow itself and stands down only for a key already taken.
      onKeyDownCapture={(event) => playerKey(event, video.current)}
    >
      {url === undefined ? null : (
        // Note that the player carries no captions track, because an agent's recording of its screen has no sound.
        <video
          ref={video}
          className="luke-video-player-video"
          src={url}
          width={size?.width}
          height={size?.height}
          aria-label={label === "" ? VIDEO_LABEL.VIDEO : `${VIDEO_LABEL.VIDEO}: ${label}`}
          autoPlay={viewer}
          muted
          playsInline
          preload={viewer ? "auto" : "metadata"}
          onClick={() => {
            frame.current?.focus({ preventScroll: true });
            toggleOf(video.current);
          }}
          onLoadedMetadata={(event) => {
            probeLength(event.currentTarget);
            read(event.currentTarget);
          }}
          onDurationChange={(event) => {
            const shown = event.currentTarget;
            // A length read by seeking past the end brings the video back to its start.
            if (Number.isFinite(shown.duration) && shown.currentTime >= shown.duration) {
              shown.currentTime = 0;
            }
            read(shown);
          }}
          onTimeUpdate={(event) => read(event.currentTarget)}
          onPlay={(event) => read(event.currentTarget)}
          onPause={(event) => read(event.currentTarget)}
          onEnded={(event) => read(event.currentTarget)}
        />
      )}
      <VideoBar
        playback={playback}
        full={full}
        onToggle={() => toggleOf(video.current)}
        onSeek={seek}
        onExpand={expand}
        onFullScreen={toggleFullScreen}
      />
    </span>
  );
  // In the viewer the card around it is the viewer's own.
  if (viewer) {
    return (
      <span className="luke-video-player" data-place={place}>
        {player}
      </span>
    );
  }
  return (
    <Card
      as={CARD_ELEMENT.SPAN}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      className="luke-video-player"
      data-place={place}
    >
      {player}
    </Card>
  );
}
