/**
 * call-card-model.ts -- what the call card says about the standing call, and where it is drawn.
 *
 * The card draws no words of the conversation: the call's task by name, or
 * its agent's for a call into an agent with no task, over
 * the call bar's own status and mutes. Everything here is read off the
 * document the card is handed, in the call bar's own terms, so the card and
 * the bar can never disagree about the call they draw.
 */

import { agentName } from "@luke/features/model-label";
import type { TasksView } from "@luke/features/tasks-view";
import { LIVE_STATUS } from "@luke/live";
import { callInProgress, type VoiceCallAbout, type VoiceView } from "@luke/voice/voice-view";
import { type CallStatus, standingCallStatus } from "./tasks-model.js";

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
