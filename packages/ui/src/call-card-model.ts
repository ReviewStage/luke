/**
 * call-card-model.ts -- what the call card, the call bar, and an agent's Call button say about the standing call, and where the card is drawn.
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
import { VOICE_FAILURE, VOICE_FAILURE_WORDS } from "@luke/features/words";
import { LIVE_STATUS, type LiveStatus } from "@luke/live";
import { MICROPHONE_STATUS, type MicrophoneStatus } from "@luke/settings/microphone";
import { callInProgress, type VoiceCallAbout, type VoiceView } from "@luke/voice/voice-view";
import {
  microphoneAccessRow,
  OPENAI_KEY_MISSING_NOTE,
  VOICE_KEYLESS_NOTE,
} from "./microphone-access.js";

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
export function callTaskName(tasks: TasksView, call: VoiceCallAbout | undefined): string {
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

/**
 * The agent whose call bar this window has on screen, or none: the Tasks tab
 * on an agent's own page, which draws its agent's call bar as its tab would,
 * or on a task's document with that agent's tab chosen in its column, unless
 * its version history, the window's Inbox, an agent's page, or a side panel
 * filling the window covers the column the agent's tab stands in.
 */
export function callBarAgentId(input: {
  tasksTab: boolean;
  documentPage: boolean;
  historyOpen: boolean;
  inboxOpen: boolean;
  /** The agent whose own page stands in the plan's place; none while no agent's page does. */
  pageAgentId: string | undefined;
  sidePanelFullScreen: boolean;
  /** The agent whose tab the open task's column has chosen; none with no agent tab. */
  columnAgentId: string | undefined;
}): string | undefined {
  if (!input.tasksTab || input.inboxOpen || input.sidePanelFullScreen) return undefined;
  if (input.pageAgentId !== undefined) return input.pageAgentId;
  return input.documentPage && !input.historyOpen ? input.columnAgentId : undefined;
}

/**
 * Whether a Luke window draws the card: a call in progress, the window has
 * the keyboard, and the agent tab it shows is not the call's, where the call
 * bar already is. A window without the keyboard leaves the call to the
 * floating window, so the call is drawn in one place at a time.
 */
export function callCardShown(input: {
  view: Pick<VoiceView, "voiceStatus" | "call">;
  focused: boolean;
  agentShown: string | undefined;
}): boolean {
  const { view, focused, agentShown } = input;
  return focused && callInProgress(view) && agentShown !== view.call?.agentId;
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
 * An agent's call as its tab's call bar draws it: the voice's word, and the
 * backend's line, which is the agent while it works, with its pending
 * command where it has one.
 */
export interface CallStatus {
  voiceWord: string;
  backend: { agent: { action: string | undefined } | undefined };
}

/**
 * The call bar's two lines while a call into the agent stands, and nothing
 * otherwise. A voice error or notice is not repeated here, since
 * the panel's own strip already carries it under the shape, exactly as it
 * does for any call. The voice line is the call's status, except that a
 * listening or muted call reads the wait the service says the voice is in;
 * speaking, connecting, and closing keep their own word, since each says
 * more. The backend line is each backend part's own, so neither stands in
 * for the voice.
 */
export function callStatus(
  view: Pick<VoiceView, "voiceStatus" | "call">,
  activity: TaskActivity | undefined,
  agentId: string,
): CallStatus | undefined {
  if (view.call?.agentId !== agentId) return undefined;
  return standingCallStatus(view, activity);
}

/**
 * The standing call's two lines whichever agent it speaks into, read off
 * that call's own activity: the call bar's words, which the call card draws
 * in the same bar while the call's agent is off screen.
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

/** What an agent's Call button does when pressed. */
export const MICROPHONE_PRESS = {
  /** Nothing: voice cannot run, or the agent is archived. */
  NONE: "none",
  /** Raises macOS's own microphone prompt. */
  ASK_ACCESS: "ask-access",
  /** Opens System Settings, the one place a denial can be changed. */
  OPEN_SETTINGS: "open-settings",
  /** Opens Settings › Agents, where the OpenAI API key a call runs on is saved. */
  ADD_OPENAI_KEY: "add-openai-key",
  /** Talks to the agent: opens a call into it and hears it, or toggles its call's microphone. */
  TALK: "talk",
} as const;

type MicrophonePress = (typeof MICROPHONE_PRESS)[keyof typeof MICROPHONE_PRESS];

export interface MicrophoneButton {
  readonly press: MicrophonePress;
  /** The button's name for a reader and its hover. */
  readonly label: string;
  /** Whether the agent's call stands with the developer not heard, which the button draws struck through. */
  readonly muted: boolean;
}

/** What the Call button says on an archived agent, which no call speaks into. */
const ARCHIVED_CALL_LABEL = "Unarchive the agent to call it";

/** What the Call button says while the developer is heard on the call, and what a mute's own control says: one wording for the press wherever it stands. */
export const MUTE_MICROPHONE_LABEL = "Mute microphone";

/** What the Call button says while the developer is not heard on the call. */
export const UNMUTE_MICROPHONE_LABEL = "Unmute microphone";

/** What the Call button says where a press opens a call into its agent. */
export const CALL_LABEL = "Call";

/** The statuses of a call that has a session, the ones whose microphone is either heard or muted. */
const CALL_STANDING: ReadonlySet<LiveStatus> = new Set([
  LIVE_STATUS.MUTED,
  LIVE_STATUS.LISTENING,
  LIVE_STATUS.SPEAKING,
]);

/**
 * An agent's Call button, and its call bar's microphone, from what voice can
 * run on and which agent the call speaks into. The microphone permission
 * comes first, on the panel's own rules, because a press that cannot be
 * heard is no press. The press toggles: while the developer is heard on
 * this agent's own call it mutes, and otherwise it opens a call into the
 * agent or hears it again, hanging up another agent's first, which is also
 * how a call that failed or was lost is tried again. Muted is this agent's
 * own call standing with the developer not heard, so the button says so
 * rather than reading as a call not yet begun. An archived agent takes no
 * call, so its press is none until it is brought back; a call of its own
 * still standing, which only a race leaves, is still muted and heard again.
 * A call runs on the account's own OpenAI key, so an account known to have
 * none is sent to save one before anything else, even the microphone, which
 * is worth asking for only once a call can run; a call of the agent's own
 * still standing keeps its mute. A voice window given up on runs no call for
 * the rest of the run, so the button says that, and how to get voice back,
 * in place of a press that would reach nothing.
 */
export function microphoneButton(input: {
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  /** The agent whose tab the button stands in. */
  agentId: string;
  /** Whether the agent is archived; only its own page's press names it, since an archived agent draws no Call. */
  archived?: boolean;
  listening: boolean;
  /** What the standing call speaks into, as the voice window reports it. */
  call: VoiceCallAbout | undefined;
  voiceStatus: LiveStatus;
  /** Whether the account is known to have no OpenAI API key; unknown is not missing. */
  openAiKeyMissing?: boolean;
  /** Whether the voice window was given up on for this run, so no call can run until Luke is reopened. */
  voiceLost?: boolean;
}): MicrophoneButton {
  if (!input.voiceAvailable) {
    return { press: MICROPHONE_PRESS.NONE, label: VOICE_KEYLESS_NOTE, muted: false };
  }
  if (input.voiceLost === true) {
    const { words } = VOICE_FAILURE_WORDS[VOICE_FAILURE.VOICE_WINDOW_LOST];
    return { press: MICROPHONE_PRESS.NONE, label: words, muted: false };
  }
  const ownCall = input.call?.agentId === input.agentId;
  const ownCallStands = ownCall && (input.listening || CALL_STANDING.has(input.voiceStatus));
  if (input.openAiKeyMissing === true && !ownCallStands) {
    return { press: MICROPHONE_PRESS.ADD_OPENAI_KEY, label: OPENAI_KEY_MISSING_NOTE, muted: false };
  }
  const row = microphoneAccessRow({ voiceAvailable: true, status: input.microphoneStatus });
  if (row.offerAccess) {
    return { press: MICROPHONE_PRESS.ASK_ACCESS, label: "Allow the microphone", muted: false };
  }
  if (input.microphoneStatus === MICROPHONE_STATUS.DENIED) {
    return {
      press: MICROPHONE_PRESS.OPEN_SETTINGS,
      label: "Allow the microphone in System Settings",
      muted: false,
    };
  }
  if (!row.ready) {
    return { press: MICROPHONE_PRESS.NONE, label: row.detail ?? VOICE_KEYLESS_NOTE, muted: false };
  }
  if (ownCall && input.listening) {
    return { press: MICROPHONE_PRESS.TALK, label: MUTE_MICROPHONE_LABEL, muted: false };
  }
  if (ownCall && CALL_STANDING.has(input.voiceStatus)) {
    return { press: MICROPHONE_PRESS.TALK, label: UNMUTE_MICROPHONE_LABEL, muted: true };
  }
  if (input.archived === true) {
    return { press: MICROPHONE_PRESS.NONE, label: ARCHIVED_CALL_LABEL, muted: false };
  }
  return { press: MICROPHONE_PRESS.TALK, label: CALL_LABEL, muted: false };
}
