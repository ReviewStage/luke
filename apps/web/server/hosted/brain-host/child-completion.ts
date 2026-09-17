/**
 * child-completion.ts -- a child's end handed to its parent as one turn, marked then sent.
 *
 * The child completion: what a child's end becomes for the conversation that
 * delegated it. eve's hooks are at-least-once, so the delivery is the outbox
 * the briefing push already is: the child's own row is the outbox and
 * `completion_delivered_at` is the mark. The mark precedes the send — the
 * claim stamps the row under the parent's lock in one transaction, and only
 * a stamp that landed is followed by the one `child-completion` turn handed
 * into the parent's session, as the deployment acting for the account the
 * way the scheduled opener acts for it — so what is guaranteed is at most
 * one completion turn per child, never that it arrived: a send eve refused
 * after the mark is said and retried nowhere. Two callers visit an ended
 * child, the relay on the turn's end and the sweep once a tick, and the
 * claim is what lets them agree. A child whose spawn expected no completion
 * is stamped and nothing is sent, so the sweep finds nothing to visit twice.
 *
 * The words are the child's final reply read back from its journal, the
 * turn's one assistant row, after the claim has committed rather than inside
 * it: the run has ended, so the row is finished and reads the same on either
 * side of the commit, and the claim's transaction holds the account's and
 * the parent's locks for the stamp alone; a read that fails there is a
 * completion not delivered, said and counted like a send eve refused, never
 * a stamp undone. The handover itself holds no lock of this module's: the
 * send into the parent's recorded session runs outside any transaction, and
 * the handover takes the parent's lock only to open a session where none is
 * recorded, so two children of one such parent ending together open one
 * session between them and the second sends into it. A
 * deployment with no secret or no origin for eve claims nothing and sends
 * nothing, the kill switch every hosted door keeps, and the sweep visits the
 * child again once it has both.
 */

import { catchAllButInterrupt } from "@sidecar/runtime/effect";
import { isTextUIPart, type ToolSet } from "ai";
import { Cause, Effect, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { childCompletionInputText, MESSAGE_ROLE } from "../../core.js";
import { claimChildCompletion, undeliveredChildren } from "../store/children.js";
import type { ConversationTarget } from "../store/index.js";
import { readMessageByClientId } from "../store/message-reads.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import { EVE_CALLER, type EveSessions, type EveSessionsOptions } from "./eve-sessions.js";
import { handToEve, SESSION_OPENING } from "./handover.js";

/** The one kind of turn the completion sends, which is what its eve client is admitted for and nothing wider. */
export type CompletionTurn = typeof BRAIN_HOST_TURN.CHILD_COMPLETION;

export interface ChildCompletionSeams {
  /** The deployment's own secret, the one eve's door admits the deployment under; undefined means it is unset and nothing is delivered. */
  readonly deploymentSecret: () => string | undefined;
  /** The origin eve answers on; undefined on a machine that is neither configured nor deployed. */
  readonly eveOrigin: () => string | undefined;
  /** eve's session client composed for one caller: `eveSessions` in production, a fake in the tests. */
  readonly eve: (options: EveSessionsOptions) => EveSessions<CompletionTurn>;
  /** The tool registry the child's journal is read back under. */
  readonly tools: ToolSet;
  readonly now: () => number;
  /** Where a refusal is said; a delivery never throws into the relay's turn or the tick. */
  readonly report: (message: string) => void;
}

/** What one delivery did. */
export const CHILD_COMPLETION_DELIVERY = {
  /** Stamped, and eve took the completion turn. */
  DELIVERED: "delivered",
  /** Stamped, and eve refused the turn, could not be reached, or the parent no longer stood; said, and retried nowhere. */
  UNDELIVERED: "undelivered",
  /** Stamped with nothing sent: the spawn expected no completion. */
  WITHHELD: "withheld",
  /** Nothing stamped and nothing sent: no such standing child, a run still under way, a completion delivered already, or a deployment that cannot reach eve. */
  NOTHING: "nothing",
} as const;

export type ChildCompletionDelivery =
  (typeof CHILD_COMPLETION_DELIVERY)[keyof typeof CHILD_COMPLETION_DELIVERY];

/** The child's final reply: the text of its latest turn's journal, read back under the registry; empty where the row is missing or unreadable. */
const finalReplyOf = /* @__PURE__ */ Effect.fn("finalReplyOf")(function* (
  tools: ToolSet,
  child: ConversationTarget,
  turnId: string,
): Effect.fn.Return<string, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const read = yield* readMessageByClientId(child.userId, child.conversationId, tools, turnId);
  if (!read.ok) return "";
  const message = read.value[0]?.message;
  if (message === undefined || message.role !== MESSAGE_ROLE.ASSISTANT) return "";
  return message.parts
    .filter((part) => isTextUIPart(part))
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .join("\n");
});

/** Delivers one child's completion to its parent, as the module comment describes. */
export const deliverChildCompletion = /* @__PURE__ */ Effect.fn("deliverChildCompletion")(
  function* (
    seams: ChildCompletionSeams,
    child: ConversationTarget,
  ): Effect.fn.Return<ChildCompletionDelivery, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
    const secret = seams.deploymentSecret();
    const origin = seams.eveOrigin();
    if (secret === undefined || origin === undefined) {
      seams.report(
        `The completion of child ${child.conversationId} could not be delivered: the deployment holds no secret or no origin for eve.`,
      );
      return CHILD_COMPLETION_DELIVERY.NOTHING;
    }
    const claimed = yield* claimChildCompletion(child, new Date(seams.now()));
    if (claimed === undefined) return CHILD_COMPLETION_DELIVERY.NOTHING;
    if (!claimed.expectsCompletion) return CHILD_COMPLETION_DELIVERY.WITHHELD;
    const eve = seams.eve({
      origin,
      caller: { kind: EVE_CALLER.DEPLOYMENT, secret, account: child.userId },
    });
    // The mark has committed: whatever follows, the journal read as much as the handover, is said
    // and counted once and retried nowhere, and a store failure on either is one more way the send
    // did not land; it must not end the sweep visiting the account's other children either.
    const handover = Effect.gen(function* () {
      const words = childCompletionInputText(
        {
          childId: child.conversationId,
          label: claimed.label ?? undefined,
          status: claimed.status,
          result: yield* finalReplyOf(seams.tools, child, claimed.turnId),
          failure: claimed.failure ?? undefined,
        },
        seams.now(),
      );
      return yield* handToEve(
        { eve, now: seams.now, report: seams.report },
        claimed.parent,
        BRAIN_HOST_TURN.CHILD_COMPLETION,
        words,
        SESSION_OPENING.LOCKED,
      );
    });
    const taken = yield* catchAllButInterrupt(handover, (cause) => {
      seams.report(
        `The completion of child ${child.conversationId} could not be handed over: ${Cause.pretty(cause)}`,
      );
      return Effect.succeed(false);
    });
    return taken ? CHILD_COMPLETION_DELIVERY.DELIVERED : CHILD_COMPLETION_DELIVERY.UNDELIVERED;
  },
);

const CHILD_COMPLETION_SWEEP = {
  /**
   * The most ended, unstamped children of one account a sweep visits in one
   * tick, oldest run first; the rest wait for the next. The same bound the
   * opener keeps on the turns it opens an account in a tick, since the
   * sweep is the one other thing that opens a turn for an account on the
   * schedule and a child's end is news of the same order as a session's.
   */
  LIMIT: 8,
} as const;

/** What one sweep did, as counts, each a delivery of the kind it names. */
export interface ChildCompletionSweepOutcome {
  readonly delivered: number;
  readonly undelivered: number;
  readonly withheld: number;
}

export const NOTHING_DELIVERED: ChildCompletionSweepOutcome = {
  delivered: 0,
  undelivered: 0,
  withheld: 0,
};

export interface ChildCompletionSweepOptions {
  /** The most children the sweep visits. */
  readonly limit?: number | undefined;
}

/**
 * The sweep over one account's ended children no completion is stamped
 * for, oldest run first: the completions the relay did not deliver — a hook
 * that failed after the seal, a deployment that could not reach eve at the
 * time — delivered now on the same claim. It runs for an account the tick
 * enumerated, after that account's own pass and opening and under the same
 * deadline, so the account named to eve is only ever one this tick listed
 * and the sweep's time is the account's share of the tick and no more.
 */
export const sweepChildCompletions = /* @__PURE__ */ Effect.fn("sweepChildCompletions")(function* (
  seams: ChildCompletionSeams,
  userId: string,
  options: ChildCompletionSweepOptions = {},
): Effect.fn.Return<
  ChildCompletionSweepOutcome,
  SqlError | Schema.SchemaError,
  SqlClient.SqlClient
> {
  if (seams.deploymentSecret() === undefined || seams.eveOrigin() === undefined) {
    return NOTHING_DELIVERED;
  }
  const outcome = { delivered: 0, undelivered: 0, withheld: 0 };
  const children = yield* undeliveredChildren(
    userId,
    options.limit ?? CHILD_COMPLETION_SWEEP.LIMIT,
  );
  for (const child of children) {
    const delivery = yield* deliverChildCompletion(seams, child);
    switch (delivery) {
      case CHILD_COMPLETION_DELIVERY.DELIVERED:
        outcome.delivered += 1;
        break;
      case CHILD_COMPLETION_DELIVERY.UNDELIVERED:
        outcome.undelivered += 1;
        break;
      case CHILD_COMPLETION_DELIVERY.WITHHELD:
        outcome.withheld += 1;
        break;
      case CHILD_COMPLETION_DELIVERY.NOTHING:
        break;
    }
  }
  return outcome;
});
