import { appBridge } from "@luke/panel/app-bridge";
import { useRef } from "react";
import type { AvatarFeedActs } from "./live-call";
import { useVoiceSession } from "./use-voice-session";

/** Luke's voice for his avatar, sent to main, which relays it to the panel while the avatar stands. */
const AVATAR_FEED: AvatarFeedActs = { feed: (feed) => appBridge().feedAvatar(feed) };

/**
 * What the hidden voice window mounts: the live conversation, and the one
 * element Luke's voice plays through. Nothing drawn. This window is not the
 * panel and must not record: the voice window's entry (`voice/index.tsx`)
 * mounts this alone, and `App` is where the recorder is started, so it never
 * is here — and `voice.html`'s policy allows no network should that ever slip.
 */
export function VoiceHost(): React.JSX.Element {
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  useVoiceSession(remoteAudio, AVATAR_FEED);
  return (
    // Luke's own voice. Muted playback would defeat the point, so this is the
    // one element allowed to make sound.
    <audio ref={remoteAudio} autoPlay hidden>
      <track kind="captions" />
    </audio>
  );
}
