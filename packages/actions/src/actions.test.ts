import assert from "node:assert/strict";
import { EMPTY_APP_GUIDE } from "@sidecar/guide";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Effect } from "effect";
import { test } from "vitest";
import { ACTION_KIND } from "./action-kinds.js";
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
