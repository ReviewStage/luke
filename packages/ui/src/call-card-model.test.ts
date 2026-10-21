import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { IDLE_TASKS_VIEW, TASKS_READ, type TasksView } from "@luke/features/tasks-view";
import { LIVE_STATUS } from "@luke/live";
import { AVATAR_END_REASON, AVATAR_OFF, AVATAR_STATUS, type AvatarState } from "@luke/voice/avatar";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import { test } from "vitest";
import {
  agentCallVideoStatus,
  callBarAgentId,
  callCard,
  callCardShown,
  callCardVideoStatus,
} from "./call-card-model.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
/** The agent of the invites task the call speaks into, and another. */
const CALLED = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";
const OTHER_AGENT = "6e2a9d4b-1c7f-4a8e-b3d5-2f9c8e1a7b60";

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
  call: { taskId: INVITES, agentId: CALLED },
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
  // The open task's own activity is not the call's.
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
    callCard({ view: { ...LISTENING, call: { taskId: BILLING, agentId: CALLED } }, tasks: open })
      .taskName,
    "Billing export",
  );
  assert.equal(callCard({ view: LISTENING, tasks: IDLE_TASKS_VIEW }).taskName, "Call");
});

test("a call into an agent with no task is named as its row names the agent, or plainly as a call", () => {
  const taskless: TasksView = {
    ...TASKS,
    tasklessAgents: [
      {
        id: OTHER_AGENT,
        planId: null,
        turnId: null,
        title: "Retry audit",
        model: "openai/gpt-6.1-sol",
        effort: "high",
        status: CODING_AGENT_STATUS.COMPLETED,
        createdAt: 1_000,
        automationId: null,
        workspaceId: WORKSPACE,
        repository: "acme/relay",
        activityAt: 1_000,
      },
    ],
  };
  const call = (agentId: string) => ({ ...LISTENING, call: { agentId } });
  assert.equal(callCard({ view: call(OTHER_AGENT), tasks: taskless }).taskName, "Retry audit");
  assert.equal(callCard({ view: call(CALLED), tasks: taskless }).taskName, "Call");
});

test("a Luke window draws the card only with the keyboard, a call in progress, and anything but the call's agent's tab on screen", () => {
  const shown = (view: VoiceView, focused: boolean, agentShown: string | undefined) =>
    callCardShown({ view, focused, agentShown });
  assert.equal(shown(LISTENING, true, OTHER_AGENT), true);
  assert.equal(shown(LISTENING, true, undefined), true);
  // The call's own agent's tab has its call bar; a window without the keyboard leaves the call to the floating window.
  assert.equal(shown(LISTENING, true, CALLED), false);
  assert.equal(shown(LISTENING, false, OTHER_AGENT), false);
  assert.equal(shown({ ...LISTENING, voiceStatus: LIVE_STATUS.CLOSING }, true, OTHER_AGENT), false);
  assert.equal(shown(IDLE_VOICE_VIEW, true, OTHER_AGENT), false);
});

test("an agent's call bar is on screen on its tab of a task's document, or on its own page, and not under its version history, the window's Inbox, another agent's page, or a side panel filling the window", () => {
  const onTab = {
    tasksTab: true,
    documentPage: true,
    historyOpen: false,
    inboxOpen: false,
    pageAgentId: undefined,
    sidePanelFullScreen: false,
    columnAgentId: CALLED,
  };
  assert.equal(callBarAgentId(onTab), CALLED);
  assert.equal(callBarAgentId({ ...onTab, columnAgentId: undefined }), undefined);
  assert.equal(callBarAgentId({ ...onTab, historyOpen: true }), undefined);
  assert.equal(callBarAgentId({ ...onTab, inboxOpen: true }), undefined);
  assert.equal(callBarAgentId({ ...onTab, pageAgentId: OTHER_AGENT }), OTHER_AGENT);
  // An agent's own page draws its call bar whatever task is open, or none.
  const onPage = { ...onTab, documentPage: false, columnAgentId: undefined, pageAgentId: CALLED };
  assert.equal(callBarAgentId(onPage), CALLED);
  assert.equal(callBarAgentId({ ...onPage, inboxOpen: true }), undefined);
  assert.equal(callBarAgentId({ ...onPage, sidePanelFullScreen: true }), undefined);
  assert.equal(callBarAgentId({ ...onTab, sidePanelFullScreen: true }), undefined);
  assert.equal(callBarAgentId({ ...onTab, documentPage: false }), undefined);
  assert.equal(callBarAgentId({ ...onTab, tasksTab: false }), undefined);
});

test("an agent's tab draws the video for a call into that agent alone, while the call is in progress and the experiment is on", () => {
  const live: AvatarState = { status: AVATAR_STATUS.LIVE };
  const drawn = (view: VoiceView, avatar: AvatarState, agentId: string, videoCalls = true) =>
    agentCallVideoStatus({ view, avatar, agentId, videoCalls });
  assert.equal(drawn(LISTENING, live, CALLED), AVATAR_STATUS.LIVE);
  assert.equal(
    drawn(LISTENING, { status: AVATAR_STATUS.STARTING }, CALLED),
    AVATAR_STATUS.STARTING,
  );
  const restartable = { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.SERVER_CLOSED };
  assert.equal(drawn(LISTENING, restartable, CALLED), AVATAR_STATUS.ENDED);
  // Another agent's tab, a call that is over, or no avatar standing with the experiment off draws nothing.
  assert.equal(drawn(LISTENING, live, OTHER_AGENT), undefined);
  assert.equal(drawn(IDLE_VOICE_VIEW, live, CALLED), undefined);
  assert.equal(drawn(LISTENING, AVATAR_OFF, CALLED, false), undefined);
  assert.equal(drawn(LISTENING, restartable, CALLED, false), undefined);
});

test("an avatar still standing when the experiment is turned off keeps its tile, and with it Video off", () => {
  const drawn = (avatar: AvatarState) =>
    agentCallVideoStatus({ view: LISTENING, avatar, agentId: CALLED, videoCalls: false });
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
    agentCallVideoStatus({ view, avatar, agentId: CALLED, videoCalls: true });
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
