/**
 * call-commands.ts -- the standing call's mute chords, answering wherever the panel stands.
 */

import { VOICE_COMMAND, type VoiceCommand, type VoiceView } from "#shared/messages/voice-view";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "./app-commands";
import { planningCallInProgress } from "./planning/planning-model";

/**
 * The call's two mute chords, offered while a call is in progress wherever
 * the panel stands, on another plan, in Settings, or on the new-plan page,
 * since the call outlives the call bar that draws their buttons. Each is the
 * voice window's to carry out on the call standing, so neither names the
 * open plan.
 */
export function useCallCommands(
  view: Pick<VoiceView, "voiceStatus" | "callPlanId" | "speakerMuted">,
  send: (command: VoiceCommand) => void,
): void {
  const inProgress = planningCallInProgress(view);
  useAppCommand(
    APP_COMMAND.TOGGLE_MICROPHONE,
    inProgress ? () => send(VOICE_COMMAND.TOGGLE_MICROPHONE) : undefined,
  );
  useAppCommand(
    APP_COMMAND.TOGGLE_SPEAKER,
    inProgress
      ? () => send(view.speakerMuted ? VOICE_COMMAND.UNMUTE_SPEAKER : VOICE_COMMAND.MUTE_SPEAKER)
      : undefined,
  );
}
