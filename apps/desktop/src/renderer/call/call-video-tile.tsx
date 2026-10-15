/**
 * call-video-tile.tsx -- Luke's avatar on the call, as a 16:9 tile with its video's controls, and the voice it plays.
 *
 * The tile draws what it is handed and decides nothing: the avatar's video
 * track and its status. While the avatar connects it
 * draws Luke's face and says so; while it is live it plays the video, or
 * Luke's face as a still frame where no video track is handed, which is what
 * a fixture run draws, since it reaches no avatar; once it has ended it
 * offers Restart video. Video off puts the avatar away and leaves the call
 * going as voice, and End call ends the call, in every state. No word of the
 * conversation is drawn here. The avatar's lip-synced voice is played apart
 * from the tile (`AvatarVoice`), because the tile is drawn only while the
 * Call tab is, and the voice is what the developer hears whatever is shown.
 */

import { CloseIcon, ResetIcon, VideoOffIcon, WingFace } from "@sidecar/panel";
import { useCallback, useEffect, useRef } from "react";
import { AVATAR_STATUS, type AvatarStatus } from "#shared/messages/avatar";
import { CALL_CONTROL_LABEL } from "../planning/planning-parts";
import { ThinkingDots } from "../thinking-dots";

/** What the tile says, for a reader and on screen. */
export const CALL_VIDEO_LABEL = {
  TILE: "Video call",
  CONNECTING: "Connecting video",
  ENDED: "Video ended",
  VIDEO_OFF: "Turn video off",
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
        <button type="button" className="toolbar-button call-video-restart" onClick={onRestart}>
          <ResetIcon />
          {CALL_VIDEO_LABEL.RESTART}
        </button>
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
 * The tile, drawn at the top of the Call tab while the avatar stands or has
 * just ended, at the tab's width, and nothing while it is off.
 */
export function CallVideoTile({
  video,
  status,
  onVideoOff,
  onRestart,
  onHangUp,
}: {
  video: MediaStreamTrack | undefined;
  status: AvatarStatus;
  onVideoOff: () => void;
  onRestart: () => void;
  onHangUp: () => void;
}): React.JSX.Element | null {
  if (status === AVATAR_STATUS.OFF) return null;
  return (
    <section className="call-video-tile" aria-label={CALL_VIDEO_LABEL.TILE} data-status={status}>
      <TileGround status={status} video={video} onRestart={onRestart} />
      <div className="call-video-controls">
        <button
          type="button"
          className="icon-button call-video-off"
          aria-label={CALL_VIDEO_LABEL.VIDEO_OFF}
          title={CALL_VIDEO_LABEL.VIDEO_OFF}
          onClick={onVideoOff}
        >
          <VideoOffIcon />
        </button>
        <button
          type="button"
          className="call-end"
          aria-label={CALL_CONTROL_LABEL.END_CALL}
          title={CALL_CONTROL_LABEL.END_CALL}
          onClick={onHangUp}
        >
          <CloseIcon />
        </button>
      </div>
    </section>
  );
}
