/**
 * call-video-tile.tsx -- Luke's avatar on the call, as a 16:9 tile with its video's controls, and the voice it plays.
 *
 * The tile draws what it is handed and decides nothing: the avatar's video
 * track and its status. While the avatar connects it
 * draws Luke's face and says so; while it is live it plays the video, or
 * Luke's face as a still frame where no video track is handed, which is what
 * a fixture run draws, since it reaches no avatar; once it has ended it
 * offers Restart video. Video off puts the avatar away and leaves the call
 * going as voice, in every state, and the tile collapses to a compact strip
 * whose Video on puts a fresh avatar up again; ending the call is the call
 * bar's, which the tile does not repeat. No word of the conversation is drawn
 * here. The avatar's lip-synced voice is played apart
 * from the tile (`AvatarVoice`), because the tile is drawn only while the
 * Call tab is, and the voice is what the developer hears whatever is shown.
 */

import { ThinkingDots } from "@luke/panel/thinking-dots";
import { Button, IconButton, ResetIcon, VideoIcon, VideoOffIcon, WingFace } from "@luke/ui";
import { AVATAR_STATUS, type AvatarStatus } from "@luke/voice/avatar";
import { useCallback, useEffect, useRef } from "react";

/** What the tile says, for a reader and on screen. */
export const CALL_VIDEO_LABEL = {
  TILE: "Video call",
  CONNECTING: "Connecting video",
  ENDED: "Video ended",
  VIDEO_OFF: "Turn video off",
  VIDEO_ON: "Turn video on",
  TURNED_OFF: "Video off",
  RESTART: "Restart video",
} as const;

/** Plays one track on the element it is handed, for as long as the track stands. */
function useTrack(
  media: React.RefObject<HTMLMediaElement | null>,
  track: MediaStreamTrack | undefined,
): void {
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    element.srcObject = track === undefined ? null : new MediaStream([track]);
    return () => {
      element.srcObject = null;
    };
  }, [media, track]);
}

/** The avatar's video, muted, since its sound is the audio element's to play. */
function AvatarVideo({ track }: { track: MediaStreamTrack }): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null);
  useTrack(video, track);
  return <video ref={video} className="call-video-frame" autoPlay muted playsInline />;
}

/** Luke's face where there is no video to draw, with what the tile is waiting on, if anything. */
function AvatarStill({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="call-video-still">
      <span className="call-video-face" aria-hidden="true">
        <WingFace />
      </span>
      {children}
    </div>
  );
}

/** The tile's ground: the video, the still frame, or what the tile says in its place. */
function TileGround({
  status,
  video,
  onRestart,
}: {
  status: AvatarStatus;
  video: MediaStreamTrack | undefined;
  onRestart: () => void;
}): React.JSX.Element {
  if (status === AVATAR_STATUS.LIVE) {
    return video === undefined ? <AvatarStill /> : <AvatarVideo track={video} />;
  }
  if (status === AVATAR_STATUS.ENDED) {
    return (
      <AvatarStill>
        <span className="call-video-note">{CALL_VIDEO_LABEL.ENDED}</span>
        <Button icon={<ResetIcon />} onClick={onRestart}>
          {CALL_VIDEO_LABEL.RESTART}
        </Button>
      </AvatarStill>
    );
  }
  return (
    <AvatarStill>
      <span className="call-video-note" role="status">
        <ThinkingDots />
        {CALL_VIDEO_LABEL.CONNECTING}
      </span>
    </AvatarStill>
  );
}

/**
 * The avatar's voice, on an element drawn for as long as the panel is, so
 * no change of tab or of the tile's state cuts it, and muted while the
 * developer's speaker toggle is, as the voice window's own element is.
 */
export function AvatarVoice({
  audio,
  speakerMuted,
  onAudioElement,
}: {
  audio: MediaStreamTrack | undefined;
  speakerMuted: boolean;
  /** The element, once drawn and once gone, for whoever retries a refused play. */
  onAudioElement: (element: HTMLAudioElement | null) => void;
}): React.JSX.Element {
  const sound = useRef<HTMLAudioElement | null>(null);
  const soundElement = useCallback(
    (element: HTMLAudioElement | null) => {
      sound.current = element;
      onAudioElement(element);
    },
    [onAudioElement],
  );
  useTrack(sound, audio);
  // Note that the property is set rather than the attribute, because the
  // attribute is only the element's default and the property is what plays.
  useEffect(() => {
    if (sound.current) sound.current.muted = speakerMuted;
  }, [speakerMuted]);
  // biome-ignore lint/a11y/useMediaCaption: the avatar's voice is captioned in the Call tab's transcript.
  return <audio ref={soundElement} autoPlay hidden />;
}

/**
 * Video off or Video on: one button that says which the press will do,
 * named on hover by the system's own hint, since the floating window is too
 * small to hold a tooltip.
 */
export function VideoToggle({
  on,
  onSetVideo,
}: {
  on: boolean;
  onSetVideo: (on: boolean) => void;
}): React.JSX.Element {
  const label = on ? CALL_VIDEO_LABEL.VIDEO_OFF : CALL_VIDEO_LABEL.VIDEO_ON;
  return (
    <span className="call-video-toggle" title={label}>
      <IconButton
        icon={on ? <VideoOffIcon /> : <VideoIcon />}
        label={label}
        onClick={() => onSetVideo(!on)}
      />
    </span>
  );
}

/**
 * The top of the Call tab: the tile at the tab's width while the avatar
 * stands or has just ended, the compact strip once the developer turned
 * video off, and nothing where the status is `undefined`.
 */
export function CallVideoTile({
  video,
  status,
  onSetVideo,
}: {
  video: MediaStreamTrack | undefined;
  status: AvatarStatus | undefined;
  /** Asks main to put the avatar up, a fresh session, or take it down with the developer's own reason. */
  onSetVideo: (on: boolean) => void;
}): React.JSX.Element | null {
  if (status === undefined) return null;
  if (status === AVATAR_STATUS.OFF) {
    return (
      <section className="call-video-strip" aria-label={CALL_VIDEO_LABEL.TILE} data-status={status}>
        <span className="call-video-note">{CALL_VIDEO_LABEL.TURNED_OFF}</span>
        <VideoToggle on={false} onSetVideo={onSetVideo} />
      </section>
    );
  }
  return (
    <section className="call-video-tile" aria-label={CALL_VIDEO_LABEL.TILE} data-status={status}>
      <TileGround status={status} video={video} onRestart={() => onSetVideo(true)} />
      <div className="call-video-controls">
        <VideoToggle on onSetVideo={onSetVideo} />
      </div>
    </section>
  );
}
