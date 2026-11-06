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

const MS_PER_SECOND = 1_000;

const FALLBACK_FRAME_S = 1 / 30;

const NS_PER_SECOND = 1_000_000_000;

const FRAME_S_BOUNDS = { MIN: 0.001, MAX: 1 } as const;

const WEBM_ID = {
  DEFAULT_DURATION: [0x23, 0xe3, 0x83],
  CLUSTER: [0x1f, 0x43, 0xb6, 0x75],
} as const;

const HEADER_BASE64_CHARS = 16_384;

const ARROW_SEEK_S = 5;

const FLASH_OUT = "ui-video-player-flash-out";

const FLASH_KIND = {
  JUMP: "jump",
  SPEED: "speed",
} as const;

const SPEEDS: readonly number[] = [0.25, 0.5, 1, 1.5, 2];

const NORMAL_SPEED = 1;

const TOGGLE_KEYS: ReadonlySet<string> = new Set([" ", "k", "K"]);

const SEEK_KEYS: ReadonlyMap<string, number> = new Map([
  ["ArrowLeft", -ARROW_SEEK_S],
  ["ArrowRight", ARROW_SEEK_S],
]);

const FRAME_KEYS: ReadonlyMap<string, number> = new Map([
  [SHORTCUT_KEY.COMMA.key, -1],
  [SHORTCUT_KEY.PERIOD.key, 1],
]);

const SPEED_KEYS: ReadonlyMap<string, number> = new Map([
  ["<", -1],
  [">", 1],
]);

const END_KEYS = { START: SHORTCUT_KEY.HOME.key, END: SHORTCUT_KEY.END.key } as const;

const FRAME_CHORD = {
  PREVIOUS: IN_CONTEXT_SHORTCUTS[IN_CONTEXT_KEY.VIDEO_FRAME_BACK].chord,
  NEXT: IN_CONTEXT_SHORTCUTS[IN_CONTEXT_KEY.VIDEO_FRAME_AHEAD].chord,
} as const satisfies Record<string, ShortcutChord>;

export const VIDEO_PLAYER_PLACE = {
  INLINE: "inline",
  VIEWER: "viewer",
} as const;

export type VideoPlayerPlace = (typeof VIDEO_PLAYER_PLACE)[keyof typeof VIDEO_PLAYER_PLACE];

type FlashAsk =
  | { readonly kind: typeof FLASH_KIND.JUMP; readonly seconds: number }
  | { readonly kind: typeof FLASH_KIND.SPEED; readonly speed: number };

interface Flash {
  readonly ask: FlashAsk;
  readonly run: number;
  readonly press: number;
}

export interface VideoSize {
  readonly width: number;
  readonly height: number;
}

interface Playback {
  readonly playing: boolean;
  readonly at: number;
  readonly duration: number;
  readonly speed: number;
}

export function dataUrlMediaType(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";"));
}

export function isVideoDataUrl(dataUrl: string): boolean {
  return dataUrlMediaType(dataUrl) === CONVERSATION_MEDIA_TYPE.WEBM;
}

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

function idAt(head: string, at: number, id: readonly number[]): boolean {
  return id.every((byte, offset) => head.charCodeAt(at + offset) === byte);
}

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

type WebKitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

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

function probeLength(video: HTMLVideoElement): void {
  if (!Number.isFinite(video.duration)) video.currentTime = Number.MAX_SAFE_INTEGER;
}

function toggleOf(video: HTMLVideoElement | null): void {
  if (video === null) return;
  if (video.paused) video.play().catch(() => undefined);
  else video.pause();
}

function endOf(video: HTMLVideoElement): number {
  return Number.isFinite(video.duration) ? video.duration : video.currentTime;
}

function stepFrame(video: HTMLVideoElement, frame: number, by: number): void {
  video.pause();
  const end = endOf(video);
  const last = Math.max(0, Math.ceil(end / frame) - 1);
  const shown = Math.min(last, Math.floor(video.currentTime / frame));
  const next = Math.min(last, Math.max(0, shown + by));
  video.currentTime = Math.min(end, (next + 0.5) * frame);
}

function speedBy(speed: number, by: number): number {
  const at = SPEEDS.indexOf(speed);
  const from = at === -1 ? SPEEDS.indexOf(NORMAL_SPEED) : at;
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, from + by))] ?? NORMAL_SPEED;
}

function nextSpeed(speed: number): number {
  return SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? NORMAL_SPEED;
}

function setSpeed(video: HTMLVideoElement | null, speed: number): void {
  if (video === null) return;
  video.defaultPlaybackRate = speed;
  video.playbackRate = speed;
}

function speedText(speed: number): string {
  return `${String(speed)}×`;
}

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
    if (!event.repeat) toggleOf(video);
  } else if (seek !== undefined) {
    const from = video.currentTime;
    video.currentTime = Math.min(endOf(video), Math.max(0, from + seek));
    if (video.currentTime !== from) onFlash({ kind: FLASH_KIND.JUMP, seconds: seek });
  } else if (step !== undefined) {
    stepFrame(video, frame, step);
  } else if (event.key === END_KEYS.START || event.key === END_KEYS.END) {
    video.currentTime = event.key === END_KEYS.START ? 0 : endOf(video);
  } else if (speed !== undefined) {
    const next = speedBy(video.playbackRate, speed);
    if (next !== video.playbackRate) onFlash({ kind: FLASH_KIND.SPEED, speed: next });
    setSpeed(video, next);
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

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

const FLASH_PILL =
  "ui-video-player-flash flex items-center gap-icon-gap rounded-tooltip border border-tooltip-edge bg-veil px-2 py-1 text-tag font-tag whitespace-nowrap tabular-nums text-on-veil [&>svg]:size-caption-leading [&>svg]:flex-none";

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

const BAR =
  "ui-video-player-bar @container/video-bar absolute right-0 bottom-0 left-0 flex items-center gap-ui-4 bg-[linear-gradient(transparent,var(--color-veil))] px-ui-6 pt-ui-24 pb-ui-4 text-on-veil transition-opacity duration-(--ui-duration-fast) ease-motion-exit " +
  "group-data-[playing=true]/video-frame:[@media(hover:hover)]:opacity-0 group-data-[playing=true]/video-frame:group-hover/video-frame:opacity-100 group-data-[playing=true]/video-frame:[@media(hover:hover)]:group-focus-within/video-frame:opacity-100 " +
  "[&_.ui-slider]:mx-ui-4 [&_.ui-slider]:h-ui-16 [&_.ui-slider]:accent-on-veil";

const BAR_EXTRA = "contents @max-[360px]/video-bar:hidden";

const BAR_TIME =
  "ui-video-player-time flex-none text-caption tabular-nums @max-[200px]/video-bar:hidden";

const FRAME =
  "ui-video-player-frame group/video-frame relative block max-h-[inherit] bg-veil focus:outline-none [&:fullscreen]:h-screen [&:fullscreen]:w-stage";

const VIDEO =
  "ui-video-player-video block h-auto w-auto max-w-full cursor-press group-[:fullscreen]/video-frame:size-full group-[:fullscreen]/video-frame:max-h-none group-[:fullscreen]/video-frame:max-w-none group-[:fullscreen]/video-frame:object-contain";

const PLAYER = "ui-video-player relative block w-fit max-w-full";

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

export function VideoPlayer({
  dataUrl,
  label,
  size,
  place = VIDEO_PLAYER_PLACE.INLINE,
  onExpand,
}: {
  dataUrl: string;
  label: string;
  size?: VideoSize | undefined;
  place?: VideoPlayerPlace | undefined;
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
  const [natural, setNatural] = useState<VideoSize>();
  const viewer = place === VIDEO_PLAYER_PLACE.VIEWER;
  const [starts] = useState(() => viewer && !motionHeld());
  const read = (shown: HTMLVideoElement) => {
    const duration = Number.isFinite(shown.duration) ? shown.duration : 0;
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
      tabIndex={-1}
      role="group"
      aria-label={VIDEO_LABEL.PLAYER}
      onKeyDownCapture={(event) =>
        playerKey(event, video.current, frameSeconds, (ask) => setFlash((was) => flashOn(was, ask)))
      }
    >
      {url === undefined ? null : (
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
