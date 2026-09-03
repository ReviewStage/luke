import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_APP_GUIDE } from "@sidecar/guide";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import {
  APP_TOOL_KIND,
  actNarration,
  appToolAction,
  REALTIME_TOOL,
  realtimeToolDefinitions,
  remoteRealtimeToolDefinitions,
} from "./acts.js";
import { maximumRememberedFacts } from "./memory.js";

test("a setting act narrates the setting label and accepted value", () => {
  assert.equal(
    actNarration(
      {
        kind: APP_TOOL_KIND.SETTING,
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

test("an automatic memory update may only replace an entry in context", () => {
  const replacing = appToolAction(
    memoryCall(REALTIME_TOOL.REMEMBER_FACT, {
      words: "  stop telling me\n about CI ",
      replaces: "fact-one",
    }),
    EMPTY_APP_GUIDE,
    [],
    HELD,
  );
  assert.deepEqual(replacing, {
    kind: APP_TOOL_KIND.REMEMBER,
    words: "stop telling me about CI",
    replaces: "fact-one",
  });

  const invented = appToolAction(
    memoryCall(REALTIME_TOOL.REMEMBER_FACT, { words: "anything", replaces: "fact-invented" }),
    EMPTY_APP_GUIDE,
    [],
    HELD,
  );
  assert.equal(invented.status, ACT_RESULT_STATUS.REJECTED);
});

test("words that bound away to nothing are remembered as nothing", () => {
  const empty = appToolAction(
    memoryCall(REALTIME_TOOL.REMEMBER_FACT, { words: "   " }),
    EMPTY_APP_GUIDE,
    [],
    [],
  );
  assert.equal(empty.status, ACT_RESULT_STATUS.REJECTED);
});

test("the cap refuses a new fact rather than evicting an old one", () => {
  const full = Array.from({ length: maximumRememberedFacts }, (_, index) => ({
    id: `fact-${index}`,
    words: `something ${index}`,
  }));
  const refused = appToolAction(
    memoryCall(REALTIME_TOOL.REMEMBER_FACT, { words: "one more" }),
    EMPTY_APP_GUIDE,
    [],
    full,
  );
  assert.equal(refused.status, ACT_RESULT_STATUS.REJECTED);

  // A replacement retires one as it lands, so a full list still takes it.
  const replacing = appToolAction(
    memoryCall(REALTIME_TOOL.REMEMBER_FACT, { words: "one more", replaces: "fact-0" }),
    EMPTY_APP_GUIDE,
    [],
    full,
  );
  assert.equal(replacing.kind, APP_TOOL_KIND.REMEMBER);
});

test("forgetting can only name an entry that stands", () => {
  assert.deepEqual(
    appToolAction(
      memoryCall(REALTIME_TOOL.FORGET_FACT, { id: "fact-one" }),
      EMPTY_APP_GUIDE,
      [],
      HELD,
    ),
    { kind: APP_TOOL_KIND.FORGET, id: "fact-one" },
  );
  assert.equal(
    appToolAction(
      memoryCall(REALTIME_TOOL.FORGET_FACT, { id: "fact-two" }),
      EMPTY_APP_GUIDE,
      [],
      HELD,
    ).status,
    ACT_RESULT_STATUS.REJECTED,
  );
});

test("the phone is handed the acts it carries, in the shape its own surface gives them", () => {
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
  // No local transcript, tracker, setting, composer, Updates row, or memory stands on the phone.
  for (const absent of [
    REALTIME_TOOL.READ_SESSION_TRANSCRIPT,
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
  assert.deepEqual(Object.keys(open.parameters.properties), ["provider_id", "provider_session_id"]);
  assert.match(open.description, /own screen in this app/);

  // The phone's list narrows on provider and status, and has no tabs to show.
  const panel = remote.find((tool) => tool.name === REALTIME_TOOL.SHOW_PANEL);
  assert.ok(panel);
  assert.deepEqual(Object.keys(panel.parameters.properties), ["filters", "sort", "query"]);
  const filters = panel.parameters.properties.filters;
  assert.ok(filters && filters.type === "array");
  const values = filters.items.enum ?? [];
  assert.ok(values.includes("all"));
  assert.ok(values.includes("waiting"));
  assert.ok(values.includes("conductor"));
  assert.ok(!values.includes("local"));
  assert.ok(!values.includes("voice"));

  // Every other act keeps the desktop's own schema.
  const desktop = new Map(realtimeToolDefinitions().map((tool) => [tool.name, tool]));
  for (const tool of remote) {
    if (tool.name === REALTIME_TOOL.OPEN_SESSION || tool.name === REALTIME_TOOL.SHOW_PANEL)
      continue;
    assert.deepEqual(tool, desktop.get(tool.name));
  }
});
