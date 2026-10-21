import assert from "node:assert/strict";
import { CHANNEL_KIND } from "@luke/features/chat-wire";
import type { ChatNames } from "@luke/ui/chat-model";
import { test } from "vitest";
import { channelTitle } from "./chat-channel-name.js";
import { fixtureChat } from "./chat-fixture.js";
import { FIXTURE_TASK_ID } from "./tasks-fixture.js";

/** Names holding the tasks given, by id, and nothing else. */
function namesWith(tasks: ReadonlyMap<string, string>): ChatNames {
  return { agents: new Map(), tasks, agentTasks: new Map(), selfName: undefined };
}

test("a task's channel is called by its task's name as the window holds it, so a rename reaches it, and by its channel's own name until the task is read", () => {
  const read = fixtureChat({ fixtureMode: true }, Date.parse("2026-10-14T10:00:00Z"));
  assert.ok(read);
  const chat = read.answer;
  const channel = chat.channels.find(
    (each) => each.kind === CHANNEL_KIND.TASK && each.planId === FIXTURE_TASK_ID,
  );
  assert.ok(channel);
  assert.equal(
    channelTitle(chat, namesWith(new Map([[FIXTURE_TASK_ID, "Teammate invitations"]])), channel),
    "Teammate invitations",
  );
  assert.equal(channelTitle(chat, namesWith(new Map()), channel), "teammate-invitations");
  const topic = chat.channels.find((each) => each.kind === CHANNEL_KIND.TOPIC);
  assert.ok(topic);
  assert.equal(channelTitle(chat, namesWith(new Map()), topic), "#members-schema");
});
