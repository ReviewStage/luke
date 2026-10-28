/**
 * call-card-model.ts -- what the call card and its call bar say about the standing call.
 *
 * The card draws no words of the conversation: the call's task by name, or
 * its agent's for a call into an agent with no task, over
 * the call bar's own status and mutes. Everything here is read off the
 * document the card is handed, in the call bar's own terms, so the card and
 * the bar can never disagree about the call they draw.
 */

import { agentName } from "@luke/features/model-label";
import {
  type TaskActivity,
  type TasksView,
  VOICE_PHASE,
  type VoicePhase,
} from "@luke/features/tasks-view";
import { LIVE_STATUS, type LiveStatus } from "@luke/live";
import type { VoiceCallAbout, VoiceView } from "@luke/voice/voice-view";

/** The task's name where the document has none to give, which a task just started can briefly be. */
const CALL_CARD_UNNAMED = "Call";

export interface CallCardModel {
  readonly taskName: string;
  /** The call bar's own two lines for the standing call, which the card draws in the same bar. */
  readonly status: CallStatus | undefined;
  /** Whether the developer is not being heard on a call that could hear them. */
  readonly microphoneMuted: boolean;
}

/** The call's task by name, from the list or the task open, whichever holds it; or its agent's, as its row names it, where it has no task. */
function callTaskName(tasks: TasksView, call: VoiceCallAbout | undefined): string {
  if (call !== undefined && call.taskId === undefined) {
    const agent = tasks.tasklessAgents?.find((each) => each.id === call.agentId);
    return agent === undefined ? CALL_CARD_UNNAMED : agentName(agent);
  }
  const taskId = call?.taskId;
  const open = tasks.document.task;
  const named =
    tasks.tasks.find((task) => task.id === taskId)?.name ??
    (open !== undefined && open.id === taskId ? open.name : undefined);
  return named === undefined || named === "" ? CALL_CARD_UNNAMED : named;
}

export function callCard(input: {
  view: Pick<VoiceView, "voiceStatus" | "lukeSpeaking" | "listening" | "call">;
  tasks: TasksView;
}): CallCardModel {
  const { view, tasks } = input;
  return {
    taskName: callTaskName(tasks, view.call),
    status: standingCallStatus(view, tasks.callActivity),
    microphoneMuted: !view.listening && view.voiceStatus !== LIVE_STATUS.CONNECTING,
  };
}

/** The status word beside the microphone for a call, or nothing where none stands. */
const STATUS_WORD = {
  [LIVE_STATUS.UNAVAILABLE]: undefined,
  [LIVE_STATUS.IDLE]: undefined,
  [LIVE_STATUS.CONNECTING]: "Connecting",
  [LIVE_STATUS.MUTED]: "Muted",
  [LIVE_STATUS.LISTENING]: "Listening",
  [LIVE_STATUS.SPEAKING]: "Speaking",
  [LIVE_STATUS.CLOSING]: "Closing",
  [LIVE_STATUS.FAILED]: "Call failed",
} as const satisfies Record<LiveStatus, string | undefined>;

/** The voice's word for each of its waits the service names, in place of the call's own. */
const VOICE_PHASE_WORD = {
  [VOICE_PHASE.HANDING_OFF]: "Handing off",
  [VOICE_PHASE.ABOUT_TO_ANSWER]: "About to answer",
} as const satisfies Record<VoicePhase, string>;

/** The statuses whose own word gives way to the voice's wait: Luke is not speaking, and the call is not opening or closing. */
const VOICE_PHASE_SHOWN: ReadonlySet<LiveStatus> = new Set([
  LIVE_STATUS.MUTED,
  LIVE_STATUS.LISTENING,
]);

/**
 * A call as its call bar draws it: the voice's word, and the backend's line,
 * which is the agent while it works, with its pending command where it has
 * one.
 */
export interface CallStatus {
  voiceWord: string;
  backend: { agent: { action: string | undefined } | undefined };
}

/**
 * The standing call's two lines whichever agent it speaks into, read off
 * that call's own activity: the call bar's words, which the call card draws.
 * A voice error or notice is not repeated here. The voice line is the call's
 * status, except that a listening or muted call reads the wait the service
 * says the voice is in; speaking, connecting, and closing keep their own
 * word, since each says more.
 */
export function standingCallStatus(
  view: Pick<VoiceView, "voiceStatus">,
  activity: TaskActivity | undefined,
): CallStatus | undefined {
  const word = STATUS_WORD[view.voiceStatus];
  if (word === undefined) return undefined;
  const phase = VOICE_PHASE_SHOWN.has(view.voiceStatus) ? activity?.voice : undefined;
  const agent = activity?.planner;
  return {
    voiceWord: phase === undefined ? word : VOICE_PHASE_WORD[phase],
    backend: {
      agent: agent === undefined ? undefined : { action: agent.action },
    },
  };
}

/** What the call's microphone mute says while the developer is heard on the call. */
export const MUTE_MICROPHONE_LABEL = "Mute microphone";

/** What the call's microphone mute says while the developer is not heard on the call. */
export const UNMUTE_MICROPHONE_LABEL = "Unmute microphone";
