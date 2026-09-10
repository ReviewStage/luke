import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_APP_GUIDE } from "@sidecar/guide";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import {
  type AdvertisedControl,
  CONVERSATION_ENTRY_KIND,
  normalizeSession,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { ACTION_KIND } from "./action-kinds.js";
import { actionNarration, sessionActionConversationEntry } from "./action-narration.js";
import {
  REALTIME_TOOL,
  realtimeToolDefinitions,
  remoteRealtimeToolDefinitions,
  toolAction,
} from "./actions.js";
import { maximumRememberedFacts, type RememberedFact } from "./memory.js";
import { withoutAdmission } from "./testing/admitted.js";
import { itemEnum, objectProperties } from "./testing/json-schema.js";

/** One app action, admitted the way the brain's own intake admits it. */
const appToolAction = (
  call: { name: string; argumentsJson: string },
  guide: typeof EMPTY_APP_GUIDE,
  sessions: readonly never[],
  rememberedFacts: readonly RememberedFact[],
) =>
  toolAction(call, {
    origin: RUN_ORIGIN.USER,
    roster: { read: async () => sessions },
    guide,
    rememberedFacts,
  });

test("a setting action narrates the setting label and accepted value", async () => {
  assert.equal(
    actionNarration(
      {
        kind: ACTION_KIND.SETTING,
        setting: {
          id: "voice_captions",
          label: "Captions",
          description: "Shows Luke's spoken replies as text.",
          kind: "toggle",
          value: "off",
          defaultValue: "off",
          adjustable: true,
          manual: "Settings, Voice",
        },
        value: "on",
      },
      { sessions: [], projects: [] },
    ),
    "changed Captions to on",
  );
});

const memoryCall = (name: string, args: Record<string, string>) => ({
  name,
  argumentsJson: JSON.stringify(args),
});

const HELD = [{ id: "fact-one", words: "prefers CI updates" }];

test("an automatic memory update may only replace an entry in context", async () => {
  const replacing = await appToolAction(
    memoryCall(REALTIME_TOOL.REMEMBER_FACT, {
      words: "  stop telling me\n about CI ",
      replaces: "fact-one",
    }),
    EMPTY_APP_GUIDE,
    [],
    HELD,
  );
  assert.deepEqual(withoutAdmission(replacing), {
    kind: ACTION_KIND.REMEMBER,
    words: "stop telling me about CI",
    replaces: "fact-one",
  });

  const invented = await appToolAction(
    memoryCall(REALTIME_TOOL.REMEMBER_FACT, { words: "anything", replaces: "fact-invented" }),
    EMPTY_APP_GUIDE,
    [],
    HELD,
  );
  assert.equal(invented.status, ACTION_RESULT_STATUS.REJECTED);
});

test("words that bound away to nothing are remembered as nothing", async () => {
  const empty = await appToolAction(
    memoryCall(REALTIME_TOOL.REMEMBER_FACT, { words: "   " }),
    EMPTY_APP_GUIDE,
    [],
    [],
  );
  assert.equal(empty.status, ACTION_RESULT_STATUS.REJECTED);
});

test("the cap refuses a new fact rather than evicting an old one", async () => {
  const full = Array.from({ length: maximumRememberedFacts }, (_, index) => ({
    id: `fact-${index}`,
    words: `something ${index}`,
  }));
  const refused = await appToolAction(
    memoryCall(REALTIME_TOOL.REMEMBER_FACT, { words: "one more" }),
    EMPTY_APP_GUIDE,
    [],
    full,
  );
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);

  // A replacement retires one as it lands, so a full list still takes it.
  const replacing = await appToolAction(
    memoryCall(REALTIME_TOOL.REMEMBER_FACT, { words: "one more", replaces: "fact-0" }),
    EMPTY_APP_GUIDE,
    [],
    full,
  );
  assert.equal(replacing.kind, ACTION_KIND.REMEMBER);
});

test("forgetting can only name an entry that stands", async () => {
  assert.deepEqual(
    withoutAdmission(
      await appToolAction(
        memoryCall(REALTIME_TOOL.FORGET_FACT, { id: "fact-one" }),
        EMPTY_APP_GUIDE,
        [],
        HELD,
      ),
    ),
    { kind: ACTION_KIND.FORGET, id: "fact-one" },
  );
  assert.equal(
    (
      await appToolAction(
        memoryCall(REALTIME_TOOL.FORGET_FACT, { id: "fact-two" }),
        EMPTY_APP_GUIDE,
        [],
        HELD,
      )
    ).status,
    ACTION_RESULT_STATUS.REJECTED,
  );
});

test("the phone is handed the actions it carries, in the shape its own surface gives them", async () => {
  const remote = remoteRealtimeToolDefinitions();
  const names: readonly string[] = remote.map((tool) => tool.name);
  // Spread so the equality narrows a copy, leaving `names` a plain string list.
  assert.deepEqual(
    [...names],
    [
      REALTIME_TOOL.SEND_SESSION_MESSAGE,
      REALTIME_TOOL.RUN_SESSION_CONTROL,
      REALTIME_TOOL.OPEN_SESSION,
      REALTIME_TOOL.CREATE_WORKSPACE,
      REALTIME_TOOL.ADD_WORKSPACE_AGENT,
      REALTIME_TOOL.RENAME_WORKSPACE,
      REALTIME_TOOL.RENAME_SESSION,
      REALTIME_TOOL.SHOW_PANEL,
    ],
  );
  // No tracker, setting, composer, Updates row, or memory stands on the phone.
  for (const absent of [
    REALTIME_TOOL.REMEMBER_FACT,
    REALTIME_TOOL.FORGET_FACT,
    REALTIME_TOOL.UPDATE_ISSUE_STATE,
    REALTIME_TOOL.COMMENT_ON_ISSUE,
    REALTIME_TOOL.CHANGE_APP_SETTING,
    REALTIME_TOOL.OPEN_FEEDBACK_COMPOSER,
    REALTIME_TOOL.RUN_UPDATE_ACTION,
  ]) {
    assert.ok(!names.includes(absent), `${absent} must not reach the phone`);
  }

  // An open on the phone lands on the app's own screen, so no app to open in is offered.
  const open = remote.find((tool) => tool.name === REALTIME_TOOL.OPEN_SESSION);
  assert.ok(open);
  assert.deepEqual(Object.keys(objectProperties(open.parameters)), [
    "provider_id",
    "provider_session_id",
  ]);
  assert.match(open.description, /own screen in this app/);

  // The phone's list narrows on provider and status, and has no tabs to show.
  const panel = remote.find((tool) => tool.name === REALTIME_TOOL.SHOW_PANEL);
  assert.ok(panel);
  assert.deepEqual(Object.keys(objectProperties(panel.parameters)), ["filters", "sort", "query"]);
  const values = itemEnum(objectProperties(panel.parameters).filters);
  assert.ok(values.includes("all"));
  assert.ok(values.includes("waiting"));
  assert.ok(values.includes("conductor"));
  assert.ok(!values.includes("local"));
  assert.ok(!values.includes("voice"));

  // Every other action keeps the desktop's own schema.
  const desktop = new Map(realtimeToolDefinitions().map((tool) => [tool.name, tool]));
  for (const tool of remote) {
    if (tool.name === REALTIME_TOOL.OPEN_SESSION || tool.name === REALTIME_TOOL.SHOW_PANEL)
      continue;
    assert.deepEqual(tool, desktop.get(tool.name));
  }
});

const OBSERVED_AT = 1_800_000_000_000;

function rosterSession(providerSessionId: string, title: string) {
  return normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    { providerSessionId, title, status: SESSION_STATUS.WORKING, lastActivityAt: OBSERVED_AT },
  );
}

test("an action's line records the ask in words, with the identity it named", () => {
  const sessions = [rosterSession("session-a", "checkout-service")];
  const projects = [
    {
      providerId: "conductor",
      providerName: "Conductor",
      providerProjectId: "p1",
      repository: "luke",
      taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
    },
  ];
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };

  const message = sessionActionConversationEntry(
    { kind: ACTION_KIND.MESSAGE, identity, text: "please add tests" },
    { sessions, projects },
    CONVERSATION_ENTRY_KIND.ACTION,
    "run-1",
  );
  assert.equal(message.kind, CONVERSATION_ENTRY_KIND.ACTION);
  assert.equal(message.words, 'sent a message to "checkout-service": "please add tests"');
  assert.deepEqual(message.identity, identity);
  // The kind, the run, and the act's own facts ride beside the words, for the
  // panel to compose its row from and fold by.
  assert.deepEqual(message.action, {
    kind: ACTION_KIND.MESSAGE,
    runId: "run-1",
    text: "please add tests",
  });

  const control: AdvertisedControl = { kind: ACTION_KIND.CONTROL, id: "retry", label: "Retry" };
  const pressed = sessionActionConversationEntry(
    { kind: ACTION_KIND.CONTROL, identity, control },
    { sessions, projects },
    CONVERSATION_ENTRY_KIND.ACTION,
    "run-1",
  );
  assert.equal(pressed.words, 'ran "Retry" on "checkout-service"');
  assert.deepEqual(pressed.action, { kind: ACTION_KIND.CONTROL, runId: "run-1", label: "Retry" });

  // A session the roster no longer shows is still named honestly.
  assert.equal(
    sessionActionConversationEntry(
      { kind: ACTION_KIND.OPEN, identity },
      { sessions: [], projects },
      CONVERSATION_ENTRY_KIND.ACTION,
      "run-1",
    ).words,
    "opened a session",
  );

  // An open that picked an app records where it landed, under the display
  // name the roster listed — or the bare id when the roster has let it go.
  const heldByApp = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-a",
      title: "checkout-service",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
      applications: [
        {
          id: SESSION_APPLICATION_ID.SUPERSET,
          displayName: "Superset",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "superset://v2-workspace/workspace-1",
        },
      ],
    },
  );
  const openedInApp = {
    kind: ACTION_KIND.OPEN,
    identity,
    applicationId: SESSION_APPLICATION_ID.SUPERSET,
  } as const;
  assert.equal(
    sessionActionConversationEntry(
      openedInApp,
      { sessions: [heldByApp], projects },
      CONVERSATION_ENTRY_KIND.ACTION,
      "run-1",
    ).words,
    'opened "checkout-service" in Superset',
  );
  assert.equal(
    sessionActionConversationEntry(
      openedInApp,
      { sessions: [], projects },
      CONVERSATION_ENTRY_KIND.ACTION,
      "run-1",
    ).words,
    "opened a session in superset",
  );

  // A workspace creation aims at no session, so its line carries no identity.
  const created = sessionActionConversationEntry(
    { kind: ACTION_KIND.CREATE_WORKSPACE, providerId: "conductor", providerProjectId: "p1" },
    { sessions, projects },
    CONVERSATION_ENTRY_KIND.ACTION,
    "run-1",
  );
  assert.equal(created.words, "created a new workspace in Conductor");
  assert.equal(created.identity, undefined);
  // With no identity to name it, the creation's line names the provider it asked.
  assert.deepEqual(created.action, {
    kind: ACTION_KIND.CREATE_WORKSPACE,
    runId: "run-1",
    providerId: "conductor",
  });
  const createdNamed = sessionActionConversationEntry(
    {
      kind: ACTION_KIND.CREATE_WORKSPACE,
      providerId: "conductor",
      providerProjectId: "p1",
      name: "Notch panel clipping",
    },
    { sessions, projects },
    CONVERSATION_ENTRY_KIND.ACTION,
    "run-1",
  );
  assert.equal(createdNamed.words, 'created a new workspace "Notch panel clipping" in Conductor');
});
