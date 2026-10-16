import assert from "node:assert/strict";
import { IDLE_TASKS_VIEW, TASKS_READ, type TasksView } from "@luke/features/tasks-view";
import { LIVE_STATUS } from "@luke/live";
import { AVATAR_END_REASON, AVATAR_OFF, AVATAR_STATUS, type AvatarState } from "@luke/voice/avatar";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import { test } from "vitest";
import {
  callBarTaskId,
  callCard,
  callCardShown,
  callCardVideoStatus,
  callTabVideoStatus,
} from "./call-card-model.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const WORKSPACE = "workspace-personal";

/** The list as the sidebar holds it, with the billing plan open in the panel. */
const TASKS: TasksView = {
  ...IDLE_TASKS_VIEW,
  tasks: [
    {
      id: INVITES,
      workspaceId: WORKSPACE,
      name: "Teammate invitations",
      createdAt: 1,
      updatedAt: 2,
      repository: null,
    },
  ],
  activeTaskId: BILLING,
};

const LISTENING: VoiceView = {
  ...IDLE_VOICE_VIEW,
  voiceStatus: LIVE_STATUS.LISTENING,
  listening: true,
  callTaskId: INVITES,
};

test("the card names the call's plan, not the one open, and hands the call bar its own words for the call", () => {
  const listening = callCard({ view: LISTENING, tasks: TASKS });
  assert.equal(listening.taskName, "Teammate invitations");
  assert.deepEqual(listening.status, {
    voiceWord: "Listening",
    backend: { brain: undefined, notes: false },
  });
  assert.equal(listening.microphoneMuted, false);

  const muted = callCard({
    view: { ...LISTENING, voiceStatus: LIVE_STATUS.MUTED, listening: false },
    tasks: TASKS,
  });
  assert.equal(muted.status?.voiceWord, "Muted");
  assert.equal(muted.microphoneMuted, true);

  const opening = callCard({
    view: { ...LISTENING, voiceStatus: LIVE_STATUS.CONNECTING, listening: false },
    tasks: TASKS,
  });
  assert.equal(opening.status?.voiceWord, "Connecting");
  assert.equal(opening.microphoneMuted, false);
});

test("Luke at work on the call's plan is read off the call's own activity, though another plan is open", () => {
  const brain = { ...TASKS, callActivity: { planner: { action: "ls src" }, notes: true } };
  assert.deepEqual(callCard({ view: LISTENING, tasks: brain }).status?.backend, {
    brain: { action: "ls src" },
    notes: true,
  });
  // The open plan's own activity is not the call's.
  const other = { ...TASKS, activity: { planner: { action: "ls src" }, notes: false } };
  assert.deepEqual(callCard({ view: LISTENING, tasks: other }).status?.backend, {
    brain: undefined,
    notes: false,
  });
});

test("a call's plan the list does not hold is named from the open document, or plainly as a call", () => {
  const open: TasksView = {
    ...IDLE_TASKS_VIEW,
    activeTaskId: BILLING,
    document: {
      status: TASKS_READ.READY,
      task: {
        id: BILLING,
        workspaceId: WORKSPACE,
        name: "Billing export",
        createdAt: 1,
        updatedAt: 2,
        repository: null,
        document: { body: "# Billing export", assumptions: [] },
      },
    },
  };
  assert.equal(
    callCard({ view: { ...LISTENING, callTaskId: BILLING }, tasks: open }).taskName,
    "Billing export",
  );
  assert.equal(callCard({ view: LISTENING, tasks: IDLE_TASKS_VIEW }).taskName, "Planning call");
});

test("a Luke window draws the card only with the keyboard, a call in progress, and anything but the call's plan on screen", () => {
  const shown = (view: VoiceView, focused: boolean, taskShown: string | undefined) =>
    callCardShown({ view, focused, taskShown });
  assert.equal(shown(LISTENING, true, BILLING), true);
  assert.equal(shown(LISTENING, true, undefined), true);
  // The call's own plan has its call bar; a window without the keyboard leaves the call to the floating window.
  assert.equal(shown(LISTENING, true, INVITES), false);
  assert.equal(shown(LISTENING, false, BILLING), false);
  assert.equal(shown({ ...LISTENING, voiceStatus: LIVE_STATUS.CLOSING }, true, BILLING), false);
  assert.equal(shown(IDLE_VOICE_VIEW, true, BILLING), false);
});

test("the call bar is on screen only on a plan's document, and not under its version history, the window's Inbox, an agent's page, or a side panel filling the window", () => {
  const onTask = {
    tasksTab: true,
    documentPage: true,
    historyOpen: false,
    inboxOpen: false,
    agentPageOpen: false,
    sidePanelFullScreen: false,
    activeTaskId: INVITES,
  };
  assert.equal(callBarTaskId(onTask), INVITES);
  assert.equal(callBarTaskId({ ...onTask, historyOpen: true }), undefined);
  assert.equal(callBarTaskId({ ...onTask, inboxOpen: true }), undefined);
  assert.equal(callBarTaskId({ ...onTask, agentPageOpen: true }), undefined);
  assert.equal(callBarTaskId({ ...onTask, sidePanelFullScreen: true }), undefined);
  assert.equal(callBarTaskId({ ...onTask, documentPage: false }), undefined);
  assert.equal(callBarTaskId({ ...onTask, tasksTab: false }), undefined);
});

test("the Call tab draws the video on the call's own plan alone, while the call is in progress and the experiment is on", () => {
  const live: AvatarState = { status: AVATAR_STATUS.LIVE };
  const drawn = (view: VoiceView, avatar: AvatarState, planId: string, videoCalls = true) =>
    callTabVideoStatus({ view, avatar, planId, videoCalls });
  assert.equal(drawn(LISTENING, live, INVITES), AVATAR_STATUS.LIVE);
  assert.equal(
    drawn(LISTENING, { status: AVATAR_STATUS.STARTING }, INVITES),
    AVATAR_STATUS.STARTING,
  );
  const restartable = { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.SERVER_CLOSED };
  assert.equal(drawn(LISTENING, restartable, INVITES), AVATAR_STATUS.ENDED);
  // Another plan's Call tab, a call that is over, or no avatar standing with the experiment off draws nothing.
  assert.equal(drawn(LISTENING, live, BILLING), undefined);
  assert.equal(drawn(IDLE_VOICE_VIEW, live, INVITES), undefined);
  assert.equal(drawn(LISTENING, AVATAR_OFF, INVITES, false), undefined);
  assert.equal(drawn(LISTENING, restartable, INVITES, false), undefined);
});

test("an avatar still standing when the experiment is turned off keeps its tile, and with it Video off", () => {
  const drawn = (avatar: AvatarState) =>
    callTabVideoStatus({ view: LISTENING, avatar, planId: INVITES, videoCalls: false });
  assert.equal(drawn({ status: AVATAR_STATUS.LIVE }), AVATAR_STATUS.LIVE);
  assert.equal(drawn({ status: AVATAR_STATUS.STARTING }), AVATAR_STATUS.STARTING);
  // Once it is down, nothing offers to put it up again.
  assert.equal(
    drawn({ status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.USER }),
    undefined,
  );
});

test("video the developer turned off stays offered to turn on again for as long as the call stands", () => {
  const turnedOff = { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.USER };
  const drawn = (view: VoiceView, avatar: AvatarState) =>
    callTabVideoStatus({ view, avatar, planId: INVITES, videoCalls: true });
  assert.equal(drawn(LISTENING, turnedOff), AVATAR_STATUS.OFF);
  assert.equal(drawn(LISTENING, AVATAR_OFF), AVATAR_STATUS.OFF);
  assert.equal(drawn(IDLE_VOICE_VIEW, turnedOff), undefined);
});

test("the call card draws the avatar while it stands, offers Video on once it is down, and is today's card with the experiment off", () => {
  const drawn = (view: VoiceView, avatar: AvatarState, videoCalls = true) =>
    callCardVideoStatus({ view, avatar, videoCalls });
  assert.equal(drawn(LISTENING, { status: AVATAR_STATUS.LIVE }), AVATAR_STATUS.LIVE);
  assert.equal(drawn(LISTENING, { status: AVATAR_STATUS.STARTING }), AVATAR_STATUS.STARTING);
  // Down for any reason, the card falls back to itself with Video on beside the plan's name.
  const failed = { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.ERROR };
  assert.equal(drawn(LISTENING, failed), AVATAR_STATUS.OFF);
  assert.equal(drawn(LISTENING, AVATAR_OFF), AVATAR_STATUS.OFF);
  // The experiment off is today's card, unless an avatar still stands to be taken down.
  assert.equal(drawn(LISTENING, AVATAR_OFF, false), undefined);
  assert.equal(drawn(LISTENING, failed, false), undefined);
  assert.equal(drawn(LISTENING, { status: AVATAR_STATUS.LIVE }, false), AVATAR_STATUS.LIVE);
  // No call, no video.
  assert.equal(drawn(IDLE_VOICE_VIEW, { status: AVATAR_STATUS.LIVE }), undefined);
});
