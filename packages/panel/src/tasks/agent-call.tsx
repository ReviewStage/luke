import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { CallIcon, IconButton } from "@luke/ui";
import { callStatus, MICROPHONE_PRESS, microphoneButton } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { callInProgress, VOICE_COMMAND } from "@luke/voice/voice-view";
import { createContext, type ReactNode, useContext } from "react";
import { useAct } from "../act.js";
import { AgentCallVideo } from "../call/panel-avatar.js";
import { Tooltip } from "../tooltip.js";
import { APP_SLICE, useAppSlice, VOICE_AVAILABLE } from "../use-app-state.js";
import { useStandingVoiceView } from "../use-voice-view.js";
import { CallBar } from "./tasks-parts.js";

/**
 * agent-call.tsx -- an agent's tab taking calls: the Call button beside Dictate, and while a call into the agent stands, its video, captions, and call bar at the tab's foot.
 *
 * One call stands on a Mac at a time, into one agent, and the voice window
 * holds it, so the button and the foot read the voice as every window does
 * and hand each press to it. The Call button toggles, as the call bar's
 * microphone does: it opens a call into the agent, asking first where that
 * hangs another agent's call up, or mutes and unmutes the agent's own. A
 * platform with no voice, the web's, hands the tab no doors, and the tab
 * draws neither. The call bar draws the call's words and nobody's
 * conversation, and the captions ride it as they rode the task's call bar;
 * the tab around them is left out of the screen recording (`agent-tab.tsx`).
 * An agent on a provider's own harness, Claude Code or Codex, takes no call,
 * since calls run on eve alone and the service refuses one into it
 * (`NATIVE_AGENT_NOT_HERE`), so its tab draws neither (`takesCalls`).
 */

/** What an agent's tab is handed to take calls; none where the platform has no voice. */
export interface AgentCallDoors {
  /**
   * An agent's Call press: the microphone asked for where it must be, else a
   * call into the agent opened, or its own muted or heard again, asking
   * first where it would hang another agent's call up.
   */
  readonly onPress: (agentId: string) => void;
}

/** Whether a call may go into the agent: one on eve, whose summary names no native runtime, and never one on Claude Code or Codex. */
export function takesCalls(agent: Pick<CodingAgentSummary, "runtime">): boolean {
  return agent.runtime === undefined;
}

/** The live captions, which ride the foot of the tab of the agent the call speaks into; none where the window draws them elsewhere. */
export const CallCaptions = createContext<ReactNode>(undefined);

/** The Call button's look for the agent, as the voice and the microphone stand now (`microphoneButton`). */
function useCallButton(agentId: string, archived: boolean) {
  const view = useStandingVoiceView();
  const voiceAvailable = useAppSlice(VOICE_AVAILABLE);
  const microphoneStatus =
    useAppSlice(APP_SLICE.AUDIO)?.microphoneStatus ?? MICROPHONE_STATUS.NOT_DETERMINED;
  return {
    view,
    button: microphoneButton({
      voiceAvailable,
      microphoneStatus,
      agentId,
      archived,
      listening: view.listening,
      call: view.call,
      voiceStatus: view.voiceStatus,
    }),
  };
}

/**
 * The Call button at an agent's composer's foot, beside Dictate: drawn while
 * no call into the agent is in progress, since the call bar's own
 * microphone and End call stand in its place while one is.
 */
export function AgentCallButton({
  agentId,
  archived,
  doors,
}: {
  agentId: string;
  archived: boolean;
  doors: AgentCallDoors;
}): React.JSX.Element | null {
  const { view, button } = useCallButton(agentId, archived);
  if (callInProgress(view) && view.call?.agentId === agentId) return null;
  return (
    <span className="agent-call-button">
      <Tooltip label={button.label}>
        <IconButton
          icon={<CallIcon />}
          label={button.label}
          disabled={button.press === MICROPHONE_PRESS.NONE}
          onClick={() => doors.onPress(agentId)}
        />
      </Tooltip>
    </span>
  );
}

/**
 * What an agent's tab's foot draws over its composer while a call into the
 * agent is in progress: the avatar's video, the captions, and the call bar,
 * its status at the left and the speaker, the microphone, and End call at
 * its right. Nothing while no call into the agent stands.
 */
export function AgentCallFoot({
  agentId,
  archived,
  doors,
}: {
  agentId: string;
  archived: boolean;
  doors: AgentCallDoors;
}): React.JSX.Element | null {
  const { tell } = useAct();
  const { view, button } = useCallButton(agentId, archived);
  const captions = useContext(CallCaptions);
  const activity = useAppSlice(APP_SLICE.TASKS)?.activity;
  const live = callInProgress(view) && view.call?.agentId === agentId;
  const status = callStatus(view, activity, agentId);
  if (!live && status === undefined) return null;
  return (
    <div className="agent-call-foot">
      <AgentCallVideo agentId={agentId} />
      {captions}
      <CallBar
        status={status}
        microphone={{
          label: button.label,
          enabled: button.press !== MICROPHONE_PRESS.NONE,
          muted: button.muted,
          onPress: () => doors.onPress(agentId),
        }}
        // The speaker is the voice window's to silence, since it plays Luke.
        speaker={{
          muted: view.speakerMuted,
          onPress: () =>
            tell(ACT_KIND.VOICE_COMMAND, {
              command: view.speakerMuted
                ? VOICE_COMMAND.UNMUTE_SPEAKER
                : VOICE_COMMAND.MUTE_SPEAKER,
            }),
        }}
        // The stop is the voice window's to carry out: it holds the call.
        stop={{
          shown: live,
          onPress: () => tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.END_CALL }),
        }}
      />
    </div>
  );
}
