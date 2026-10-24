import { ACT_KIND } from "@luke/host/acts";
import { LIVE_STATUS, type LiveStatus } from "@luke/live";
import {
  BUTTON_SHAPE,
  CALL_DEVICE,
  CALL_STAGE,
  CallLive,
  CallMute,
  type CallStage,
  EndCallButton,
  IconButton,
  Tooltip,
  VIDEO_TOGGLE_LOOK,
  VideoToggle,
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
import { useState } from "react";
import { useAct } from "../act.js";
import { AgentCallVideo, useAgentCallVideo } from "../call/panel-avatar.js";
import { useOpenAiKeyMissing, useOpenApiKeys } from "../openai-key.js";
import { APP_SLICE, useAppSlice, VOICE_AVAILABLE } from "../use-app-state.js";
import { useMicrophoneGranted, useStandingVoiceView, useVoiceLost } from "../use-voice-view.js";

/**
 * agent-call.tsx -- an agent's tab taking calls: the call's status and controls in the composer's foot, and while a call into the agent stands, Luke's video centred above the composer.
 *
 * One call stands on a Mac at a time, into one agent, and the voice window
 * holds it, so the controls and the foot read the voice as every window
 * does and hand each press to it. At rest the composer offers Call, a
 * waveform beside Dictate, which opens a call into the agent, asking first
 * where that hangs another agent's call up. On a call into the agent the
 * same place holds the call itself: its status, a live mark, "On call" or
 * "Muted", and how long it has run, then the speaker and microphone mutes,
 * Video on or off where video is offered, and End call, the one red
 * control wearing the hang-up glyph, so the composer is the one place the
 * call is read and steered from. No line says whether Luke is listening or
 * thinking: the status and the tab's live mark say a call is up, and the
 * transcript says what is said. The voice's notices are toasts, as every
 * window's are (`voice-notice-toast.ts`). A draft's
 * composer offers the same Call (`draft-agent-tab.tsx`), which starts its
 * agent and opens a call into it as it lands. A platform
 * with no voice, the web's, hands the tab no doors, and the tab draws
 * neither. The tab around them is left out of the screen recording
 * (`agent-tab.tsx`). An agent on a provider's own harness, Claude Code or
 * Codex, takes a call as an eve one does: the call's asks reach its runner.
 * A call runs on the account's own OpenAI key, so with none saved Call says
 * to add one and its press opens Settings › Agents (`../openai-key.tsx`).
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
  const voiceLost = useVoiceLost();
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
      voiceLost,
    }),
  };
}

/**
 * Video on or off in the composer's row, wherever video is offered on the
 * call: the call's own toggle, square beside the row's mutes.
 */
function CallVideoButton({ agentId }: { agentId: string }): React.JSX.Element | null {
  const { status, onSetVideo } = useAgentCallVideo(agentId);
  if (status === undefined) return null;
  return (
    <VideoToggle
      on={status !== AVATAR_STATUS.OFF}
      onSetVideo={onSetVideo}
      look={VIDEO_TOGGLE_LOOK.COMPOSER_ROW}
    />
  );
}

/**
 * Where the call stands by the voice's status: coming up while it
 * connects, up while it listens, speaks, or is muted, and going down while
 * it closes or once it failed, which no call into the agent draws long.
 */
const CALL_STAGE_OF = {
  [LIVE_STATUS.UNAVAILABLE]: CALL_STAGE.ENDING,
  [LIVE_STATUS.IDLE]: CALL_STAGE.ENDING,
  [LIVE_STATUS.CONNECTING]: CALL_STAGE.CONNECTING,
  [LIVE_STATUS.MUTED]: CALL_STAGE.LIVE,
  [LIVE_STATUS.LISTENING]: CALL_STAGE.LIVE,
  [LIVE_STATUS.SPEAKING]: CALL_STAGE.LIVE,
  [LIVE_STATUS.CLOSING]: CALL_STAGE.ENDING,
  [LIVE_STATUS.FAILED]: CALL_STAGE.ENDING,
} as const satisfies Record<LiveStatus, CallStage>;

/**
 * An up call's status, counted from `startedAt`, the moment the
 * transcript's Call started marker says, where the call's first line has
 * been heard. Note that before that line the count runs from when this tab
 * first saw the call up, because the voice reports no start of its own,
 * and a status with no count would not say how long the call has run.
 */
function UpCallStatus({
  startedAt,
  muted,
}: {
  startedAt: number | undefined;
  muted: boolean;
}): React.JSX.Element {
  const [seen] = useState(Date.now);
  return <CallLive stage={CALL_STAGE.LIVE} startedAt={startedAt ?? seen} muted={muted} />;
}

/** The call's status: "Connecting…" or "Ending…" either side of it, and between them the call up and how long it has run. */
function AgentCallStatus({
  status,
  startedAt,
  muted,
}: {
  status: LiveStatus;
  startedAt: number | undefined;
  muted: boolean;
}): React.JSX.Element {
  const stage = CALL_STAGE_OF[status];
  if (stage !== CALL_STAGE.LIVE) return <CallLive stage={stage} />;
  return <UpCallStatus startedAt={startedAt} muted={muted} />;
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
 * Call, the waveform. On a call into the agent it is the call: its status,
 * then the speaker and the microphone, each struck through and tinted while
 * muted, Video on or off, and End call apart from them on its red disc, so
 * muting never hangs up. The microphone's press is the Call press itself, which mutes
 * and unmutes the agent's own call, so the talk key and the permission asks
 * answer as they always have; the speaker silences Luke on this Mac alone.
 * The two mutes' chords are not the row's to offer: they answer while any
 * call is in progress, wherever the panel stands (`useCallCommands`).
 */
export function AgentCallControls({
  agentId,
  doors,
  startedAt,
}: {
  agentId: string;
  doors: AgentCallDoors;
  /** When the call standing into the agent started, as its transcript row says; none before its first line is heard. */
  startedAt: number | undefined;
}): React.JSX.Element {
  const { press } = useAct();
  const { view, button } = useCallButton(agentId);
  const microphoneGranted = useMicrophoneGranted();
  if (!onCallInto(view, agentId)) {
    return <CallButton subject={agentId} onPress={() => doors.onPress(agentId)} />;
  }
  // The speaker and the end are the voice window's to carry out: it plays Luke and holds the call.
  const command = (sent: VoiceCommand) => press(ACT_KIND.VOICE_COMMAND, { command: sent });
  return (
    <fieldset className="agent-call-controls" aria-label={CALL_CONTROLS_LABEL}>
      <AgentCallStatus status={view.voiceStatus} startedAt={startedAt} muted={button.muted} />
      <CallMute
        device={CALL_DEVICE.SPEAKER}
        shape={BUTTON_SHAPE.SQUARE}
        muted={view.speakerMuted}
        onPress={() =>
          command(view.speakerMuted ? VOICE_COMMAND.UNMUTE_SPEAKER : VOICE_COMMAND.MUTE_SPEAKER)
        }
      />
      <CallMute
        device={CALL_DEVICE.MICROPHONE}
        shape={BUTTON_SHAPE.SQUARE}
        muted={button.muted}
        offered={microphoneGranted}
        onPress={() => doors.onPress(agentId)}
      />
      <CallVideoButton agentId={agentId} />
      <EndCallButton onPress={() => command(VOICE_COMMAND.END_CALL)} />
    </fieldset>
  );
}

/**
 * What an agent's tab's foot draws while a call into the agent stands:
 * Luke's video in a room of its own between the transcript and the
 * composer, centred there, which the transcript ends above
 * (`AgentCallVideo`). Nothing while no call into the agent stands, so the
 * room goes as the call ends, and goes too while video is off.
 */
export function AgentCallFoot({ agentId }: { agentId: string }): React.JSX.Element | null {
  const onCall = useAgentOnCall(agentId);
  if (!onCall) return null;
  return (
    <div className="agent-call-foot">
      <AgentCallVideo agentId={agentId} />
    </div>
  );
}
