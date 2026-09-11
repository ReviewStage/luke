import assert from "node:assert/strict";
import {
  APP_PANEL_TAB,
  APP_SETTING_ID,
  APP_SETTING_KIND,
  APP_UPDATE_ACTION,
  APP_UPDATE_WAIT,
  AppPanelTabSchema,
  AppSettingIdSchema,
  AppSettingKindSchema,
  AppUpdateActionSchema,
  AppUpdateButtonSchema,
  AppUpdateWaitSchema,
  FEEDBACK_COMPOSER_KIND,
  FeedbackComposerKindSchema,
  SESSION_LIST_SORT,
  SessionListSortSchema,
} from "@sidecar/guide";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Either, Schema } from "effect";
import { test } from "vitest";

const NOTHING_ANY_VOCABULARY_HOLDS: readonly UnparsedWireValue[] = [
  "",
  " ",
  "not-a-member",
  undefined,
  17,
  true,
  {},
  [],
];

function settlesVocabulary<Member extends string>(
  schema: Schema.Schema<Member>,
  members: readonly Member[],
  alsoRefused: readonly UnparsedWireValue[] = [],
): void {
  const decode = Schema.decodeUnknownEither(schema);
  for (const member of members) assert.deepEqual(decode(member), Either.right(member));
  for (const refused of [...NOTHING_ANY_VOCABULARY_HOLDS, ...alsoRefused]) {
    assert.equal(Either.isLeft(decode(refused)), true);
  }
}

test("a setting id is one of the ids the build declares", () => {
  settlesVocabulary(AppSettingIdSchema, Object.values(APP_SETTING_ID), [
    APP_SETTING_KIND.TOGGLE,
    APP_UPDATE_ACTION.CHECK,
  ]);
});

test("a setting kind is a toggle or a choice, and nothing else", () => {
  settlesVocabulary(AppSettingKindSchema, Object.values(APP_SETTING_KIND), [
    APP_UPDATE_ACTION.CHECK,
  ]);
});

test("an update action is one of the row's three, and an update wait one of its two", () => {
  settlesVocabulary(AppUpdateActionSchema, Object.values(APP_UPDATE_ACTION), [
    APP_UPDATE_WAIT.CHECKING,
  ]);
  settlesVocabulary(AppUpdateWaitSchema, Object.values(APP_UPDATE_WAIT), [APP_UPDATE_ACTION.CHECK]);
});

test("the update button is an action or a wait, and nothing else", () => {
  settlesVocabulary(AppUpdateButtonSchema, [
    ...Object.values(APP_UPDATE_ACTION),
    ...Object.values(APP_UPDATE_WAIT),
  ]);
});

test("a panel tab is one of the panel's own tabs", () => {
  settlesVocabulary(AppPanelTabSchema, Object.values(APP_PANEL_TAB), [APP_UPDATE_ACTION.CHECK]);
});

test("a feedback composer kind is feedback or a prompt, and nothing else", () => {
  settlesVocabulary(FeedbackComposerKindSchema, Object.values(FEEDBACK_COMPOSER_KIND), [
    APP_PANEL_TAB.SESSIONS,
  ]);
});

test("a session list sort is urgency or recency, and nothing else", () => {
  settlesVocabulary(SessionListSortSchema, Object.values(SESSION_LIST_SORT), [
    APP_PANEL_TAB.SESSIONS,
  ]);
});
