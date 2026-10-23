import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { macCommandsLiveRowsSchema, macCommandsOfLiveRows } from "@luke/features/live-wire";
import {
  MAC_COMMAND_KIND,
  type MacCommand,
  type MacCommandKind,
  type MacCommandResult,
} from "@luke/features/mac-command-wire";
import { MESSAGE_ROLE, type MessageRole } from "@luke/wire";
import { eq, sql } from "drizzle-orm";
import { Clock, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { macCommand } from "../../schemas/mac-command.js";
import { conversations, messages } from "../../schemas/storage.js";
import { CONVERSATION_KIND, MESSAGE_SENDER, type MessageSender } from "../../storage-vocabulary.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  claimMacCommand,
  claimMacCommands,
  heardFromAnotherAccount,
  macCommandResult,
  macCommandsLiveStatement,
  macCommandsWaiting,
  macListeningSince,
  markMacListening,
  queueMacCommand,
  settleMacCommand,
} from "../mac-command-store.js";

/**
 * The commands an account's agents queue for its Mac, over a real dialect:
 * a command is claimed once and settled once, by its own account alone, a
 * row its call has stopped waiting for is never claimed, a read claims and
 * waits on only the kinds it names, so a row of a kind no read names now
 * is left be, a row queued before kinds were reads as a shell command, and
 * a Mac counts as listening from its last read on. The live statement
 * delivers what a Mac following live would claim: the account's unclaimed
 * commands of its kinds and no one else's.
 *
 * Synthetic accounts and commands throughout.
 */

/** The instant the clock reads now, which every command these tests queue is at or after. */
const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis));

const RESULT: MacCommandResult = {
  exitCode: 0,
  stdout: "main\n",
  stderr: "",
  truncated: false,
  timedOut: false,
};

/** The account's unclaimed commands of the kinds given as a Mac following them live decodes them, the statement run as Realtime runs it. */
const liveCommandsOf = (userId: string, kinds: readonly MacCommandKind[]) =>
  Effect.gen(function* () {
    const statement = Option.getOrThrow(macCommandsLiveStatement(userId, kinds));
    const sql = yield* SqlClient.SqlClient;
    const commands = yield* sql.unsafe(statement.sql, [...statement.params]);
    return macCommandsOfLiveRows(
      yield* Schema.decodeUnknownEffect(macCommandsLiveRowsSchema)({ commands }),
    );
  });

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

const command = (timeoutSeconds = 60): MacCommand => ({
  id: randomUUID(),
  kind: MAC_COMMAND_KIND.SHELL,
  command: "git branch --show-current",
  timeoutSeconds,
});

/**
 * A row of a kind no read names now, as a service that still queued Mac
 * Browser commands left one waiting, written as that build wrote it; its id.
 */
const queueOtherKind = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const queuedAt = (yield* now).toISOString();
    yield* db.execute(
      sql`INSERT INTO mac_command (id, user_id, kind, timeout_seconds, queued_at)
          VALUES (${id}, ${userId}, 'browser', 30, ${queuedAt})`,
    );
    return id;
  });

/** What every Mac's read names: shell alone. */
const SHELL_ONLY = [MAC_COMMAND_KIND.SHELL];

it.layer(getTestDB())("the Mac command store", (it) => {
  it.effect(
    "a command is claimed and settled once, by its own account, and its result read by that account alone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const since = yield* now;
        const queued = command();
        yield* queueMacCommand(owner, queued);

        const claimedByOther = yield* claimMacCommands(other, since, SHELL_ONLY);
        const settledByOther = yield* settleMacCommand(other, queued.id, RESULT);
        const settledUnclaimed = yield* settleMacCommand(owner, queued.id, RESULT);
        const claimed = yield* claimMacCommands(owner, since, SHELL_ONLY);
        const claimedAgain = yield* claimMacCommands(owner, since, SHELL_ONLY);
        const settled = yield* settleMacCommand(owner, queued.id, RESULT);
        const settledAgain = yield* settleMacCommand(owner, queued.id, { ...RESULT, exitCode: 1 });

        assert.deepEqual(claimedByOther, []);
        assert.equal(settledByOther, false, "another account settles nothing");
        assert.equal(settledUnclaimed, false, "nothing is settled before a Mac claims it");
        assert.deepEqual(claimed, [queued]);
        assert.deepEqual(claimedAgain, [], "a claimed command is not handed out twice");
        assert.equal(settled, true);
        assert.equal(settledAgain, false, "the first result stands");
        assert.deepEqual(yield* macCommandResult(owner, queued.id), Option.some(RESULT));
        assert.deepEqual(yield* macCommandResult(other, queued.id), Option.none());
      }),
  );

  it.effect("a row of a kind no read names is neither waited on nor claimed", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const since = yield* now;
      const shell = command();
      const other = yield* queueOtherKind(owner);

      const waits = yield* macCommandsWaiting(owner, since, SHELL_ONLY);
      yield* queueMacCommand(owner, shell);
      const claimed = yield* claimMacCommands(owner, since, SHELL_ONLY);
      const claimedById = yield* claimMacCommand(owner, other, since, SHELL_ONLY);

      assert.equal(waits, false, "a row of another kind does not wake the read");
      assert.deepEqual(claimed, [shell]);
      assert.deepEqual(claimedById, Option.none());
    }),
  );

  it.effect("a row queued before kinds were reads as a shell command", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const { owner } = yield* openAccounts;
      const since = yield* now;
      const id = randomUUID();
      // Note that the row is written as a build before kinds wrote one, naming no kind.
      yield* db.execute(
        sql`INSERT INTO mac_command (id, user_id, command, timeout_seconds, queued_at)
            VALUES (${id}, ${owner}, 'uptime', 60, ${since.toISOString()})`,
      );

      const [row] = yield* db
        .select({ kind: macCommand.kind })
        .from(macCommand)
        .where(eq(macCommand.id, id));
      const claimed = yield* claimMacCommands(owner, since, SHELL_ONLY);

      assert.equal(row?.kind, MAC_COMMAND_KIND.SHELL);
      assert.deepEqual(claimed, [
        { id, kind: MAC_COMMAND_KIND.SHELL, command: "uptime", timeoutSeconds: 60 },
      ]);
    }),
  );

  it.effect("a Mac counts as listening from its read on, for its own account alone", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const since = yield* now;

      const before = yield* macListeningSince(owner, since);
      yield* markMacListening(owner);
      const after = yield* macListeningSince(owner, since);
      const forOther = yield* macListeningSince(other, since);

      assert.equal(before, false);
      assert.equal(after, true);
      assert.equal(forOther, false);
    }),
  );

  it.effect(
    "the live statement delivers the account's unclaimed commands of the kinds named, the earliest first, and one claimed by its id leaves it, claimed once and by its own account alone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const since = yield* now;
        const [first, second] = [command(), command(30)];
        yield* queueMacCommand(owner, first);
        yield* queueMacCommand(owner, second);
        yield* queueOtherKind(owner);
        yield* queueMacCommand(other, command());

        assert.deepEqual(
          (yield* liveCommandsOf(owner, SHELL_ONLY)).map(({ id }) => id).toSorted(),
          [first.id, second.id].toSorted(),
          "a row of a kind not named is left out",
        );
        assert.equal(
          (yield* liveCommandsOf(other, SHELL_ONLY)).length,
          1,
          "another's are their own",
        );

        assert.deepEqual(
          yield* claimMacCommand(other, second.id, since, SHELL_ONLY),
          Option.none(),
        );
        assert.deepEqual(
          yield* claimMacCommand(owner, second.id, since, SHELL_ONLY),
          Option.some(second),
        );
        assert.deepEqual(
          yield* claimMacCommand(owner, second.id, since, SHELL_ONLY),
          Option.none(),
        );
        assert.deepEqual(yield* liveCommandsOf(owner, SHELL_ONLY), [first]);
      }),
  );

  it.effect("a command queued before the claim window began is never claimed by its id", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const queued = command();
      yield* queueMacCommand(owner, queued);
      const later = new Date((yield* Clock.currentTimeMillis) + 1);

      assert.deepEqual(
        yield* claimMacCommand(owner, queued.id, later, [MAC_COMMAND_KIND.SHELL]),
        Option.none(),
      );
      assert.deepEqual(yield* liveCommandsOf(owner, [MAC_COMMAND_KIND.SHELL]), [queued]);
    }),
  );
});

/** A coding agent's conversation under the account, with the agent itself in the workspace given, started on the prompt given or blank, answering both ids. */
const openAgent = (userId: string, organizationId: string, prompt: string | null = null) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [id, conversationId] = [randomUUID(), randomUUID()];
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
    yield* db.insert(codingAgent).values({
      id,
      organizationId,
      userId,
      conversationId,
      prompt,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/api",
      repositories: ["acme/api"],
      idempotencyKey: randomUUID(),
    });
    return { id, conversationId };
  });

/** A worker's conversation delegated from the one given, under the same account. */
const openWorker = (userId: string, parentConversationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(conversations).values({
      id,
      userId,
      kind: CONVERSATION_KIND.CHILD,
      parentConversationId,
    });
    return id;
  });

/**
 * One line sent into the conversation, as the writer keeps a developer's or
 * an agent's line to a coding agent; with no sender, as a line was kept
 * before senders were, or as the model's own reply is.
 */
const sendLine = (
  owner: string,
  conversationId: string,
  seq: number,
  sender?: {
    readonly kind: MessageSender;
    readonly userId?: string;
    readonly agentId?: string;
  },
  role: MessageRole = MESSAGE_ROLE.USER,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(messages).values({
      userId: owner,
      conversationId,
      seq,
      clientId: randomUUID(),
      role,
      parts: [],
      placedAt: yield* now,
      sender: sender?.kind ?? null,
      senderUserId: sender?.userId ?? null,
      senderAgentId: sender?.agentId ?? null,
    });
  });

it.layer(getTestDB())("who has put words into an agent's conversation", (it) => {
  const people = Effect.gen(function* () {
    const { owner: starter, other: teammate } = yield* openAccounts;
    const workspace = yield* openWorkspace(starter);
    return { starter, teammate, workspace };
  });

  it.effect(
    "only the starter, their own agents, and the service's wakes leave it the starter's",
    () =>
      Effect.gen(function* () {
        const { starter, workspace } = yield* people;
        const agent = yield* openAgent(starter, workspace);
        const own = yield* openAgent(starter, workspace);
        yield* sendLine(starter, agent.conversationId, 1, {
          kind: MESSAGE_SENDER.MEMBER,
          userId: starter,
        });
        yield* sendLine(starter, agent.conversationId, 2, {
          kind: MESSAGE_SENDER.AGENT,
          agentId: own.id,
        });
        yield* sendLine(starter, agent.conversationId, 3, { kind: MESSAGE_SENDER.LUKE });
        const target = { userId: starter, conversationId: agent.conversationId };
        assert.equal(yield* heardFromAnotherAccount(target), false);
      }),
  );

  it.effect("a teammate's line, or a line from their agent, counts as another account's", () =>
    Effect.gen(function* () {
      const { starter, teammate, workspace } = yield* people;
      const messaged = yield* openAgent(starter, workspace);
      yield* sendLine(starter, messaged.conversationId, 1, {
        kind: MESSAGE_SENDER.MEMBER,
        userId: teammate,
      });
      const theirs = yield* openAgent(teammate, workspace);
      const reached = yield* openAgent(starter, workspace);
      yield* sendLine(starter, reached.conversationId, 1, {
        kind: MESSAGE_SENDER.AGENT,
        agentId: theirs.id,
      });
      for (const { conversationId } of [messaged, reached]) {
        assert.equal(yield* heardFromAnotherAccount({ userId: starter, conversationId }), true);
      }
    }),
  );

  it.effect("a line whose sender is gone counts as another account's", () =>
    Effect.gen(function* () {
      const { starter, workspace } = yield* people;
      const agent = yield* openAgent(starter, workspace);
      yield* sendLine(starter, agent.conversationId, 1, { kind: MESSAGE_SENDER.MEMBER });
      yield* sendLine(starter, agent.conversationId, 2, {
        kind: MESSAGE_SENDER.AGENT,
        agentId: randomUUID(),
      });
      const target = { userId: starter, conversationId: agent.conversationId };
      assert.equal(yield* heardFromAnotherAccount(target), true);
    }),
  );

  it.effect(
    "a developer's line kept before senders were counts as another account's, all but the prompt an agent was started on",
    () =>
      Effect.gen(function* () {
        const { starter, workspace } = yield* people;
        const agent = yield* openAgent(starter, workspace, "Find the flakiest test and fix it.");
        const target = { userId: starter, conversationId: agent.conversationId };
        yield* sendLine(starter, agent.conversationId, 1, undefined, MESSAGE_ROLE.ASSISTANT);
        assert.equal(yield* heardFromAnotherAccount(target), false, "the model's own reply");
        yield* sendLine(starter, agent.conversationId, 2);
        assert.equal(yield* heardFromAnotherAccount(target), false, "the prompt it was started on");
        yield* sendLine(starter, agent.conversationId, 3);
        assert.equal(
          yield* heardFromAnotherAccount(target),
          true,
          "a later line nothing says whose it was",
        );
      }),
  );

  it.effect("a blank agent's first untagged line counts, since it was started on no prompt", () =>
    Effect.gen(function* () {
      const { starter, workspace } = yield* people;
      const blank = yield* openAgent(starter, workspace);
      yield* sendLine(starter, blank.conversationId, 1);
      const target = { userId: starter, conversationId: blank.conversationId };
      assert.equal(yield* heardFromAnotherAccount(target), true);
    }),
  );

  it.effect("a worker's conversation reads the lines of the agent it was delegated from", () =>
    Effect.gen(function* () {
      const { starter, teammate, workspace } = yield* people;
      const agent = yield* openAgent(starter, workspace);
      const worker = yield* openWorker(starter, agent.conversationId);
      const target = { userId: starter, conversationId: worker };
      assert.equal(yield* heardFromAnotherAccount(target), false);
      yield* sendLine(starter, agent.conversationId, 1, {
        kind: MESSAGE_SENDER.MEMBER,
        userId: teammate,
      });
      assert.equal(yield* heardFromAnotherAccount(target), true);
    }),
  );

  it.effect("an account reads nothing of a conversation that is not its own", () =>
    Effect.gen(function* () {
      const { starter, teammate, workspace } = yield* people;
      const agent = yield* openAgent(starter, workspace);
      yield* sendLine(starter, agent.conversationId, 1, {
        kind: MESSAGE_SENDER.MEMBER,
        userId: teammate,
      });
      const target = { userId: teammate, conversationId: agent.conversationId };
      assert.equal(yield* heardFromAnotherAccount(target), false);
    }),
  );
});
