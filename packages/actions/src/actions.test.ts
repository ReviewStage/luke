import assert from "node:assert/strict";
import { EMPTY_APP_GUIDE } from "@sidecar/guide";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import {
  type AdvertisedControl,
  CONVERSATION_ENTRY_KIND,
  normalizeSession,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Effect } from "effect";
import { test } from "vitest";
import { ACTION_KIND } from "./action-kinds.js";
import { actionNarration, sessionActionConversationEntry } from "./action-narration.js";
import { ACTION_TOOL, actionToolDefinitions, remoteRealtimeToolDefinitions } from "./actions.js";
import { maximumRememberedFacts, type RememberedFact } from "./memory.js";
import { withoutAdmission } from "./testing/admitted.js";
import { itemEnum, objectProperties } from "./testing/json-schema.js";
import { admitToolCall } from "./testing/tool-call.js";

/** One app action, admitted the way the brain's own intake admits it. */
const appToolAction = (
  call: { name: string; argumentsJson: string },
  guide: typeof EMPTY_APP_GUIDE,
  sessions: readonly never[],
  rememberedFacts: readonly RememberedFact[],
) =>
  Effect.runPromise(
    admitToolCall(call, {
      origin: RUN_ORIGIN.USER,
      roster: { read: () => Effect.succeed(sessions) },
      guide,
      rememberedFacts,
    }),
  );

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
      [],
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
    memoryCall(ACTION_TOOL.REMEMBER_FACT, {
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
    memoryCall(ACTION_TOOL.REMEMBER_FACT, { words: "anything", replaces: "fact-invented" }),
    EMPTY_APP_GUIDE,
    [],
    HELD,
  );
  assert.equal(invented.status, ACTION_RESULT_STATUS.REJECTED);
});

test("words that bound away to nothing are remembered as nothing", async () => {
  const empty = await appToolAction(
    memoryCall(ACTION_TOOL.REMEMBER_FACT, { words: "   " }),
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
    memoryCall(ACTION_TOOL.REMEMBER_FACT, { words: "one more" }),
    EMPTY_APP_GUIDE,
    [],
    full,
  );
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);

  // A replacement retires one as it lands, so a full list still takes it.
  const replacing = await appToolAction(
    memoryCall(ACTION_TOOL.REMEMBER_FACT, { words: "one more", replaces: "fact-0" }),
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
        memoryCall(ACTION_TOOL.FORGET_FACT, { id: "fact-one" }),
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
        memoryCall(ACTION_TOOL.FORGET_FACT, { id: "fact-two" }),
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
      ACTION_TOOL.SEND_SESSION_MESSAGE,
      ACTION_TOOL.RUN_SESSION_CONTROL,
      ACTION_TOOL.OPEN_SESSION,
      ACTION_TOOL.CREATE_WORKSPACE,
      ACTION_TOOL.ADD_WORKSPACE_AGENT,
      ACTION_TOOL.RENAME_WORKSPACE,
      ACTION_TOOL.RENAME_SESSION,
      ACTION_TOOL.SHOW_PANEL,
    ],
  );
  // No setting, composer, Updates row, or memory stands on the phone.
  for (const absent of [
    ACTION_TOOL.REMEMBER_FACT,
    ACTION_TOOL.FORGET_FACT,
    ACTION_TOOL.CHANGE_APP_SETTING,
    ACTION_TOOL.OPEN_FEEDBACK_COMPOSER,
    ACTION_TOOL.RUN_UPDATE_ACTION,
  ]) {
    assert.ok(!names.includes(absent), `${absent} must not reach the phone`);
  }

  // An open on the phone lands on the app's own screen, so no app to open in is offered.
  const open = remote.find((tool) => tool.name === ACTION_TOOL.OPEN_SESSION);
  assert.ok(open);
  assert.deepEqual(Object.keys(objectProperties(open.parameters)), [
    "provider_id",
    "provider_session_id",
  ]);

  // The phone's list narrows on provider and status, and has no tabs to show.
  const panel = remote.find((tool) => tool.name === ACTION_TOOL.SHOW_PANEL);
  assert.ok(panel);
  assert.deepEqual(Object.keys(objectProperties(panel.parameters)), ["filters", "sort", "query"]);
  const values = itemEnum(objectProperties(panel.parameters).filters);
  assert.ok(values.includes("all"));
  assert.ok(values.includes("waiting"));
  assert.ok(values.includes("conductor"));
  assert.ok(!values.includes("local"));
  assert.ok(!values.includes("voice"));

  // Every other action keeps the desktop's own schema.
  const desktop = new Map(actionToolDefinitions().map((tool) => [tool.name, tool]));
  for (const tool of remote) {
    if (tool.name === ACTION_TOOL.OPEN_SESSION || tool.name === ACTION_TOOL.SHOW_PANEL) continue;
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
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };

  const message = sessionActionConversationEntry(
    { kind: ACTION_KIND.MESSAGE, identity, text: "please add tests" },
    sessions,
    CONVERSATION_ENTRY_KIND.ACTION,
  );
  assert.equal(message.kind, CONVERSATION_ENTRY_KIND.ACTION);
  assert.equal(message.words, 'sent a message to "checkout-service": "please add tests"');
  assert.deepEqual(message.identity, identity);

  const control: AdvertisedControl = { kind: ACTION_KIND.CONTROL, id: "retry", label: "Retry" };
  assert.equal(
    sessionActionConversationEntry(
      { kind: ACTION_KIND.CONTROL, identity, control },
      sessions,
      CONVERSATION_ENTRY_KIND.ACTION,
    ).words,
    'ran "Retry" on "checkout-service"',
  );

  // A session the roster no longer shows is still named honestly.
  assert.equal(
    sessionActionConversationEntry(
      { kind: ACTION_KIND.OPEN, identity },
      [],
      CONVERSATION_ENTRY_KIND.ACTION,
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
    sessionActionConversationEntry(openedInApp, [heldByApp], CONVERSATION_ENTRY_KIND.ACTION).words,
    'opened "checkout-service" in Superset',
  );
  assert.equal(
    sessionActionConversationEntry(openedInApp, [], CONVERSATION_ENTRY_KIND.ACTION).words,
    "opened a session in superset",
  );

  // A workspace creation aims at no session, so its line carries no identity.
  const created = sessionActionConversationEntry(
    { kind: ACTION_KIND.CREATE_WORKSPACE, providerId: "conductor", providerProjectId: "p1" },
    sessions,
    CONVERSATION_ENTRY_KIND.ACTION,
  );
  assert.equal(created.words, "asked conductor to create a workspace");
  assert.equal(created.identity, undefined);
  const createdNamed = sessionActionConversationEntry(
    {
      kind: ACTION_KIND.CREATE_WORKSPACE,
      providerId: "conductor",
      providerProjectId: "p1",
      name: "Notch panel clipping",
    },
    sessions,
    CONVERSATION_ENTRY_KIND.ACTION,
  );
  assert.equal(
    createdNamed.words,
    'asked conductor to create a workspace named "Notch panel clipping"',
  );
});
