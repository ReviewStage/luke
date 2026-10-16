/**
 * call-card-model.ts -- what the call card says about the standing call, and where it is drawn.
 *
 * The card draws no words of the conversation: the call's plan by name over
 * the call bar's own status and mutes. Everything here is read off the
 * document the card is handed, in the call bar's own terms, so the card and
 * the bar can never disagree about the call they draw.
 */

import type { TasksView } from "@luke/features/tasks-view";
import { LIVE_STATUS } from "@luke/live";
import {
  AVATAR_STATUS,
  type AvatarState,
  type AvatarStatus,
  avatarStanding,
  avatarTiled,
} from "@luke/voice/avatar";
import { callInProgress, type VoiceView } from "@luke/voice/voice-view";
import { type CallStatus, standingCallStatus } from "./tasks-model.js";

/** The plan's name where the document has none to give, which a plan just started can briefly be. */
const CALL_CARD_UNNAMED = "Planning call";

export interface CallCardModel {
  readonly taskName: string;
  /** The call bar's own two lines for the standing call, which the card draws in the same bar. */
  readonly status: CallStatus | undefined;
  /** Whether the developer is not being heard on a call that could hear them. */
  readonly microphoneMuted: boolean;
}

/** The call's plan by name, from the list or the plan open, whichever holds it. */
function taskNameOf(tasks: TasksView, taskId: string | undefined): string {
  const open = tasks.document.task;
  const named =
    tasks.tasks.find((task) => task.id === taskId)?.name ??
    (open !== undefined && open.id === taskId ? open.name : undefined);
  return named === undefined || named === "" ? CALL_CARD_UNNAMED : named;
}

export function callCard(input: {
  view: Pick<VoiceView, "voiceStatus" | "lukeSpeaking" | "listening" | "callTaskId">;
  tasks: TasksView;
}): CallCardModel {
  const { view, tasks } = input;
  return {
    taskName: taskNameOf(tasks, view.callTaskId),
    status: standingCallStatus(view, tasks.callActivity),
    microphoneMuted: !view.listening && view.voiceStatus !== LIVE_STATUS.CONNECTING,
  };
}

/**
 * The plan whose call bar this window has on screen, or none: the Plans tab
 * on a plan's document, unless its version history, the window's Inbox, an
 * agent's page, or a side panel filling the window covers the column the
 * call bar stands in.
 */
export function callBarTaskId(input: {
  tasksTab: boolean;
  documentPage: boolean;
  historyOpen: boolean;
  inboxOpen: boolean;
  agentPageOpen: boolean;
  sidePanelFullScreen: boolean;
  activeTaskId: string | undefined;
}): string | undefined {
  const covered =
    input.historyOpen || input.inboxOpen || input.agentPageOpen || input.sidePanelFullScreen;
  return input.tasksTab && input.documentPage && !covered ? input.activeTaskId : undefined;
}

/**
 * Whether a Luke window draws the card: a call in progress, the window has
 * the keyboard, and the plan it shows is not the call's, where the call bar
 * already is. A window without the keyboard leaves the call to the floating
 * window, so the call is drawn in one place at a time.
 */
export function callCardShown(input: {
  view: Pick<VoiceView, "voiceStatus" | "callTaskId">;
  focused: boolean;
  taskShown: string | undefined;
}): boolean {
  const { view, focused, taskShown } = input;
  return focused && callInProgress(view) && taskShown !== view.callTaskId;
}

/**
 * What the top of one plan's Call tab draws while that plan's call is in
 * progress: the avatar's tile while it is starting, live, or ended for a
 * reason it offers to restart from, and `OFF` otherwise, which is the
 * compact strip that offers to turn video on, because the developer's own
 * off is not the end of video on the call. `undefined`, which draws nothing,
 * on any other plan or once the call is over. With the Video calls
 * experiment off nothing offers to put an avatar up, but an avatar still
 * standing keeps its tile, and with it the one control that takes it down.
 */
export function callTabVideoStatus(input: {
  view: Pick<VoiceView, "voiceStatus" | "callTaskId">;
  avatar: AvatarState;
  planId: string;
  videoCalls: boolean;
}): AvatarStatus | undefined {
  const { view, avatar, planId, videoCalls } = input;
  if (!callInProgress(view) || view.callTaskId !== planId) return undefined;
  if (!videoCalls) return avatarStanding(avatar) ? avatar.status : undefined;
  return avatarTiled(avatar) ? avatar.status : AVATAR_STATUS.OFF;
}

/**
 * What the call card draws of the avatar while the call is in progress:
 * the tile above its name while the avatar is starting or live, the card's
 * own Video on beside its name once it is down for any reason, `OFF`, and
 * `undefined`, which is today's card and nothing more, once the call is
 * over or while the Video calls experiment is off. The card is small, so an
 * avatar that ended is not drawn ended there: it falls back to the plain
 * card, and the Call tab keeps saying why. As on the Call tab, an avatar
 * still standing when the experiment is turned off keeps its tile.
 */
export function callCardVideoStatus(input: {
  view: Pick<VoiceView, "voiceStatus" | "callTaskId">;
  avatar: AvatarState;
  videoCalls: boolean;
}): AvatarStatus | undefined {
  const { view, avatar, videoCalls } = input;
  if (!callInProgress(view)) return undefined;
  if (avatarStanding(avatar)) return avatar.status;
  return videoCalls ? AVATAR_STATUS.OFF : undefined;
}
