import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { playheadText } from "@repo/features/time-format";
import {
  IN_CONTEXT_KEY,
  IN_CONTEXT_SHORTCUTS,
  SHORTCUT_KEY,
  type ShortcutChord,
} from "@repo/settings/shortcuts";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import {
  ExitFullScreenIcon,
  ExpandIcon,
  FastForwardIcon,
  FullScreenIcon,
  NextFrameIcon,
  PauseIcon,
  PlayIcon,
  PreviousFrameIcon,
  RewindIcon,
} from "../../face/glyphs.js";
import { motionHeld } from "../../motion-timing.js";
import { notePictureOrigin } from "../../picture-expand.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, IconButton } from "../button/button.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, Card } from "../card/card.js";
import { SLIDER_LENGTH, Slider } from "../slider/slider.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * video-player.tsx -- a video an agent recorded of what it did, played where a picture of it would be drawn, in its transcript and its inbox item, and in the file viewer an Expand opens.
 *
 * The player is our own rather than the browser's: a bar along the
 * video's foot of the same icon buttons, glyphs, and slider the window draws
 * everywhere, with play and pause, a frame back and a frame on, how far it
 * has run of how long, a scrubber, its speed, Expand where the place has a
 * viewer to open, and Full screen; a narrow bar lets the frame steps and the
 * speed go, and the narrowest its playhead too, so Expand and Full screen
 * always stand in reach. A press on the video itself plays or
 * pauses it, and while focus is in the player its keys are the ones video
 * sites share: Space or K plays or pauses, the left and right arrows seek
 * five seconds, comma and period step a frame back or on, pausing first,
 * Home and End go to the start and the end, and < and > slow it or speed
 * it, all kept from the place around it, such as the viewer whose arrows
 * walk its files; a button's own Space presses the button. An arrow's jump
 * flashes on the side it went, as on the video sites, how far in seconds,
 * and presses in one direction while it stands add up ("10 seconds"); a
 * speed key flashes the speed in the middle, since the bar may stand faded.
 * The flash is the window's hint pill drawn in the veil's ink: it arrives as
 * a hint does, once for a run of presses, each press standing it again for
 * `--ui-flash-delay`, and leaves over the exit.
 *
 * A frame step lands in the middle of the frame it goes to, never on its
 * edge, so a time a hair off either way still shows that frame, and the
 * scrubber moves a frame at a time. How long a frame stands is read from
 * the WebM's header (`frameSecondsOf`), which every recorder of an agent's
 * states, at a constant rate. The bar stands while the
 * video is paused and, with a pointer, fades while it plays until the
 * pointer or the keyboard is in it; on a touch screen it always stands. Full
 * screen fills the screen with the frame, the bar with it, and Escape or its
 * button brings it back; where the browser fills it with nothing but a
 * video, as Safari on an iPhone, it opens the video in the browser's player. There is no volume, since an agent's recording of
 * its screen has no sound, and no Download, which the viewer's header has.
 *
 * Where a picture would be drawn, the video plays in place (`INLINE`), in a
 * frame that hugs it at its own shape up to its column's width. A place that
 * has a viewer to open hands `onExpand`: Expand pauses the video here and
 * opens the viewer, which grows from the frame as it grows from a picture's
 * tile. In the viewer (`VIEWER`) the video plays at once, as wide as the
 * place makes the player, unless motion is held still (`motionHeld`: reduced
 * motion or a capture run), where it waits on its first frame for Play; once
 * its size is read it says it as `--ui-video-natural-width` and
 * `--ui-video-natural-height`, plain numbers the place may fit it by.
 *
 * The bytes arrive as a picture's do, as a `data:` URL the window's picture
 * reads hold (`picture-cache.ts`, the inbox's own), and play
 * from a `blob:` address made of them here and let go of as the player goes,
 * because neither window's content policy lets media load from a `data:`
 * address, where both allow `blob:`. What holds the player keeps it out of
 * the screen recording, as it keeps a picture (`ph-no-capture`).
 *
 * It is drawn in Tailwind utilities over the theme, its inline frame a
 * `Card` (shadcn/ui's) and its controls `@repo/ui`'s own; shadcn/ui has no
 * player.
 */

/** What the player and its controls are named for a reader. */
const VIDEO_LABEL = {
  VIDEO: "Video",
  PLAYER: "Video player",
  PLAY: "Play",
  PAUSE: "Pause",
  PREVIOUS_FRAME: "Previous frame",
  NEXT_FRAME: "Next frame",
  SEEK: "Seek",
  SPEED: "Playback speed",
  SPEED_HINT: "Playback speed (< slower, > faster)",
  EXPAND: "Expand",
  FULL_SCREEN: "Full screen",
  EXIT_FULL_SCREEN: "Exit full screen",
} as const;

/** The milliseconds in a second, for the player's playhead in the one clock a recording is told in. */
const MS_PER_SECOND = 1_000;

/** How long a frame stands, in seconds, where a video's header states no length: a thirtieth, a screen recorder's usual rate. */
const FALLBACK_FRAME_S = 1 / 30;

/** The nanoseconds in a second, the unit a WebM states a frame's length in. */
const NS_PER_SECOND = 1_000_000_000;

/** The shortest and longest frame a header is believed about, in seconds; past them it is read as no length at all. */
const FRAME_S_BOUNDS = { MIN: 0.001, MAX: 1 } as const;

/**
 * The EBML ids a frame's length is read between: a track's DefaultDuration,
 * and the first Cluster, where the header ends and the frames begin.
 */
const WEBM_ID = {
  DEFAULT_DURATION: [0x23, 0xe3, 0x83],
  CLUSTER: [0x1f, 0x43, 0xb6, 0x75],
} as const;

/** How much of a `data:` URL's base64 holds a WebM's header, read for its frame length: twelve kilobytes, a whole number of base64's four-character groups. */
const HEADER_BASE64_CHARS = 16_384;

/** How far an arrow key seeks, in seconds. */
const ARROW_SEEK_S = 5;

/** The keyframes whose end takes the flash, its fade (`video-player.css`). */
const FLASH_OUT = "ui-video-player-flash-out";

/** What a key flashes over the video: an arrow's jump, or a speed key's speed. */
const FLASH_KIND = {
  JUMP: "jump",
  SPEED: "speed",
} as const;

/** The speeds the player plays at, slowest first; the bar's speed button walks them round, and < and > step along them. */
const SPEEDS: readonly number[] = [0.25, 0.5, 1, 1.5, 2];

/** The speed a video starts at. */
const NORMAL_SPEED = 1;

/** The keys that play or pause the player while focus is in it. */
const TOGGLE_KEYS: ReadonlySet<string> = new Set([" ", "k", "K"]);

/** How far each arrow seeks, in seconds, while focus is in the player. */
const SEEK_KEYS: ReadonlyMap<string, number> = new Map([
  ["ArrowLeft", -ARROW_SEEK_S],
  ["ArrowRight", ARROW_SEEK_S],
]);

/** Which way each key steps a frame while focus is in the player: comma back, period on, as on the video sites. */
const FRAME_KEYS: ReadonlyMap<string, number> = new Map([
  [SHORTCUT_KEY.COMMA.key, -1],
  [SHORTCUT_KEY.PERIOD.key, 1],
]);

/** Which way each key steps the speed while focus is in the player: < slower, > faster. */
const SPEED_KEYS: ReadonlyMap<string, number> = new Map([
  ["<", -1],
  [">", 1],
]);

/** Where Home and End send the video: its start, or its end. */
const END_KEYS = { START: SHORTCUT_KEY.HOME.key, END: SHORTCUT_KEY.END.key } as const;

/** The keys the frame buttons name in their hints, as the Keyboard shortcuts page lists them. */
const FRAME_CHORD = {
  PREVIOUS: IN_CONTEXT_SHORTCUTS[IN_CONTEXT_KEY.VIDEO_FRAME_BACK].chord,
  NEXT: IN_CONTEXT_SHORTCUTS[IN_CONTEXT_KEY.VIDEO_FRAME_AHEAD].chord,
} as const satisfies Record<string, ShortcutChord>;

/** Where a video plays: in place of a picture, or in the file viewer. */
export const VIDEO_PLAYER_PLACE = {
  INLINE: "inline",
  VIEWER: "viewer",
} as const;

export type VideoPlayerPlace = (typeof VIDEO_PLAYER_PLACE)[keyof typeof VIDEO_PLAYER_PLACE];

/** What one key asks the flash to say: how far a jump went in seconds, signed, or the speed it set. */
type FlashAsk =
  | { readonly kind: typeof FLASH_KIND.JUMP; readonly seconds: number }
  | { readonly kind: typeof FLASH_KIND.SPEED; readonly speed: number };

/**
 * The flash over the video: what it says, which run of presses it belongs
 * to, which arrives once, and which press stood it last, each standing it
 * again.
 */
interface Flash {
  readonly ask: FlashAsk;
  readonly run: number;
  readonly press: number;
}

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
  readonly speed: number;
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
 * here and let go of as what draws it goes, the player or a thumb's still:
 * neither window's policy lets media load from a `data:` address, nor fetch
 * one, where both allow `blob:`. Note that the bytes are copied into an
 * array of their own length one by one, because `Uint8Array.from` over the
 * decoded string first lists every character, tens of megabytes for a
 * recording, which a phone with several on screen runs out of room for.
 */
export function useBlobUrl(dataUrl: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
    const made = URL.createObjectURL(new Blob([bytes], { type: dataUrlMediaType(dataUrl) }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [dataUrl]);
  return url;
}

/** Whether the bytes of `head` at `at` are the EBML id `id`. */
function idAt(head: string, at: number, id: readonly number[]): boolean {
  return id.every((byte, offset) => head.charCodeAt(at + offset) === byte);
}

/**
 * How long one frame of a WebM stands, in seconds, as its header states it
 * (a track's DefaultDuration, in nanoseconds), or a thirtieth of a second
 * where it states none. Note that the recorders behind an agent's
 * recordings (ffmpeg behind its browser's `record`, Playwright's screencast)
 * state one, at a constant rate, where a MediaRecorder states none; and that
 * the header alone is read, up to the first Cluster, so no frame's bytes are
 * taken for the id. The length's size is a one-byte EBML number, the only
 * one a muxer writes for a field of at most eight bytes.
 */
function frameSecondsOf(dataUrl: string): number {
  const start = dataUrl.indexOf(",") + 1;
  const head = atob(dataUrl.slice(start, start + HEADER_BASE64_CHARS));
  for (let at = 0; at < head.length && !idAt(head, at, WEBM_ID.CLUSTER); at += 1) {
    if (!idAt(head, at, WEBM_ID.DEFAULT_DURATION)) continue;
    const marker = head.charCodeAt(at + WEBM_ID.DEFAULT_DURATION.length);
    const size = marker & 0x7f;
    const from = at + WEBM_ID.DEFAULT_DURATION.length + 1;
    if ((marker & 0x80) === 0 || size === 0 || size > 8 || from + size > head.length) continue;
    let ns = 0;
    for (let byte = 0; byte < size; byte += 1) ns = ns * 256 + head.charCodeAt(from + byte);
    const seconds = ns / NS_PER_SECOND;
    if (seconds >= FRAME_S_BOUNDS.MIN && seconds <= FRAME_S_BOUNDS.MAX) return seconds;
  }
  return FALLBACK_FRAME_S;
}

/** A video as Safari draws one, which on a phone fills the screen only in Safari's own player. */
type WebKitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/**
 * Whether `frame` fills the screen, and the press that toggles it. Note that
 * the frame is what fills it, not the video, so the bar comes with it. Note
 * that a browser that fills the screen with no element, as Safari on an
 * iPhone, hands the video alone to its own player instead, because that is
 * the one full screen it offers; our bar stays behind, and the player's own
 * Done brings it back.
 */
function useFullScreen(
  frame: RefObject<HTMLElement | null>,
  video: RefObject<WebKitVideo | null>,
): [boolean, () => void] {
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
    if (!document.fullscreenEnabled) {
      video.current?.webkitEnterFullscreen?.();
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

/** Where a video ends, in seconds, or where it stands while its length is not yet known. */
function endOf(video: HTMLVideoElement): number {
  return Number.isFinite(video.duration) ? video.duration : video.currentTime;
}

/**
 * Pauses a video and steps it `by` frames of `frame` seconds, back or on,
 * to the middle of the frame it lands on, within its first and last.
 */
function stepFrame(video: HTMLVideoElement, frame: number, by: number): void {
  video.pause();
  const end = endOf(video);
  const last = Math.max(0, Math.ceil(end / frame) - 1);
  // Note that at its very end the time stands on the edge past the last frame, which is the one showing.
  const shown = Math.min(last, Math.floor(video.currentTime / frame));
  const next = Math.min(last, Math.max(0, shown + by));
  video.currentTime = Math.min(end, (next + 0.5) * frame);
}

/** The speed `by` steps along from `speed`, held at the slowest and the fastest. */
function speedBy(speed: number, by: number): number {
  const at = SPEEDS.indexOf(speed);
  const from = at === -1 ? SPEEDS.indexOf(NORMAL_SPEED) : at;
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, from + by))] ?? NORMAL_SPEED;
}

/** The speed after `speed` as the speed button walks them, back to the slowest after the fastest. */
function nextSpeed(speed: number): number {
  return SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? NORMAL_SPEED;
}

/**
 * Sets a video's speed, its default too, because loading its address again
 * puts a video back at its default.
 */
function setSpeed(video: HTMLVideoElement | null, speed: number): void {
  if (video === null) return;
  video.defaultPlaybackRate = speed;
  video.playbackRate = speed;
}

/** A speed as the bar spells it: "0.25×", "1×". */
function speedText(speed: number): string {
  return `${String(speed)}×`;
}

/**
 * Answers a key pressed while focus is in the player: plays or pauses,
 * seeks, steps a frame, goes to an end, or changes the speed, and keeps the
 * key from the place around it. Note that Space on one of the bar's buttons
 * is left to the button, which it presses.
 */
function playerKey(
  event: React.KeyboardEvent<HTMLElement>,
  video: HTMLVideoElement | null,
  frame: number,
  onFlash: (ask: FlashAsk) => void,
): void {
  if (video === null || event.metaKey || event.ctrlKey || event.altKey) return;
  const onButton = event.target instanceof HTMLButtonElement;
  const seek = SEEK_KEYS.get(event.key);
  const step = FRAME_KEYS.get(event.key);
  const speed = SPEED_KEYS.get(event.key);
  if (TOGGLE_KEYS.has(event.key) && !(onButton && event.key === " ")) {
    // A held key plays or pauses once, not again with each repeat; a held arrow or frame key goes on.
    if (!event.repeat) toggleOf(video);
  } else if (seek !== undefined) {
    const from = video.currentTime;
    video.currentTime = Math.min(endOf(video), Math.max(0, from + seek));
    // A jump at an end that moves nothing flashes nothing; one cut short by an end still says the key's step, as the video sites do.
    if (video.currentTime !== from) onFlash({ kind: FLASH_KIND.JUMP, seconds: seek });
  } else if (step !== undefined) {
    stepFrame(video, frame, step);
  } else if (event.key === END_KEYS.START || event.key === END_KEYS.END) {
    video.currentTime = event.key === END_KEYS.START ? 0 : endOf(video);
  } else if (speed !== undefined) {
    const next = speedBy(video.playbackRate, speed);
    // A speed key at the slowest or the fastest changes nothing and flashes nothing.
    if (next !== video.playbackRate) onFlash({ kind: FLASH_KIND.SPEED, speed: next });
    setSpeed(video, next);
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

/** One of the bar's buttons, its name its hint, with the key that reaches it where it has one. */
function BarButton({
  label,
  icon,
  chord,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  chord?: ShortcutChord | undefined;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={label} chord={chord}>
      <IconButton icon={icon} label={label} variant={BUTTON_VARIANT.MEDIA} onClick={onPress} />
    </Tooltip>
  );
}

/**
 * The flash `ask` makes on from `was`: one run with it where it says the
 * same kind of thing (a jump the same way, which it adds to, or a speed),
 * else a run of its own.
 */
function flashOn(was: Flash | undefined, ask: FlashAsk): Flash {
  const press = (was?.press ?? 0) + 1;
  if (was === undefined || was.ask.kind !== ask.kind)
    return { ask, run: (was?.run ?? 0) + 1, press };
  if (ask.kind === FLASH_KIND.SPEED) return { ask, run: was.run, press };
  if (was.ask.kind === FLASH_KIND.JUMP && Math.sign(was.ask.seconds) === Math.sign(ask.seconds)) {
    return {
      ask: { kind: FLASH_KIND.JUMP, seconds: was.ask.seconds + ask.seconds },
      run: was.run,
      press,
    };
  }
  return { ask, run: was.run + 1, press };
}

/** The pill a flash is drawn as: the window's hint pill, its corner, edge, padding, and type, in the veil's ink. */
const FLASH_PILL =
  "ui-video-player-flash flex items-center gap-icon-gap rounded-tooltip border border-tooltip-edge bg-veil px-2 py-1 text-tag font-tag whitespace-nowrap tabular-nums text-on-veil [&>svg]:size-caption-leading [&>svg]:flex-none";

/**
 * The flash over the video a key gives: a jump on the side it went, its
 * glyph and how far, or a speed in the middle. It arrives as the window's
 * hint does, once a run, while each press stands it again by drawing its
 * pill anew (`video-player.css`), and is taken as its fade ends. Note that it
 * is hidden from a reader, because the scrubber and the speed button already
 * say where the video stands and how fast, and lets a press through to the
 * video under it.
 */
function KeyFlash({ flash, onGone }: { flash: Flash; onGone: () => void }): React.JSX.Element {
  const { ask } = flash;
  const back = ask.kind === FLASH_KIND.JUMP && ask.seconds < 0;
  const side =
    ask.kind === FLASH_KIND.SPEED ? "justify-center" : back ? "justify-start" : "justify-end";
  return (
    <span
      className={`ui-video-player-flashes pointer-events-none absolute inset-0 flex items-center px-ui-24 ${side}`}
      aria-hidden="true"
    >
      <span key={flash.run} className="flex animate-tooltip-in">
        <span
          key={flash.press}
          className={FLASH_PILL}
          onAnimationEnd={(event) => {
            if (event.animationName === FLASH_OUT) onGone();
          }}
        >
          {ask.kind === FLASH_KIND.SPEED ? (
            speedText(ask.speed)
          ) : (
            <>
              {back ? <RewindIcon /> : null}
              {`${String(Math.abs(ask.seconds))} seconds`}
              {back ? null : <FastForwardIcon />}
            </>
          )}
        </span>
      </span>
    </span>
  );
}

/** The bar's speed button, its words the speed it plays at, which a press walks round; its hint names the keys that step it. */
function SpeedButton({
  speed,
  onPress,
}: {
  speed: number;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={VIDEO_LABEL.SPEED_HINT}>
      <Button
        label={`${VIDEO_LABEL.SPEED}: ${speedText(speed)}`}
        variant={BUTTON_VARIANT.MEDIA}
        size={BUTTON_SIZE.COMPACT}
        onClick={onPress}
      >
        {speedText(speed)}
      </Button>
    </Tooltip>
  );
}

/**
 * The bar along the video's foot, over a veil that keeps its words legible
 * on any frame, its scrubber a thin track in the bar's ink. With a pointer
 * it fades while the video plays and comes back while the pointer or the
 * keyboard is in the frame; on a touch screen it always stands, so a first
 * tap presses rather than being spent as a hover. It answers its own width
 * (`@container/video-bar`), the frame's, never its content's, since it
 * stands across the frame: narrow, it lets its extras go first and its
 * playhead after them (`BAR_EXTRA`, `BAR_TIME`), so Play, the scrubber,
 * Expand, and Full screen stay in reach on a phone-shaped video in a row of
 * them rather than running off its edge.
 */
const BAR =
  "ui-video-player-bar @container/video-bar absolute right-0 bottom-0 left-0 flex items-center gap-ui-4 bg-[linear-gradient(transparent,var(--color-veil))] px-ui-6 pt-ui-24 pb-ui-4 text-on-veil transition-opacity duration-(--ui-duration-fast) ease-motion-exit " +
  "group-data-[playing=true]/video-frame:[@media(hover:hover)]:opacity-0 group-data-[playing=true]/video-frame:group-hover/video-frame:opacity-100 group-data-[playing=true]/video-frame:[@media(hover:hover)]:group-focus-within/video-frame:opacity-100 " +
  "[&_.ui-slider]:mx-ui-4 [&_.ui-slider]:h-ui-16 [&_.ui-slider]:accent-on-veil";

/**
 * The bar's extras, a frame back and on and the speed, which a narrow bar
 * lets go, their keys still reaching them: off-scale, 360px, where they
 * would leave the scrubber no room beside the rest.
 */
const BAR_EXTRA = "contents @max-[360px]/video-bar:hidden";

/** How far the video has run of how long, which the narrowest bar lets go for the scrubber: off-scale, 200px. */
const BAR_TIME =
  "ui-video-player-time flex-none text-caption tabular-nums @max-[200px]/video-bar:hidden";

/**
 * The frame the video and its bar stand in, on the veil while its first
 * frame loads. It takes focus only from a press, to hold the player's keys,
 * so it draws no ring of its own; its buttons draw theirs. Full screen, it
 * fills the screen and the video stands in it at its own shape. Note that
 * the frame stays a block there, because a grid's row is sized to its
 * content, so the video's full height would resolve as auto and the video
 * would fill the width and run off the screen's foot.
 */
const FRAME =
  "ui-video-player-frame group/video-frame relative block max-h-[inherit] bg-veil focus:outline-none [&:fullscreen]:h-screen [&:fullscreen]:w-stage";

/** The video at its own shape, as wide as its column and no taller than a picture, or the viewer's; filling the screen full screen. */
const VIDEO =
  "ui-video-player-video block h-auto w-auto max-w-full cursor-press group-[:fullscreen]/video-frame:size-full group-[:fullscreen]/video-frame:max-h-none group-[:fullscreen]/video-frame:max-w-none group-[:fullscreen]/video-frame:object-contain";

/** The player as its place holds it: hugging the video at most its column's width, and in the viewer no taller than the card. */
const PLAYER = "ui-video-player relative block w-fit max-w-full";

/** The bar along a video's foot: play or pause, a frame back and on, how far of how long, the scrubber, the speed, Expand, and Full screen. */
function VideoBar({
  playback,
  frame,
  full,
  onToggle,
  onStep,
  onSeek,
  onSpeed,
  onExpand,
  onFullScreen,
}: {
  playback: Playback;
  /** How long a frame stands, in seconds, which the scrubber moves by. */
  frame: number;
  full: boolean;
  onToggle: () => void;
  onStep: (by: number) => void;
  onSeek: (at: number) => void;
  onSpeed: () => void;
  onExpand: (() => void) | undefined;
  onFullScreen: () => void;
}): React.JSX.Element {
  const time = `${playheadText(playback.at * MS_PER_SECOND)} / ${playheadText(playback.duration * MS_PER_SECOND)}`;
  return (
    <span className={BAR}>
      <BarButton
        label={playback.playing ? VIDEO_LABEL.PAUSE : VIDEO_LABEL.PLAY}
        icon={playback.playing ? <PauseIcon /> : <PlayIcon />}
        onPress={onToggle}
      />
      <span className={BAR_EXTRA}>
        <BarButton
          label={VIDEO_LABEL.PREVIOUS_FRAME}
          icon={<PreviousFrameIcon />}
          chord={FRAME_CHORD.PREVIOUS}
          onPress={() => onStep(-1)}
        />
        <BarButton
          label={VIDEO_LABEL.NEXT_FRAME}
          icon={<NextFrameIcon />}
          chord={FRAME_CHORD.NEXT}
          onPress={() => onStep(1)}
        />
      </span>
      <span className={BAR_TIME}>{time}</span>
      <Slider
        label={VIDEO_LABEL.SEEK}
        value={playback.at}
        max={playback.duration}
        step={frame}
        length={SLIDER_LENGTH.FILL}
        valueText={time}
        onChange={onSeek}
      />
      <span className={BAR_EXTRA}>
        <SpeedButton speed={playback.speed} onPress={onSpeed} />
      </span>
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

/** A video played in place of a picture or in the viewer, under our own bar. */
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
  const [full, toggleFullScreen] = useFullScreen(frame, video);
  const [playback, setPlayback] = useState<Playback>({
    playing: false,
    at: 0,
    duration: 0,
    speed: NORMAL_SPEED,
  });
  const frameSeconds = useMemo(() => frameSecondsOf(dataUrl), [dataUrl]);
  const [flash, setFlash] = useState<Flash>();
  // The video's own pixels once its size is read, which the viewer fits it by.
  const [natural, setNatural] = useState<VideoSize>();
  const viewer = place === VIDEO_PLAYER_PLACE.VIEWER;
  // Note that whether it starts is read once, as it mounts, because a video hears autoplay only then.
  const [starts] = useState(() => viewer && !motionHeld());
  const read = (shown: HTMLVideoElement) => {
    const duration = Number.isFinite(shown.duration) ? shown.duration : 0;
    // Note that the time is held within the length, because the seek that reads a length stands past it a moment.
    setPlayback({
      playing: !shown.paused,
      at: Math.min(shown.currentTime, duration),
      duration,
      speed: shown.playbackRate,
    });
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
      className={FRAME}
      data-playing={playback.playing}
      data-full={full}
      // Note that the frame takes focus, so a press on the video leaves the keys with the player.
      tabIndex={-1}
      role="group"
      aria-label={VIDEO_LABEL.PLAYER}
      // Note that the player hears a key before the control it lands on, because the scrubber's
      // slider steps on an arrow itself and stands down only for a key already taken.
      onKeyDownCapture={(event) =>
        playerKey(event, video.current, frameSeconds, (ask) => setFlash((was) => flashOn(was, ask)))
      }
    >
      {url === undefined ? null : (
        // Note that the player carries no captions track, because an agent's recording of its screen has no sound.
        <video
          ref={video}
          className={`${VIDEO} ${viewer ? "w-full" : "max-h-video-player"}`}
          src={url}
          width={size?.width}
          height={size?.height}
          aria-label={label === "" ? VIDEO_LABEL.VIDEO : `${VIDEO_LABEL.VIDEO}: ${label}`}
          autoPlay={starts}
          muted
          playsInline
          preload={viewer ? "auto" : "metadata"}
          onClick={() => {
            frame.current?.focus({ preventScroll: true });
            toggleOf(video.current);
          }}
          onLoadedMetadata={(event) => {
            const shown = event.currentTarget;
            if (viewer) setNatural({ width: shown.videoWidth, height: shown.videoHeight });
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
          onRateChange={(event) => read(event.currentTarget)}
        />
      )}
      {flash === undefined ? null : <KeyFlash flash={flash} onGone={() => setFlash(undefined)} />}
      <VideoBar
        playback={playback}
        frame={frameSeconds}
        full={full}
        onToggle={() => toggleOf(video.current)}
        onStep={(by) => {
          if (video.current !== null) stepFrame(video.current, frameSeconds, by);
        }}
        onSeek={seek}
        onSpeed={() => setSpeed(video.current, nextSpeed(playback.speed))}
        onExpand={expand}
        onFullScreen={toggleFullScreen}
      />
    </span>
  );
  // In the viewer the card around it is the viewer's own.
  if (viewer) {
    return (
      <span
        className={`${PLAYER} max-h-full`}
        data-place={place}
        style={
          natural === undefined
            ? undefined
            : cssCustomProperties({
                "--ui-video-natural-width": natural.width,
                "--ui-video-natural-height": natural.height,
              })
        }
      >
        {player}
      </span>
    );
  }
  return (
    <Card
      as={CARD_ELEMENT.SPAN}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      className={PLAYER}
      data-place={place}
    >
      {player}
    </Card>
  );
}
