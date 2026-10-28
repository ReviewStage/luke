import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { IDLE_TASKS_VIEW, TASKS_READ, type TasksView } from "@luke/features/tasks-view";
import { VOICE_FAILURE, VOICE_FAILURE_WORDS } from "@luke/features/words";
import { LIVE_STATUS } from "@luke/live";
import { MICROPHONE_STATUS } from "@luke/settings/microphone";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import { test } from "vitest";
import {
  CALL_LABEL,
  callBarAgentId,
  callCard,
  callCardShown,
  MICROPHONE_PRESS,
  microphoneButton,
  standingCallStatus,
} from "./call-card-model.js";
import { VOICE_KEYLESS_NOTE } from "./microphone-access.js";

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

test("an agent's Call button asks for the permission first, then calls the agent, or mutes and unmutes its own call", () => {
  const agentId = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";
  const otherAgent = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
  const own = { taskId: INVITES, agentId };
  const input = {
    voiceAvailable: true,
    microphoneStatus: MICROPHONE_STATUS.GRANTED,
    agentId,
    archived: false,
    listening: false,
    call: undefined,
    voiceStatus: LIVE_STATUS.IDLE,
  };
  assert.deepEqual(microphoneButton({ ...input, voiceAvailable: false }), {
    press: MICROPHONE_PRESS.NONE,
    label: VOICE_KEYLESS_NOTE,
    muted: false,
  });
  assert.equal(
    microphoneButton({ ...input, microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED }).press,
    MICROPHONE_PRESS.ASK_ACCESS,
  );
  assert.equal(
    microphoneButton({ ...input, microphoneStatus: MICROPHONE_STATUS.DENIED }).press,
    MICROPHONE_PRESS.OPEN_SETTINGS,
  );
  assert.equal(microphoneButton({ ...input, archived: true }).press, MICROPHONE_PRESS.NONE);
  assert.deepEqual(microphoneButton(input), {
    press: MICROPHONE_PRESS.TALK,
    label: CALL_LABEL,
    muted: false,
  });
  assert.deepEqual(
    microphoneButton({ ...input, listening: true, call: own, voiceStatus: LIVE_STATUS.LISTENING }),
    { press: MICROPHONE_PRESS.TALK, label: "Mute microphone", muted: false },
  );
  // The agent's own call standing unheard is muted, Luke speaking over it or not.
  for (const voiceStatus of [LIVE_STATUS.MUTED, LIVE_STATUS.SPEAKING]) {
    assert.deepEqual(microphoneButton({ ...input, call: own, voiceStatus }), {
      press: MICROPHONE_PRESS.TALK,
      label: "Unmute microphone",
      muted: true,
    });
  }
  // A call still connecting, or another agent's muted call, is not this agent muted.
  assert.equal(
    microphoneButton({ ...input, call: own, voiceStatus: LIVE_STATUS.CONNECTING }).muted,
    false,
  );
  const other = { taskId: INVITES, agentId: otherAgent };
  assert.equal(
    microphoneButton({ ...input, call: other, voiceStatus: LIVE_STATUS.MUTED }).muted,
    false,
  );
  // Another agent's call heard is one the press hangs up, not one it mutes.
  assert.equal(microphoneButton({ ...input, listening: true, call: other }).label, CALL_LABEL);
});

test("a voice window given up on for the run says so on the Call button, and how to get voice back, in place of a press", () => {
  const input = {
    voiceAvailable: true,
    microphoneStatus: MICROPHONE_STATUS.GRANTED,
    agentId: "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40",
    listening: false,
    call: undefined,
    voiceStatus: LIVE_STATUS.IDLE,
  };
  assert.deepEqual(microphoneButton({ ...input, voiceLost: true }), {
    press: MICROPHONE_PRESS.NONE,
    label: VOICE_FAILURE_WORDS[VOICE_FAILURE.VOICE_WINDOW_LOST].words,
    muted: false,
  });
  // Signed out still says so first: no window would make a call run then.
  assert.equal(
    microphoneButton({ ...input, voiceAvailable: false, voiceLost: true }).label,
    VOICE_KEYLESS_NOTE,
  );
  assert.equal(microphoneButton({ ...input, voiceLost: false }).label, CALL_LABEL);
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

test("an account known to have no OpenAI API key is sent to add one before the microphone is asked for, unknown asks nothing, and its own standing call keeps its mute", () => {
  const agentId = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";
  const own = { taskId: INVITES, agentId };
  const input = {
    voiceAvailable: true,
    microphoneStatus: MICROPHONE_STATUS.GRANTED,
    agentId,
    listening: false,
    call: undefined,
    voiceStatus: LIVE_STATUS.IDLE,
  };
  const addKey = {
    press: MICROPHONE_PRESS.ADD_OPENAI_KEY,
    label: "Add an OpenAI key in settings",
    muted: false,
  };
  assert.deepEqual(microphoneButton({ ...input, openAiKeyMissing: true }), addKey);
  assert.deepEqual(
    microphoneButton({
      ...input,
      microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED,
      openAiKeyMissing: true,
    }),
    addKey,
  );
  // Signed out says so first, since no key of any account's is in reach.
  assert.equal(
    microphoneButton({ ...input, voiceAvailable: false, openAiKeyMissing: true }).press,
    MICROPHONE_PRESS.NONE,
  );
  // A key saved, or not known either way, calls.
  assert.equal(
    microphoneButton({ ...input, openAiKeyMissing: false }).press,
    MICROPHONE_PRESS.TALK,
  );
  assert.equal(microphoneButton(input).label, CALL_LABEL);
  assert.deepEqual(
    microphoneButton({
      ...input,
      listening: true,
      call: own,
      voiceStatus: LIVE_STATUS.LISTENING,
      openAiKeyMissing: true,
    }),
    { press: MICROPHONE_PRESS.TALK, label: "Mute microphone", muted: false },
  );
});
