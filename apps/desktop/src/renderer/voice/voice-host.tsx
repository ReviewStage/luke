import { useRef } from "react";
import { useVoiceSession } from "./use-voice-session";

/**
 * What the hidden voice window mounts: the live conversation, and the one
 * element Luke's voice plays through. Nothing drawn. This window is not the
 * panel and must not record, which is why it has a bundle of its own: `App`
 * and the session-replay client are unreachable from its entry rather than
 * merely unimported.
 */
export function VoiceHost(): React.JSX.Element {
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  useVoiceSession(remoteAudio);
  return (
    // Luke's own voice. Muted playback would defeat the point, so this is the
    // one element allowed to make sound.
    <audio ref={remoteAudio} autoPlay hidden>
      <track kind="captions" />
    </audio>
  );
}
