import { isTextUIPart } from "ai";
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  type BrainChildAccess,
  CHILD_SPAWN_REFUSAL,
  CHILD_STATUS,
  type ChildCancellation,
  type ChildRunRecord,
  type ChildSpawnOutcome,
  type ChildSpawnRefusal,
  type ConversationRecord,
  childSessionKey,
  childTaskInputText,
  CONVERSATION_KIND as RECORD_CONVERSATION_KIND,
  type SessionKey,
  type StoredUIMessage,
  sessionKey,
} from "../../core.js";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";
import { CATALOG_TOOL_SET } from "../brain-tool-set.js";
import {
  type ChildRecord,
  listChildren,
  listChildrenOf,
  readChild,
  readSpawningMessage,
} from "../store/children.js";
import type { ConversationTarget, StoreWriter } from "../store/index.js";
import {
  type ConversationDirectoryEntry,
  conversationDirectory,
} from "../store/standing-conversations.js";
import { CHILD_OPEN_REFUSAL, type ChildOpenerSeams, openChild } from "./child-opener.js";
import { readRecentMessages } from "./context.js";
import { EVE_CALLER, EVE_CANCEL_OUTCOME } from "./eve-sessions.js";

/**
 * Delegation as the hosted brain's session tools reach it, for one admitted
 * conversation: what the brain package's `BrainChildAccess` asks for,
 * answered from the store's children rows and the child opener. The tools
 * validate a call's arguments; this validates ownership, so a child named by
 * id that is not this conversation's is answered as nothing, whatever
 * account it belongs to. A spawn is refused before the opener hears it when
 * the asking conversation is itself a child (one level of delegation and no
 * more), when it already has its share of children still under way, or when
 * the account does; the bounds are `HOSTED_CHILDREN`. A cancel is eve's
 * cancel of the child's turn under way, scoped to that turn by eve's own id
 * for it, and then the turn row's stamp, the same two steps the Stop route
 * takes for an ask. Nothing here reads a child's messages except the history
 * a parent asks for, bounded by the tool's own line limit.
 */

/** The bounds delegation runs under in the hosted brain; each is a product knob as much as a number. */
export const HOSTED_CHILDREN = {
  /** How many children one conversation may have accepted or running at once. */
  MAXIMUM_ACTIVE_PER_REQUESTER: 5,
  /** How many children one account may have accepted or running at once, across its conversations. */
  MAXIMUM_ACTIVE_GLOBAL: 8,
  /**
   * How many of the account's children, newest first, one read considers.
   * The active counts are taken among them: a child still under way with
   * this many newer ended children in front of it is not counted, an edge
   * accepted over a second query per spawn.
   */
  LIST_LIMIT: 200,
  /**
   * How many of a child's messages one history read considers before the
   * tool's line limit is applied: a message of tool calls alone is no line,
   * so the bound is taken over the lines that remain, not the rows read.
   */
  LINES_WINDOW: 200,
  /** How many of the account's conversations, most recently written to first, one `sessions_list` answers. */
  DIRECTORY_LIMIT: 100,
} as const;

/** The refusal the brain reads for each way the opener declines: no child was opened, and this is the nearest reason. */
const SPAWN_REFUSAL_OF_OPEN_REFUSAL = {
  [CHILD_OPEN_REFUSAL.UNCONFIGURED]: CHILD_SPAWN_REFUSAL.STOPPED,
  [CHILD_OPEN_REFUSAL.NO_PARENT]: CHILD_SPAWN_REFUSAL.PERSISTENCE,
  [CHILD_OPEN_REFUSAL.EVE_REFUSED]: CHILD_SPAWN_REFUSAL.PERSISTENCE,
} as const satisfies Record<
  (typeof CHILD_OPEN_REFUSAL)[keyof typeof CHILD_OPEN_REFUSAL],
  ChildSpawnRefusal
>;

const NO_SPAWNING_MESSAGE = "no message of this turn stands to spawn the child from";

type StoredConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

export interface HostedChildrenSeams {
  /** The conversation the tools belong to and its kind, as admission established them. */
  readonly conversation: ConversationTarget;
  readonly kind: StoredConversationKind;
  /** The turn whose call is spawning, whose journal a child hangs from. */
  readonly turnId: string;
  /** The opener's own seams; a cancel reaches eve through the same client and caller a spawn does. */
  readonly opener: ChildOpenerSeams;
  readonly writer: Pick<StoreWriter, "requestTurnCancel">;
  readonly now: () => number;
}

/** Whether a child still counts against a limit: accepted or running, not yet ended. */
function isActive(child: ChildRecord): boolean {
  return child.status === CHILD_STATUS.ACCEPTED || child.status === CHILD_STATUS.RUNNING;
}

/** The key a hosted conversation is named by to the brain: a child's derived key, and the row's own id otherwise. */
function hostedSessionKeyOf(kind: StoredConversationKind, conversationId: string): SessionKey {
  return kind === CONVERSATION_KIND.CHILD
    ? childSessionKey(conversationId)
    : sessionKey(conversationId);
}

/** One store child as the brain's record of a run; the store's status is the brain's, word for word. */
function childRunRecordOf(child: ChildRecord): ChildRunRecord {
  return {
    childId: child.id,
    ...(child.label !== null ? { label: child.label } : undefined),
    status: child.status,
    acceptedAt: child.createdAt.getTime(),
    ...(child.settledAt !== null ? { settledAt: child.settledAt.getTime() } : undefined),
    ...(child.failure !== null ? { failureDetail: child.failure } : undefined),
  };
}

/** A directory row as the brain's record of a conversation: named by its label, the session it observes, or its kind. */
function conversationRecordOf(entry: ConversationDirectoryEntry): ConversationRecord {
  switch (entry.kind) {
    case CONVERSATION_KIND.MAIN:
      return conversationRecord(entry, RECORD_CONVERSATION_KIND.MAIN, entry.kind);
    case CONVERSATION_KIND.OBSERVED:
      return conversationRecord(
        entry,
        RECORD_CONVERSATION_KIND.OBSERVED,
        entry.providerSessionId ?? entry.kind,
      );
    case CONVERSATION_KIND.CHILD:
      return conversationRecord(
        entry,
        RECORD_CONVERSATION_KIND.CHILD,
        entry.label ?? `Child ${entry.id}`,
      );
  }
}

function conversationRecord(
  entry: ConversationDirectoryEntry,
  kind: ConversationRecord["kind"],
  name: string,
): ConversationRecord {
  return {
    sessionKey: hostedSessionKeyOf(entry.kind, entry.id),
    kind,
    name,
    createdAt: entry.createdAt.getTime(),
    lastActivityAt: entry.lastActivityAt.getTime(),
  };
}

/** A stored message's own words, its text parts joined; a message of tool calls alone is no line. */
function lineOf(message: StoredUIMessage): string {
  return message.parts
    .filter((part) => isTextUIPart(part))
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .join(" ");
}

function refused(reason: ChildSpawnRefusal, detail?: string): ChildSpawnOutcome {
  return { accepted: false, reason, ...(detail !== undefined ? { detail } : undefined) };
}

/**
 * The access for one conversation over the request's own client, as the
 * module comment describes. Every read below answers `Effect<A, never,
 * never>`, the way the other tool seams do, so a row the service cannot read
 * dies rather than becoming a reason the model is offered.
 */
export function hostedChildAccess(
  client: SqlClient.SqlClient,
  seams: HostedChildrenSeams,
): BrainChildAccess {
  const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>): Effect.Effect<A> =>
    Effect.orDie(Effect.provideService(effect, SqlClient.SqlClient, client));
  const { userId, conversationId } = seams.conversation;
  /** One of this conversation's own children, or nothing for an id that names none of them. */
  const own = (childId: string) =>
    Effect.map(readChild(userId, childId), (found) =>
      found._tag === "Some" && found.value.parentConversationId === conversationId
        ? found.value
        : undefined,
    );
  return {
    sessionKey: hostedSessionKeyOf(seams.kind, conversationId),

    spawn: (ask) =>
      run(
        Effect.gen(function* () {
          if (seams.kind === CONVERSATION_KIND.CHILD) {
            return refused(CHILD_SPAWN_REFUSAL.DEPTH_CAP);
          }
          const active = (yield* listChildren(userId, HOSTED_CHILDREN.LIST_LIMIT)).filter(isActive);
          const ownActive = active.filter((child) => child.parentConversationId === conversationId);
          if (ownActive.length >= HOSTED_CHILDREN.MAXIMUM_ACTIVE_PER_REQUESTER) {
            return refused(CHILD_SPAWN_REFUSAL.REQUESTER_LIMIT);
          }
          if (active.length >= HOSTED_CHILDREN.MAXIMUM_ACTIVE_GLOBAL) {
            return refused(CHILD_SPAWN_REFUSAL.GLOBAL_LIMIT);
          }
          const spawnedByMessageId = yield* readSpawningMessage(seams.conversation, seams.turnId);
          if (spawnedByMessageId === undefined) {
            return refused(CHILD_SPAWN_REFUSAL.PERSISTENCE, NO_SPAWNING_MESSAGE);
          }
          // The child's first turn opens with the subagent marker, which is what
          // tells the model it is a child, and then the task as briefed; the relay
          // writes that received message as the child's first user row.
          const opened = yield* openChild(seams.opener, {
            parent: seams.conversation,
            spawnedByMessageId,
            task: childTaskInputText(ask.task),
            ...(ask.label !== undefined ? { label: ask.label } : undefined),
            expectsCompletion: ask.expectsCompletion ?? true,
          });
          if (!opened.ok) {
            return refused(SPAWN_REFUSAL_OF_OPEN_REFUSAL[opened.refusal], opened.refusal);
          }
          return {
            accepted: true,
            receipt: { childId: opened.childId, childSessionKey: childSessionKey(opened.childId) },
          };
        }),
      ),

    list: () =>
      run(
        Effect.map(listChildrenOf(userId, conversationId, HOSTED_CHILDREN.LIST_LIMIT), (children) =>
          children.map(childRunRecordOf),
        ),
      ),

    cancel: (childId) =>
      run(
        Effect.gen(function* () {
          const child = yield* own(childId);
          if (child === undefined) return undefined;
          // A child that has ended has nothing left to cancel, and answers as already done.
          if (!isActive(child)) return { ok: true, remaining: [] };
          const notCancelled: ChildCancellation = { ok: false, remaining: [childId] };
          // No turn row yet is the opener's inbox with nothing eve runs under a name this build
          // can cancel by; the child is left to its start and the cancel is answered as not done.
          if (child.turnId === null) return notCancelled;
          if (child.eveTurnId !== null) {
            const secret = seams.opener.deploymentSecret();
            const origin = seams.opener.eveOrigin();
            if (secret === undefined || origin === undefined || child.runtimeSessionId === null) {
              return notCancelled;
            }
            const eve = seams.opener.eve({
              origin,
              caller: { kind: EVE_CALLER.DEPLOYMENT, secret, account: userId },
            });
            const { runtimeSessionId, eveTurnId } = child;
            const cancelled = yield* Effect.promise(() => eve.cancel(runtimeSessionId, eveTurnId));
            if (cancelled.outcome === EVE_CANCEL_OUTCOME.FAILED) {
              seams.opener.report(
                `The cancel of child ${childId}'s turn ${eveTurnId} was refused by eve (${cancelled.status}).`,
              );
              return notCancelled;
            }
          }
          const stamped = yield* seams.writer.requestTurnCancel(
            { userId, conversationId: childId },
            { turnId: child.turnId, at: new Date(seams.now()) },
          );
          return stamped.ok ? { ok: true, remaining: [] } : notCancelled;
        }),
      ),

    conversations: () =>
      run(
        Effect.map(conversationDirectory(userId, HOSTED_CHILDREN.DIRECTORY_LIMIT), (entries) =>
          entries.map(conversationRecordOf),
        ),
      ),

    lines: (childId, limit) =>
      run(
        Effect.gen(function* () {
          const child = yield* own(childId);
          if (child === undefined) return undefined;
          const recent = yield* readRecentMessages(
            { userId, conversationId: childId },
            CATALOG_TOOL_SET,
            HOSTED_CHILDREN.LINES_WINDOW,
          );
          return recent
            .map(lineOf)
            .filter((line) => line.length > 0)
            .slice(-limit);
        }),
      ),
  };
}
