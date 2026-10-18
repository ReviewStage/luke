/**
 * call-commands.ts -- the standing call's mute chords, answering wherever the panel stands.
 */

import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  callInProgress,
  VOICE_COMMAND,
  type VoiceCommand,
  type VoiceView,
} from "@luke/voice/voice-view";
import { useAppCommand } from "./app-commands.js";

/**
 * The call's two mute chords, offered while a call is in progress wherever
 * the panel stands, on another task, in Settings, or on the home page,
 * since the call outlives the call bar that draws their buttons. Each is the
 * voice window's to carry out on the call standing, so neither names the
 * open task. The microphone's waits on the system's permission, as the call
 * bar's button does: a microphone macOS refuses is unmuted in System
 * Settings, not by a chord.
 */
export function useCallCommands(
  view: Pick<VoiceView, "voiceStatus" | "callTaskId" | "speakerMuted">,
  microphoneGranted: boolean,
  send: (command: VoiceCommand) => void,
): void {
  const inProgress = callInProgress(view);
  useAppCommand(
    APP_COMMAND.TOGGLE_MICROPHONE,
    inProgress && microphoneGranted ? () => send(VOICE_COMMAND.TOGGLE_MICROPHONE) : undefined,
  );
  useAppCommand(
    APP_COMMAND.TOGGLE_SPEAKER,
    inProgress
      ? () => send(view.speakerMuted ? VOICE_COMMAND.UNMUTE_SPEAKER : VOICE_COMMAND.MUTE_SPEAKER)
      : undefined,
  );
}
