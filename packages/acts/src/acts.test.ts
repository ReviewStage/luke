import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_APP_GUIDE } from "@sidecar/guide";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { APP_TOOL_KIND, actNarration, appToolAction, REALTIME_TOOL } from "./acts.js";
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
