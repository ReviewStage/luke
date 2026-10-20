import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations, messages } from "../../schemas/storage.js";
import { MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { agentMessagesOf } from "../agent-message-store.js";
import { createCodingAgent } from "../coding-agent-store.js";
import { createTask } from "../task-store.js";
import { type AwaitingLineMetadata, type LineSender, storeWriter } from "../writer.js";

/**
 * The lines one coding agent sent another, read for a person of their
 * workspace, over a real dialect and written through the store's own
 * writer as a send writes them: both directions of a pair in the order
 * sent, and nothing that is not an agent's explicit send to another of the
 * same workspace, nor anything for an account outside it.
 *
 * Synthetic accounts, workspaces, tasks, and agents throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** An agent the account starts on a new task of the workspace, titled as given, on the workspace's App unless its own token is asked. */
const openAgent = (
  userId: string,
  organizationId: string,
  title: string,
  githubAccess: GitHubAccess = GITHUB_ACCESS.APP,
) =>
  Effect.gen(function* () {
    const { id: taskId } = yield* createTask(userId, {
      organizationId,
      name: title,
      repository: "acme/api",
    });
    const started = yield* createCodingAgent(userId, {
      taskId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: `# ${title}\n`,
      prompt: null,
      repository: "acme/api",
      title,
      githubAccess,
    });
    return Option.getOrThrow(started).agent;
  });

type Agent = Effect.Success<ReturnType<typeof openAgent>>;

/** A chat notice's metadata, as a chat post steered into an agent carries it. */
const CHAT_NOTICE: AwaitingLineMetadata = {
  author: MESSAGE_AUTHOR.AGENT,
  channel: MESSAGE_CHANNEL.CHAT,
  chat_seq: 3,
  from: "Invites",
};

it.layer(getTestDB())("the agent message store", (it) => {
  it.effect(
    "a pair's explicit sends read in both directions in the order sent, and an agent's own reply, a chat notice, Luke's line, a line with no sender id, and a line from another workspace's agent read as none",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const charles = yield* openAccount;
        const stranger = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        yield* joinWorkspace(workspace, charles);
        const elsewhere = yield* openWorkspace(stranger);
        const invites = yield* openAgent(dean, workspace, "Invites");
        const billing = yield* openAgent(charles, workspace, "Billing");
        const outsider = yield* openAgent(stranger, elsewhere, "Outsider");
        const writer = yield* storeWriter({ tools: {} });
        /** A line written into the recipient's conversation as a send lands, a second later than the last. */
        const send = (
          to: Agent,
          text: string,
          sender: LineSender,
          metadata?: AwaitingLineMetadata,
        ) =>
          Effect.gen(function* () {
            yield* TestClock.adjust("1 second");
            yield* writer.writeAwaitingLine(
              { userId: to.userId, conversationId: to.conversationId },
              { text, clientKey: randomUUID(), sender, metadata },
              Effect.succeed(true),
            );
          });
        const from = (agent: Agent): LineSender => ({
          kind: MESSAGE_SENDER.AGENT,
          agentId: agent.id,
          name: agent.title ?? agent.model,
          model: agent.model,
        });
        yield* send(billing, "Is the invite schema settled?", from(invites));
        yield* send(invites, "Yes, merged an hour ago.", from(billing));
        yield* send(billing, "Posted in #general", from(invites), CHAT_NOTICE);
        yield* send(billing, "From a call", { kind: MESSAGE_SENDER.LUKE });
        yield* send(billing, "Hello from elsewhere", from(outsider));
        yield* send(billing, "An old line", { kind: MESSAGE_SENDER.AGENT, name: "Invites" });
        // Billing's own answer in its transcript is the turn's reply, never a line to Invites.
        const db = yield* Database;
        yield* db.insert(messages).values({
          userId: charles,
          conversationId: billing.conversationId,
          seq: 100,
          clientId: randomUUID(),
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [{ type: "text", text: "I told Invites it merged." }],
          createdAt: new Date(60_000),
          placedAt: new Date(60_000),
        });

        const read = yield* agentMessagesOf(charles, workspace);
        assert.deepEqual(
          read.map((message) => [message.from.name, message.to.name, message.text]),
          [
            ["Invites", "Billing", "Is the invite schema settled?"],
            ["Billing", "Invites", "Yes, merged an hour ago."],
          ],
        );
        assert.deepEqual(read[0]?.from, {
          agentId: invites.id,
          name: "Invites",
          model: "anthropic/claude-opus-5.5",
          taskId: invites.taskId ?? undefined,
        });
        assert.ok((read[0]?.sentAt.getTime() ?? 0) < (read[1]?.sentAt.getTime() ?? 0));
        assert.deepEqual(yield* agentMessagesOf(stranger, workspace), []);
      }),
  );

  it.effect(
    "a line to or from an agent on its starter's own token reads for its starter alone, never for a teammate who does not read its repository",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const charles = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        yield* joinWorkspace(workspace, charles);
        const invites = yield* openAgent(dean, workspace, "Invites", GITHUB_ACCESS.TOKEN);
        const billing = yield* openAgent(dean, workspace, "Billing");
        const writer = yield* storeWriter({ tools: {} });
        const send = (from: Agent, to: Agent, text: string) =>
          Effect.andThen(
            TestClock.adjust("1 second"),
            writer.writeAwaitingLine(
              { userId: to.userId, conversationId: to.conversationId },
              {
                text,
                clientKey: randomUUID(),
                sender: { kind: MESSAGE_SENDER.AGENT, agentId: from.id, name: from.title ?? "" },
              },
              Effect.succeed(true),
            ),
          );
        yield* send(invites, billing, "From the private agent");
        yield* send(billing, invites, "To the private agent");
        assert.deepEqual(
          (yield* agentMessagesOf(dean, workspace)).map((message) => message.text),
          ["From the private agent", "To the private agent"],
        );
        assert.deepEqual(yield* agentMessagesOf(charles, workspace), []);
      }),
  );

  it.effect("a line in a deleted conversation reads as none", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const workspace = yield* openWorkspace(dean);
      const invites = yield* openAgent(dean, workspace, "Invites");
      const billing = yield* openAgent(dean, workspace, "Billing");
      const writer = yield* storeWriter({ tools: {} });
      yield* writer.writeAwaitingLine(
        { userId: dean, conversationId: billing.conversationId },
        {
          text: "Ready for review",
          clientKey: randomUUID(),
          sender: { kind: MESSAGE_SENDER.AGENT, agentId: invites.id, name: "Invites" },
        },
        Effect.succeed(true),
      );
      assert.equal((yield* agentMessagesOf(dean, workspace)).length, 1);
      const db = yield* Database;
      yield* db
        .update(conversations)
        .set({ deletedAt: new Date(0) })
        .where(eq(conversations.id, billing.conversationId));
      assert.deepEqual(yield* agentMessagesOf(dean, workspace), []);
    }),
  );
});
