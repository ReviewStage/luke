import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createTask,
  openTaskConversation,
  readTaskOfConversation,
} from "@luke/database/models/task-store";
import { messages, turns } from "@luke/database/schemas/storage";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { UNTITLED_TASK_NAME } from "@luke/features/task-wire";
import { MESSAGE_AUTHOR, MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { MockLanguageModelV4 } from "ai/test";
import { Effect, Option } from "effect";
import { BRAIN_TURN_TRIGGER, userMetadataOf } from "../../core.js";
import { openGithubUser } from "../../testing/github-app-fake.js";
import { CODER } from "../coder-host/bounds.js";
import { titleTask } from "./task-title.js";

/**
 * task-title.test.ts -- a task no member named is named once from its talk
 * with Luke, the notes the brain wrote down for itself left out; a task a
 * member named, and one past its first turns, ask the model nothing. The model is a script that
 * keeps what it was asked; the store is PGlite. Synthetic throughout.
 */

/** A model answering every call with `title`, keeping each prompt it was asked. */
function scriptedTitleModel(title: string) {
  const asked: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      asked.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: "text", text: title }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, asked };
}

/** A task started with `name`, or none, its conversation opened, and a talk with Luke in it. */
const openTalkedTask = (name?: string) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const organizationId = yield* openWorkspace(owner);
    const { id } = yield* createTask(owner, {
      organizationId,
      ...(name === undefined ? undefined : { name }),
    });
    const { conversationId } = Option.getOrThrow(yield* openTaskConversation(owner, id));
    const rows = [
      {
        role: MESSAGE_ROLE.USER,
        text: "The agent list changed on GitHub.",
        metadata: userMetadataOf(BRAIN_TURN_TRIGGER.WAKE, undefined),
      },
      {
        role: MESSAGE_ROLE.USER,
        text: "Invited teammates never get the email.",
        metadata: userMetadataOf(BRAIN_TURN_TRIGGER.ASK, undefined),
      },
      {
        role: MESSAGE_ROLE.ASSISTANT,
        text: "I'll look at the invite mailer.",
        metadata: { author: MESSAGE_AUTHOR.BRAIN },
      },
    ];
    yield* Database.use((db) =>
      db.insert(messages).values(
        rows.map((row, index) => ({
          userId: owner,
          conversationId,
          seq: index + 1,
          clientId: randomUUID(),
          role: row.role,
          parts: [{ type: "text" as const, text: row.text }],
          metadata: row.metadata,
          placedAt: new Date(),
          finishedAt: new Date(),
        })),
      ),
    );
    const target = { userId: owner, conversationId };
    const named = () =>
      Effect.map(readTaskOfConversation(owner, conversationId), (task) => Option.getOrThrow(task));
    return { owner, target, named };
  });

/** `count` settled turns recorded on the conversation. */
const ranTurns = (target: { userId: string; conversationId: string }, count: number) =>
  Database.use((db) =>
    db.insert(turns).values(
      Array.from({ length: count }, () => ({
        userId: target.userId,
        conversationId: target.conversationId,
        origin: TURN_ORIGIN.TYPED,
        status: TURN_STATUS.SETTLED,
      })),
    ),
  );

it.layer(getTestDB())("a task's generated name", (it) => {
  it.effect(
    "an untitled task is named from the developer's words, the brain's notes left out",
    () =>
      Effect.gen(function* () {
        const { owner, target, named } = yield* openTalkedTask();
        yield* ranTurns(target, 1);
        const { model, asked } = scriptedTitleModel("Fix invite emails");

        yield* titleTask(model, owner, target, yield* named());
        assert.equal((yield* named()).task.name, "Fix invite emails");
        assert.match(asked[0] ?? "", /Invited teammates never get the email/u);
        assert.match(asked[0] ?? "", /invite mailer/u);
        assert.doesNotMatch(asked[0] ?? "", /agent list changed/u);

        yield* titleTask(model, owner, target, yield* named());
        assert.equal(asked.length, 1, "a task the model named asks nothing again");
      }),
  );

  it.effect("a task a member named asks the model nothing", () =>
    Effect.gen(function* () {
      const { owner, target, named } = yield* openTalkedTask("Invites");
      yield* ranTurns(target, 1);
      const { model, asked } = scriptedTitleModel("Fix invite emails");

      yield* titleTask(model, owner, target, yield* named());
      assert.equal(asked.length, 0);
      assert.equal((yield* named()).task.name, "Invites");
    }),
  );

  it.effect("a task past its first turns keeps its name", () =>
    Effect.gen(function* () {
      const { owner, target, named } = yield* openTalkedTask();
      yield* ranTurns(target, CODER.TITLE_TURNS + 1);
      const { model, asked } = scriptedTitleModel("Fix invite emails");

      yield* titleTask(model, owner, target, yield* named());
      assert.equal(asked.length, 0);
      assert.equal((yield* named()).task.name, UNTITLED_TASK_NAME);
    }),
  );
});
