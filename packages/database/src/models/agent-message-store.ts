import { MESSAGE_CHANNEL, MESSAGE_ROLE } from "@luke/wire";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { conversations, messages } from "../schemas/storage.js";
import { MESSAGE_SENDER } from "../storage-vocabulary.js";
import type { ChatStoreEffect } from "./chat-store.js";
import { InstantColumnSchema } from "./columns.js";
import { isWorkspaceMember } from "./workspace-store.js";

/**
 * agent-message-store.ts -- the lines one coding agent sent another of its workspace, read for a person watching them talk.
 *
 * A coding agent's `message_agent` call writes one line into the
 * recipient's own conversation, its row naming the sending agent by id
 * (`messages.sender_agent_id`) and carrying the typed line's metadata. That
 * row is the record of the exchange, and this module reads it where it
 * stands rather than copying it anywhere, so delivery stays the one path
 * it is and nothing here can fall out of step with it.
 *
 * A line is read as an agent's message to another only where every part of
 * that is written down in its row: it is a user line, its sender is an
 * agent, the sending agent's id is kept, it came typed rather than as a
 * chat notice (a notice is a chat post the chat already shows), and both
 * the agent named as its sender and the agent whose conversation holds it
 * stand in the workspace asked about. A line from before the sender's id
 * was kept, an agent's own reply in its own transcript, and a line from a
 * person, Luke, an automation, or GitHub are none, and nothing is guessed
 * from a name or from the words. A person reads them only while a member
 * of the workspace, and an agent of a deleted conversation is read as gone.
 */

/** The most lines one read answers: the newest, which a window shows oldest first. */
const MAX_AGENT_MESSAGES = 200;

/** The sending agent, as a second reference to the agents' table beside the recipient's. */
const sender = alias(codingAgent, "sender_agent");

/** The first part of a line, its words, as the writer always leads a line with them. */
const LINE_WORDS = sql<string | null>`${messages.parts} -> 0 ->> 'text'`;

/** What a line's first part is, which is its words where it is `text`. */
const LINE_FIRST_PART = sql`${messages.parts} -> 0 ->> 'type'`;

const AgentMessageRowSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.NullOr(Schema.String),
  sentAt: InstantColumnSchema,
  fromAgentId: Schema.String,
  fromTitle: Schema.NullOr(Schema.String),
  fromModel: Schema.String,
  fromTaskId: Schema.NullOr(Schema.String),
  toAgentId: Schema.String,
  toTitle: Schema.NullOr(Schema.String),
  toModel: Schema.String,
  toTaskId: Schema.NullOr(Schema.String),
});

type AgentMessageRow = typeof AgentMessageRowSchema.Type;

const findAgentMessages = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, limit: Schema.Number }),
  Result: AgentMessageRowSchema,
  execute: ({ organizationId, limit }) =>
    Database.use((db) =>
      db
        .select({
          id: messages.id,
          text: LINE_WORDS,
          sentAt: messages.createdAt,
          fromAgentId: sender.id,
          fromTitle: sender.title,
          fromModel: sender.model,
          fromTaskId: sender.taskId,
          toAgentId: codingAgent.id,
          toTitle: codingAgent.title,
          toModel: codingAgent.model,
          toTaskId: codingAgent.taskId,
        })
        .from(codingAgent)
        .innerJoin(
          conversations,
          and(
            eq(conversations.id, codingAgent.conversationId),
            eq(conversations.userId, codingAgent.userId),
            isNull(conversations.deletedAt),
          ),
        )
        .innerJoin(
          messages,
          and(
            eq(messages.conversationId, codingAgent.conversationId),
            eq(messages.userId, codingAgent.userId),
          ),
        )
        .innerJoin(sender, eq(sender.id, messages.senderAgentId))
        .where(
          and(
            eq(codingAgent.organizationId, organizationId),
            eq(sender.organizationId, organizationId),
            eq(messages.role, MESSAGE_ROLE.USER),
            eq(messages.sender, MESSAGE_SENDER.AGENT),
            isNotNull(messages.senderAgentId),
            sql`${messages.metadata} ->> 'channel' = ${MESSAGE_CHANNEL.TYPED}`,
            sql`${LINE_FIRST_PART} = 'text'`,
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit),
    ),
});

/** One agent of a message, as its tab names it now: its title, or its model's id before it has one. */
export interface MessagingAgent {
  readonly agentId: string;
  readonly name: string;
  readonly model: string;
  /** The task it works on; none for an agent on no task. */
  readonly taskId: string | undefined;
}

/** One line a coding agent sent another: its words as sent, when, by whom, and to whom. */
export interface AgentMessage {
  readonly id: string;
  readonly text: string;
  readonly sentAt: Date;
  readonly from: MessagingAgent;
  readonly to: MessagingAgent;
}

function agentOf(id: string, title: string | null, model: string, taskId: string | null) {
  return { agentId: id, name: title ?? model, model, taskId: taskId ?? undefined };
}

function messageOf(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    text: row.text ?? "",
    sentAt: row.sentAt,
    from: agentOf(row.fromAgentId, row.fromTitle, row.fromModel, row.fromTaskId),
    to: agentOf(row.toAgentId, row.toTitle, row.toModel, row.toTaskId),
  };
}

/**
 * The newest lines the workspace's coding agents sent one another, as the
 * module's header reads them, oldest first and at most the bound; none
 * where the account is not a member of the workspace.
 */
export function agentMessagesOf(
  userId: string,
  organizationId: string,
): ChatStoreEffect<readonly AgentMessage[]> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return [];
    const rows = yield* findAgentMessages({ organizationId, limit: MAX_AGENT_MESSAGES });
    return rows.map(messageOf).toReversed();
  });
}
