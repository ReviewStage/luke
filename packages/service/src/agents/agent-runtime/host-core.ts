/**
 * host-core.ts -- what every agent's host does the same way: admit a session, claim its conversation, and find a worker's child.
 *
 * The brain host (`../brain-host/host.ts`) and the coding agent's host
 * (`../coder-host/host.ts`) differ in what their agents are for, and each
 * keeps the methods its role alone has. What they share is how a session is
 * admitted for a conversation (the standing it runs under: its own, one
 * claiming the conversation as it starts, or a worker's on ownership alone),
 * how a starting session claims the conversation's record, and how a
 * worker's session finds the child conversation its turns are recorded
 * under: built here once, so both hosts are that core and their own role.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { childConversationId } from "@luke/database/models/ids";
import type { ConversationTarget } from "@luke/database/models/writer";
import { Effect, Option, Result, type Schema } from "effect";
import type { SessionAuth, SessionContext } from "eve/context";
import {
  type AdmittedConversation,
  admitConversation,
  type ConversationAdmission,
  claimRuntimeSession,
  SESSION_STANDING,
} from "../brain-host/conversation.js";

type HostEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** How every host admits a session and lets one claim its conversation. */
export interface HostAdmission {
  /** Whether the session stands for a conversation of the caller's and is the one it runs in; every other function takes what this admitted. */
  admit(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The same admission for a session claiming the conversation as it starts, before its record stands. */
  admitStarting(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The admission a worker's session takes: the caller owns the conversation, whichever session runs it. */
  admitDelegated(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** Claims the conversation's record for the session starting, forward only; answers whether the record is now the session's. */
  sessionStarted(admitted: AdmittedConversation, sessionId: string): HostEffect<boolean>;
}

/** The admissions every host makes, over the host's own clock for a claim's instant. */
export function hostAdmission(now: () => number): HostAdmission {
  return {
    admit: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CURRENT }),
    admitStarting: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CLAIMING }),
    admitDelegated: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.DELEGATED }),
    sessionStarted: (admitted, sessionId) =>
      claimRuntimeSession(admitted.target, sessionId, new Date(now())),
  };
}

/** A worker's session as its host reads it: the conversation it was delegated from, and the child its turns are recorded under. */
export interface DelegatedChild {
  readonly parent: ConversationTarget;
  readonly child: ConversationTarget;
  /** The member the worker's session acts for, who pays for what it runs; the parent's owner keeps its rows. */
  readonly caller: string;
}

/**
 * The child conversation a worker's session records into, under the call
 * that started it: admitted on reach alone, as the worker's resolvers
 * are, since claiming the parent's record for the child's session would
 * refuse every later call of the parent's own; nothing for a session with
 * no parent, or one the account does not reach.
 */
export function delegatedChildOf(
  session: SessionContext["session"],
): HostEffect<Option.Option<DelegatedChild>> {
  return Effect.gen(function* () {
    const parent = session.parent;
    if (parent === undefined) return Option.none();
    const admitted = yield* admitConversation(session.auth, {
      id: session.id,
      standing: SESSION_STANDING.DELEGATED,
    });
    if (Result.isFailure(admitted)) return Option.none();
    const { target, caller } = admitted.success;
    return Option.some({
      caller,
      parent: target,
      child: {
        userId: target.userId,
        conversationId: childConversationId(target.conversationId, parent.callId),
      },
    });
  });
}
