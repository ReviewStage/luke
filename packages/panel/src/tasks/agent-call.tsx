import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_SHAPE,
  BUTTON_VARIANT,
  CloseIcon,
  IconButton,
  MicrophoneIcon,
  MicrophoneOffIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  VideoIcon,
  VideoOffIcon,
  WaveformIcon,
} from "@luke/ui";
import { callStatus, MICROPHONE_PRESS, microphoneButton } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { AVATAR_STATUS } from "@luke/voice/avatar";
import {
  callInProgress,
  VOICE_COMMAND,
  type VoiceCommand,
  type VoiceView,
} from "@luke/voice/voice-view";
import { createContext, type ReactNode, useContext } from "react";
import { useAct } from "../act.js";
import { CALL_VIDEO_LABEL } from "../call/call-video-tile.js";
import { AgentCallVideo, useAgentCallVideo } from "../call/panel-avatar.js";
import { useOpenAiKeyMissing, useOpenApiKeys } from "../openai-key.js";
import { Tooltip } from "../tooltip.js";
import { APP_SLICE, useAppSlice, VOICE_AVAILABLE } from "../use-app-state.js";
import { useStandingVoiceView } from "../use-voice-view.js";
import { CALL_CONTROL_LABEL } from "./tasks-parts.js";

/**
 * agent-call.tsx -- an agent's tab taking calls: the call's controls in the composer's row, and while a call into the agent stands, Luke's video centred above the composer and the voice's notice line over it.
 *
 * One call stands on a Mac at a time, into one agent, and the voice window
 * holds it, so the controls and the foot read the voice as every window
 * does and hand each press to it. At rest the composer offers Call, a
 * waveform beside Dictate, which opens a call into the agent, asking first
 * where that hangs another agent's call up. On a call into the agent the
 * same place holds the call itself: the speaker and microphone mutes, Video
 * on or off where video is offered, and End call, the one red control, so
 * the composer is the one place the call is steered from. No line says
 * whether Luke is listening or thinking: the controls and the tab's live
 * mark say a call is up, and the transcript says what is said. A draft's
 * composer offers the same Call (`draft-agent-tab.tsx`), which starts its
 * agent and opens a call into it as it lands. A platform
 * with no voice, the web's, hands the tab no doors, and the tab draws
 * neither. The tab around them is left out of the screen recording
 * (`agent-tab.tsx`). An agent on a provider's own harness, Claude Code or
 * Codex, takes no call, since calls run on eve alone and the service
 * refuses one into it (`NATIVE_AGENT_NOT_HERE`), so its tab draws neither
 * (`takesCalls`). A call runs on the account's own OpenAI key, so with none
 * saved Call says to add one and its press opens Settings › Agents
 * (`../openai-key.tsx`).
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

/**
 * Where an agent pressed for stands, which its call names: the task it is
 * on, none for an agent with no task, and whether it is archived, which
 * takes no call; only an agent's own page draws an archived one.
 */
export interface AgentCallPlace {
  readonly taskId: string | undefined;
  readonly archived?: boolean;
}

/**
 * What a window takes calls through, for an agent wherever it is drawn: its
 * tab in a task's column or its own page, each naming where the agent
 * stands (`agent-actions.tsx`'s `useAgentCallDoors`); none where the
 * platform has no voice.
 */
export interface AgentCallPress {
  readonly onPress: (agentId: string, place: AgentCallPlace) => void;
}

/** Whether a call may go into the agent: one on eve, whose summary names no native runtime, and never one on Claude Code or Codex. */
export function takesCalls(agent: Pick<CodingAgentSummary, "runtime">): boolean {
  return agent.runtime === undefined;
}

/** The voice's notice line, which rides the foot of the tab of the agent the call speaks into; none where the window draws it elsewhere. */
export const CallNotice = createContext<ReactNode>(undefined);

/** What the group of a call's controls is named for a reader, since no line names the call any more. */
const CALL_CONTROLS_LABEL = "Call with Luke";

/**
 * Whether a call into the agent stands: in progress, or connecting or
 * closing, which the voice still names a status for, as a fixture's staged
 * call does.
 */
function onCallInto(view: Pick<VoiceView, "voiceStatus" | "call">, agentId: string): boolean {
  if (view.call?.agentId !== agentId) return false;
  return callInProgress(view) || callStatus(view, undefined, agentId) !== undefined;
}

/** Whether a call into the agent stands now, which the composer reads to hand its microphone's place to the call. */
export function useAgentOnCall(agentId: string): boolean {
  return onCallInto(useStandingVoiceView(), agentId);
}

/** The Call button's look for the agent, as the voice and the microphone stand now (`microphoneButton`). */
function useCallButton(agentId: string) {
  const view = useStandingVoiceView();
  const voiceAvailable = useAppSlice(VOICE_AVAILABLE);
  const openAiKeyMissing = useOpenAiKeyMissing();
  const microphoneStatus =
    useAppSlice(APP_SLICE.AUDIO)?.microphoneStatus ?? MICROPHONE_STATUS.NOT_DETERMINED;
  return {
    view,
    button: microphoneButton({
      voiceAvailable,
      microphoneStatus,
      agentId,
      listening: view.listening,
      call: view.call,
      voiceStatus: view.voiceStatus,
      openAiKeyMissing,
    }),
  };
}

/** A mute in the composer's row: its glyph struck through, and on the danger tint, while it is on. */
function CallMute({
  on,
  label,
  command,
  icon,
  onPress,
}: {
  on: boolean;
  label: string;
  command: typeof APP_COMMAND.TOGGLE_MICROPHONE | typeof APP_COMMAND.TOGGLE_SPEAKER;
  icon: React.JSX.Element;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={label} command={command}>
      <IconButton
        variant={BUTTON_VARIANT.DANGER}
        icon={icon}
        label={label}
        pressed={on}
        onClick={onPress}
      />
    </Tooltip>
  );
}

/**
 * Video on or off in the composer's row, wherever video is offered on the
 * call: its glyph says whether the video is up, as the mutes' say whether
 * they are on, and its name what the press will do.
 */
function CallVideoButton({ agentId }: { agentId: string }): React.JSX.Element | null {
  const { status, onSetVideo } = useAgentCallVideo(agentId);
  if (status === undefined) return null;
  const on = status !== AVATAR_STATUS.OFF;
  const label = on ? CALL_VIDEO_LABEL.VIDEO_OFF : CALL_VIDEO_LABEL.VIDEO_ON;
  return (
    <Tooltip label={label}>
      <IconButton
        icon={on ? <VideoIcon /> : <VideoOffIcon />}
        label={label}
        onClick={() => onSetVideo(!on)}
      />
    </Tooltip>
  );
}

/**
 * Call at rest, the waveform: for the agent `subject` names, or a draft's
 * key, which no call speaks into, so its look is Call's or the
 * microphone's ask. Unavailable where the voice or the microphone cannot
 * take a call, or while `busy`. With no OpenAI key saved its press opens
 * Settings › Agents in place of `onPress`, wherever it is drawn.
 */
export function CallButton({
  subject,
  busy = false,
  onPress,
}: {
  subject: string;
  busy?: boolean | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const { button } = useCallButton(subject);
  const openApiKeys = useOpenApiKeys();
  return (
    <span className="agent-call-button">
      <Tooltip label={button.label}>
        <IconButton
          icon={<WaveformIcon />}
          label={button.label}
          disabled={busy || button.press === MICROPHONE_PRESS.NONE}
          onClick={button.press === MICROPHONE_PRESS.ADD_OPENAI_KEY ? openApiKeys : onPress}
        />
      </Tooltip>
    </span>
  );
}

/**
 * The call's place in an agent's composer row, beside Send. At rest it is
 * Call, the waveform. On a call into the agent it is the call: the speaker
 * and the microphone, each struck through and tinted while muted, Video on
 * or off, and End call apart from them on its red disc, so muting never
 * hangs up. The microphone's press is the Call press itself, which mutes
 * and unmutes the agent's own call, so the talk key and the permission asks
 * answer as they always have; the speaker silences Luke on this Mac alone.
 * The two mutes' chords are not the row's to offer: they answer while any
 * call is in progress, wherever the panel stands (`useCallCommands`).
 */
export function AgentCallControls({
  agentId,
  doors,
}: {
  agentId: string;
  doors: AgentCallDoors;
}): React.JSX.Element {
  const { tell } = useAct();
  const { view, button } = useCallButton(agentId);
  if (!onCallInto(view, agentId)) {
    return <CallButton subject={agentId} onPress={() => doors.onPress(agentId)} />;
  }
  // The speaker and the end are the voice window's to carry out: it plays Luke and holds the call.
  const command = (sent: VoiceCommand) => tell(ACT_KIND.VOICE_COMMAND, { command: sent });
  return (
    <fieldset className="agent-call-controls" aria-label={CALL_CONTROLS_LABEL}>
      <CallMute
        on={view.speakerMuted}
        label={
          view.speakerMuted ? CALL_CONTROL_LABEL.UNMUTE_SPEAKER : CALL_CONTROL_LABEL.MUTE_SPEAKER
        }
        command={APP_COMMAND.TOGGLE_SPEAKER}
        icon={view.speakerMuted ? <SpeakerOffIcon /> : <SpeakerIcon />}
        onPress={() =>
          command(view.speakerMuted ? VOICE_COMMAND.UNMUTE_SPEAKER : VOICE_COMMAND.MUTE_SPEAKER)
        }
      />
      <CallMute
        on={button.muted}
        label={
          button.muted ? CALL_CONTROL_LABEL.UNMUTE_MICROPHONE : CALL_CONTROL_LABEL.MUTE_MICROPHONE
        }
        command={APP_COMMAND.TOGGLE_MICROPHONE}
        icon={button.muted ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
        onPress={() => doors.onPress(agentId)}
      />
      <CallVideoButton agentId={agentId} />
      <Tooltip label={CALL_CONTROL_LABEL.END_CALL}>
        <IconButton
          variant={BUTTON_VARIANT.DANGER}
          shape={BUTTON_SHAPE.ROUND}
          icon={<CloseIcon />}
          label={CALL_CONTROL_LABEL.END_CALL}
          onClick={() => command(VOICE_COMMAND.END_CALL)}
        />
      </Tooltip>
    </fieldset>
  );
}

/**
 * What an agent's tab's foot draws while a call into the agent stands:
 * Luke's video in a room of its own between the transcript and the
 * composer, centred there, which the transcript ends above
 * (`AgentCallVideo`), and the voice's notice line floating just over that
 * room's top edge, so a failure is read where the call is steered from and
 * never stands on the video. Nothing while no call into the agent stands,
 * so the room goes as the call ends, and goes too while video is off.
 */
export function AgentCallFoot({ agentId }: { agentId: string }): React.JSX.Element | null {
  const notice = useContext(CallNotice);
  const onCall = useAgentOnCall(agentId);
  if (!onCall) return null;
  return (
    <div className="agent-call-foot">
      {notice === undefined ? null : <div className="agent-call-notice">{notice}</div>}
      <AgentCallVideo agentId={agentId} />
    </div>
  );
}
