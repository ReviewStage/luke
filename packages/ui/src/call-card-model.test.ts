import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { IDLE_TASKS_VIEW, TASKS_READ, type TasksView } from "@luke/features/tasks-view";
import { LIVE_STATUS } from "@luke/live";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import { test } from "vitest";
import { callCard, standingCallStatus } from "./call-card-model.js";

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
    backend: { agent: undefined },
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
  const agent = { ...TASKS, callActivity: { planner: { action: "ls src" } } };
  assert.deepEqual(callCard({ view: LISTENING, tasks: agent }).status?.backend, {
    agent: { action: "ls src" },
  });
  // The open task's own activity is not the call's.
  const other = { ...TASKS, activity: { planner: { action: "ls src" } } };
  assert.deepEqual(callCard({ view: LISTENING, tasks: other }).status?.backend, {
    agent: undefined,
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

test("a call that failed still has a word on its bar, where an idle voice has none", () => {
  assert.equal(
    standingCallStatus({ voiceStatus: LIVE_STATUS.FAILED }, undefined)?.voiceWord,
    "Call failed",
  );
  assert.equal(standingCallStatus({ voiceStatus: LIVE_STATUS.IDLE }, undefined), undefined);
});

test("a call's bar says what Luke is doing without naming him, and draws no notetaker whatever an older service sent", () => {
  const speaking = standingCallStatus({ voiceStatus: LIVE_STATUS.SPEAKING }, undefined);
  assert.equal(speaking?.voiceWord, "Speaking");
  const working = standingCallStatus(
    { voiceStatus: LIVE_STATUS.LISTENING },
    { planner: { action: "ls src" }, notes: true },
  );
  assert.deepEqual(working?.backend, { agent: { action: "ls src" } });
});
