import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  FIRING_HANDS_OUTSIDE_WORDS,
} from "@luke/features/automation-wire";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import {
  MAC_COMMAND_KIND,
  type MacCommand,
  type MacCommandKind,
  type MacCommandResult,
  macCommandResultSchema,
} from "@luke/features/mac-command-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import {
  and,
  asc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, queryBuilder } from "../core/query.js";
import { automationRun } from "../schemas/automation.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { macCommand, macCommandListener } from "../schemas/mac-command.js";
import { conversations, messages } from "../schemas/storage.js";
import { MESSAGE_SENDER } from "../storage-vocabulary.js";
import type { TaskStoreEffect } from "./task-store.js";
import type { ConversationTarget } from "./writer.js";

/**
 * mac-command-store.ts -- the commands an account's agents queued for its Mac, and when a Mac last listened for them.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account claims, settles, or reads another's commands. A
 * command is claimed once, by the first Mac whose read names its kind and
 * takes it, and settled once, by a Mac after it was claimed; the call that
 * queued it reads the result and withdraws the row. A Mac that follows its
 * account's commands live subscribes to the unclaimed ones of its kinds
 * (`macCommandsLiveStatement`) and claims each by its id.
 */

const CommandKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

const KindSchema = Schema.Literals(Object.values(MAC_COMMAND_KIND));

const KindsSchema = Schema.Array(KindSchema);

/** A claimed row as the Mac is handed it: a shell command's text, and how long it may run. */
const ClaimedSchema = Schema.Struct({
  id: Schema.String,
  kind: KindSchema,
  command: Schema.String,
  timeoutSeconds: Schema.Number,
});

const upsertListener = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  execute: ({ userId, now }) =>
    Database.use((db) =>
      db
        .insert(macCommandListener)
        .values({ userId, seenAt: now })
        .onConflictDoUpdate({ target: macCommandListener.userId, set: { seenAt: now } }),
    ),
});

const findListener = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, since: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .select({ userId: macCommandListener.userId })
        .from(macCommandListener)
        .where(and(eq(macCommandListener.userId, userId), gte(macCommandListener.seenAt, since))),
    ),
});

const insertCommand = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    kind: KindSchema,
    command: Schema.String,
    timeoutSeconds: Schema.Number,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(macCommand).values({
        id: row.id,
        userId: row.userId,
        kind: row.kind,
        command: row.command,
        timeoutSeconds: row.timeoutSeconds,
        queuedAt: row.now,
      }),
    ),
});

/**
 * Whether a command still waits to be claimed by a read naming the kinds
 * given: of one of them, unclaimed, and queued at or after the instant
 * given, so a command no Mac took in time, or a row a call that died left
 * behind, is never run by a Mac that reads later, and a Mac is never
 * handed a kind it did not name.
 */
function waiting(
  userId: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): SQL | undefined {
  return and(
    eq(macCommand.userId, userId),
    inArray(macCommand.kind, kinds),
    isNull(macCommand.claimedAt),
    gte(macCommand.queuedAt, queuedSince),
  );
}

const claimWaiting = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    queuedSince: Schema.Date,
    kinds: KindsSchema,
    now: Schema.Date,
  }),
  Result: ClaimedSchema,
  execute: ({ userId, queuedSince, kinds, now }) =>
    Database.use((db) =>
      db
        .update(macCommand)
        .set({ claimedAt: now })
        .where(waiting(userId, queuedSince, kinds))
        .returning({
          id: macCommand.id,
          kind: macCommand.kind,
          command: macCommand.command,
          timeoutSeconds: macCommand.timeoutSeconds,
        }),
    ),
});

const claimOne = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...CommandKeySchema.fields,
    queuedSince: Schema.Date,
    kinds: KindsSchema,
    now: Schema.Date,
  }),
  Result: ClaimedSchema,
  execute: ({ userId, id, queuedSince, kinds, now }) =>
    Database.use((db) =>
      db
        .update(macCommand)
        .set({ claimedAt: now })
        .where(and(eq(macCommand.id, id), waiting(userId, queuedSince, kinds)))
        .returning({
          id: macCommand.id,
          kind: macCommand.kind,
          command: macCommand.command,
          timeoutSeconds: macCommand.timeoutSeconds,
        }),
    ),
});

const findWaiting = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, queuedSince: Schema.Date, kinds: KindsSchema }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, queuedSince, kinds }) =>
    Database.use((db) =>
      db
        .select({ id: macCommand.id })
        .from(macCommand)
        .where(waiting(userId, queuedSince, kinds))
        .orderBy(asc(macCommand.queuedAt)),
    ),
});

const writeResult = SqlSchema.findAll({
  Request: Schema.Struct({ ...CommandKeySchema.fields, result: macCommandResultSchema }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, result }) =>
    Database.use((db) =>
      db
        .update(macCommand)
        .set({ result })
        .where(
          and(
            eq(macCommand.id, id),
            eq(macCommand.userId, userId),
            isNotNull(macCommand.claimedAt),
            isNull(macCommand.result),
          ),
        )
        .returning({ id: macCommand.id }),
    ),
});

const findResult = SqlSchema.findOneOption({
  Request: CommandKeySchema,
  Result: Schema.Struct({ result: macCommandResultSchema }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ result: macCommand.result })
        .from(macCommand)
        .where(
          and(eq(macCommand.id, id), eq(macCommand.userId, userId), isNotNull(macCommand.result)),
        ),
    ),
});

/** A child conversation, which a worker runs in, read through to the root its lines were sent to. */
const parent = alias(conversations, "parent");

/** The agent that sent a line, read for whose it is. */
const sendingAgent = alias(codingAgent, "sending_agent");

/** The root's developer lines before one of them, read for whether it is the first, the prompt the agent was started on. */
const earlierLine = alias(messages, "earlier_line");

/** The agent the root conversation is of, read for whether it is an operator, whether it was started on a prompt or a plan at all, and what fired the automation's run that started it. */
const startedAgent = alias(codingAgent, "started_agent");

/** The firings whose run hands its agent words its owner did not write beside the automation's prompt. */
const OUTSIDE_FIRINGS = Object.values(AUTOMATION_FIRING).filter(
  (kind) => FIRING_HANDS_OUTSIDE_WORDS[kind],
);

/** That the automation's run that started the root's agent was fired by words its owner did not write, as the agent's origin keeps it whatever becomes of the automation. */
const STARTED_ON_OUTSIDE_WORDS = inArray(
  sql<string | null>`${startedAgent.automationOrigin} -> 'firing' ->> 'kind'`,
  OUTSIDE_FIRINGS,
);

/**
 * That a run fired by words its owner did not write was handed to the root's
 * agent: the run that started it, or one sent to it, which is claimed for
 * the agent before its line is sent. A run that failed handed it nothing,
 * since a send refused withdraws its line, so only one that started counts.
 * Note that the runs go with their automation, so this holds only while it
 * stands.
 */
const HANDED_OUTSIDE_RUN = exists(
  queryBuilder
    .select({ id: automationRun.id })
    .from(automationRun)
    .where(
      and(
        or(
          eq(automationRun.claimedAgentId, startedAgent.id),
          eq(automationRun.codingAgentId, startedAgent.id),
        ),
        eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
        inArray(sql<string>`${automationRun.firing} ->> 'kind'`, OUTSIDE_FIRINGS),
      ),
    ),
);

/** What an automation's line says of what fired its run: `true` or `false`, or null on a line kept before it said. */
const LINE_OUTSIDE_WORDS = sql<string | null>`${messages.metadata} ->> 'outside_words'`;

/**
 * One line of the conversation's root, or the root's own where it is one,
 * that another account put there: a member other than the owner, a former
 * member, or an agent that is not the owner's own or is gone. An
 * automation's line counts where what fired its run put words its owner did
 * not write beside the automation's prompt: a webhook's body, an
 * integration's event, or a GitHub event's (`FIRING_HANDS_OUTSIDE_WORDS`),
 * as the line says itself (`outside_words`); a line kept before it said
 * counts where the run that started the agent was so fired, or a run so
 * fired was sent to it while its automation stands. A schedule's run and a
 * "Run now" carry the owner's prompt alone, so an operator's heartbeat is
 * its owner's. A developer's
 * line written before senders were kept, a `user` row with no sender, counts
 * too, because nothing says whose it was; all but the root's first where the
 * agent was started on a prompt or a plan, which that first line is, written
 * untagged by eve's relay for every agent started before the start wrote it
 * with its sender (`coder-host/start.ts`), unless the automation's run that
 * started the agent was fired by words its owner did not write, which that
 * first line holds. A blank agent was started on
 * none, so its first line is whoever's first steer, and counts. An
 * operator's untagged lines are its owner's and never count, because its
 * conversation is its owner's alone: anyone else's words reach it tagged,
 * and its untagged lines are the opening eve's relay wrote before the
 * service sent it as Luke's (`coder-host/operator.ts`) and its owner's own
 * from before senders were kept.
 */
const findForeignLine = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: messages.id })
        .from(conversations)
        .leftJoin(parent, eq(parent.id, conversations.parentConversationId))
        .innerJoin(
          messages,
          eq(messages.conversationId, sql`coalesce(${parent.id}, ${conversations.id})`),
        )
        .leftJoin(sendingAgent, eq(sendingAgent.id, messages.senderAgentId))
        .leftJoin(
          startedAgent,
          eq(startedAgent.conversationId, sql`coalesce(${parent.id}, ${conversations.id})`),
        )
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            or(
              and(
                eq(messages.sender, MESSAGE_SENDER.MEMBER),
                or(isNull(messages.senderUserId), ne(messages.senderUserId, userId)),
              ),
              and(
                eq(messages.sender, MESSAGE_SENDER.AGENT),
                or(isNull(sendingAgent.userId), ne(sendingAgent.userId, userId)),
              ),
              and(
                eq(messages.sender, MESSAGE_SENDER.AUTOMATION),
                or(
                  eq(LINE_OUTSIDE_WORDS, "true"),
                  and(isNull(LINE_OUTSIDE_WORDS), or(STARTED_ON_OUTSIDE_WORDS, HANDED_OUTSIDE_RUN)),
                ),
              ),
              and(
                eq(messages.role, MESSAGE_ROLE.USER),
                isNull(messages.sender),
                or(isNull(startedAgent.kind), ne(startedAgent.kind, CODING_AGENT_KIND.OPERATOR)),
                or(
                  and(isNull(startedAgent.prompt), isNull(startedAgent.planSnapshot)),
                  STARTED_ON_OUTSIDE_WORDS,
                  exists(
                    db
                      .select({ seq: earlierLine.seq })
                      .from(earlierLine)
                      .where(
                        and(
                          eq(earlierLine.conversationId, messages.conversationId),
                          eq(earlierLine.role, MESSAGE_ROLE.USER),
                          lt(earlierLine.seq, messages.seq),
                        ),
                      ),
                  ),
                ),
              ),
            ),
          ),
        )
        .limit(1),
    ),
});

const deleteCommand = SqlSchema.void({
  Request: CommandKeySchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db.delete(macCommand).where(and(eq(macCommand.id, id), eq(macCommand.userId, userId))),
    ),
});

/** Records that a Mac of the account is listening now, for shell commands, which every Mac runs. */
export function markMacListening(userId: string): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => upsertListener({ userId, now }));
}

/** Whether a Mac of the account listened at or after the instant given. */
export function macListeningSince(userId: string, since: Date): TaskStoreEffect<boolean> {
  return Effect.map(findListener({ userId, since }), Option.isSome);
}

/**
 * Whether anyone but the conversation's owner has put words into it: a line
 * another member sent, one an agent that is not the owner's own sent, one an
 * automation sent with words its owner did not write, such as a webhook's
 * body, or one whose sender was never kept past the opening prompt, of an
 * agent that is not an operator, in the conversation
 * or, for a worker's, in the agent's it was delegated from. Note that a line
 * the service itself sends, such as a wake, is not counted, because no other
 * account wrote it.
 */
export function heardFromAnotherAccount(target: ConversationTarget): TaskStoreEffect<boolean> {
  return Effect.map(findForeignLine(target), Option.isSome);
}

/** Queues one command for the account's Mac, under the id its caller minted. */
export function queueMacCommand(userId: string, queued: MacCommand): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    insertCommand({
      id: queued.id,
      userId,
      kind: queued.kind,
      command: queued.command,
      timeoutSeconds: queued.timeoutSeconds,
      now,
    }),
  );
}

/**
 * Whether any command of the account, of the kinds given, queued at or
 * after `queuedSince` waits to be claimed, which is what a held read looks at.
 */
export function macCommandsWaiting(
  userId: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): TaskStoreEffect<boolean> {
  return Effect.map(findWaiting({ userId, queuedSince, kinds }), (rows) => rows.length > 0);
}

/**
 * Claims every command of the account, of the kinds given, queued at or
 * after `queuedSince` that waits, for the Mac whose read this is.
 */
export function claimMacCommands(
  userId: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): TaskStoreEffect<readonly MacCommand[]> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    claimWaiting({ userId, queuedSince, kinds, now }),
  );
}

/**
 * Claims one command of the account by its id, for the Mac that asked,
 * where it is of the kinds given, still waits, and was queued at or after
 * `queuedSince`; none where another Mac took it first, its call withdrew it,
 * or it waited too long.
 */
export function claimMacCommand(
  userId: string,
  id: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): TaskStoreEffect<Option.Option<MacCommand>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    claimOne({ userId, id, queuedSince, kinds, now }),
  );
}

/**
 * The account's commands of the kinds given that no Mac has claimed yet,
 * written as a live read, each column under the key `live-wire.ts` reads it
 * by and the instant it was queued in epoch milliseconds. Note that it names
 * no claim window, because a live read measures nothing from the clock: the
 * claim (`claimMacCommand`) keeps the window, on the service's clock. The
 * order is the reader's to keep. None where the statement names a value a
 * live read cannot carry.
 */
export function macCommandsLiveStatement(
  userId: string,
  kinds: readonly MacCommandKind[],
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            id: macCommand.id,
            kind: macCommand.kind,
            command: macCommand.command,
            timeoutSeconds: macCommand.timeoutSeconds,
          },
          { queuedAt: macCommand.queuedAt },
        ),
      )
      .from(macCommand)
      .where(
        and(
          eq(macCommand.userId, userId),
          inArray(macCommand.kind, kinds),
          isNull(macCommand.claimedAt),
        ),
      ),
  );
}

/** Keeps a claimed command's result; false where the account holds no such command claimed and unsettled. */
export function settleMacCommand(
  userId: string,
  id: string,
  result: MacCommandResult,
): TaskStoreEffect<boolean> {
  return Effect.map(writeResult({ userId, id, result }), (rows) => rows.length > 0);
}

/** A command's result once a Mac settled it; nothing while it waits or runs. */
export function macCommandResult(
  userId: string,
  id: string,
): TaskStoreEffect<Option.Option<MacCommandResult>> {
  return Effect.map(
    findResult({ userId, id }),
    Option.map(({ result }) => result),
  );
}

/** Withdraws a command, settled or not, once its call stops waiting on it. */
export function withdrawMacCommand(userId: string, id: string): TaskStoreEffect<void> {
  return deleteCommand({ userId, id });
}
