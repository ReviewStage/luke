/**
 * legacy-app-word.test.ts -- what rows and lines stored before the app was named `app` name it by still reads as the app.
 */

import assert from "node:assert/strict";
import { USER_MESSAGE_METADATA } from "@luke/wire";
import { Schema } from "effect";
import { test } from "vitest";
import {
  AGENT_ARCHIVER,
  AGENT_PAYER,
  agentArchiverSchema,
  agentPayerSchema,
} from "./agent-wire.js";
import {
  AUTOMATION_TRIGGER,
  automationTriggerSchema,
  GITHUB_SENDER,
  GITHUB_TRIGGER_EVENT,
} from "./automation-wire.js";
import { keptPictureIdOf } from "./conversation-picture-wire.js";
import { PAGE_SHOWER, pageShowerSchema } from "./page-wire.js";
import { PLAN_COMMENT_ACTOR, planCommentActorSchema } from "./plan-comment-wire.js";

const PULL_REQUEST_OPENED = {
  kind: AUTOMATION_TRIGGER.GITHUB,
  event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
} as const;

test.each([
  ["an agent's payer", () => Schema.decodeUnknownSync(agentPayerSchema)("luke"), AGENT_PAYER.APP],
  [
    "an agent's archiver",
    () => Schema.decodeUnknownSync(agentArchiverSchema)("luke"),
    AGENT_ARCHIVER.APP,
  ],
  [
    "a page version's shower",
    () => Schema.decodeUnknownSync(pageShowerSchema)({ kind: "luke" }),
    { kind: PAGE_SHOWER.APP },
  ],
  [
    "a comment's actor",
    () => Schema.decodeUnknownSync(planCommentActorSchema)("luke"),
    PLAN_COMMENT_ACTOR.APP,
  ],
  [
    "a wakeup line's channel",
    () => Schema.decodeUnknownSync(USER_MESSAGE_METADATA)({ channel: "luke" }),
    { channel: "app" },
  ],
  [
    "a GitHub trigger's senders",
    () =>
      Schema.decodeUnknownSync(automationTriggerSchema)({
        ...PULL_REQUEST_OPENED,
        senders: ["luke-agents"],
      }),
    { ...PULL_REQUEST_OPENED, senders: [GITHUB_SENDER.APP_AGENTS] },
  ],
  [
    "a kept picture's key",
    () => keptPictureIdOf({ luke: { attachmentId: "picture-1" } }),
    "picture-1",
  ],
])("%s stored as an earlier build wrote it reads as the app's", (_, stored, expected) => {
  assert.deepEqual(stored(), expected);
});
