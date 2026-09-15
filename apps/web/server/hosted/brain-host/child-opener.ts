import { Effect, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { discardChildConversation, openChildConversation } from "../store/children.js";
import type { ConversationTarget } from "../store/index.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import { claimRuntimeSession } from "./conversation.js";
import {
  EVE_CALLER,
  EVE_SEND_OUTCOME,
  type EveSessions,
  type EveSessionsOptions,
} from "./eve-sessions.js";

/**
 * The child opener: what a delegation becomes. A child is a conversation of
 * kind `child` under the conversation that delegated it and the message that
 * spawned it, run in an eve session of its own, and this is the one place
 * one is opened: the row is inserted first, since the session eve opens
 * names the conversation it runs for in its headers and the host admits the
 * session's events against that row; then eve is handed the task as the
 * received message of a `child-task` turn, by the deployment acting for the
 * account the way the scheduled opener acts for it; and once eve has
 * answered with the session, the row records it, forward-only, the same
 * claim the session's own start makes so the two agree whichever lands
 * first. Nothing here bounds how many children an account may open, and
 * nothing here carries a completion back; each is another module's.
 *
 * A child eve refused a session for is no child: the row is removed again,
 * since nothing was ever said in it, and the refusal is answered typed so the
 * caller decides what to tell the brain. A deployment with no secret or no
 * origin for eve opens nothing and inserts nothing, the kill switch every
 * hosted door keeps.
 */

/** The one kind of turn the opener sends, which is what its eve client is admitted for and nothing wider. */
export type ChildTurn = typeof BRAIN_HOST_TURN.CHILD_TASK;

export interface ChildOpenerSeams {
  /** The deployment's own secret, the one eve's door admits the deployment under; undefined means it is unset and no child is opened. */
  readonly deploymentSecret: () => string | undefined;
  /** The origin eve answers on; undefined on a machine that is neither configured nor deployed. */
  readonly eveOrigin: () => string | undefined;
  /** eve's session client composed for one caller: `eveSessions` in production, a fake in the tests. */
  readonly eve: (options: EveSessionsOptions) => EveSessions<ChildTurn>;
  readonly now: () => number;
  /** Where a refusal is said with its reason; the answer carries the refusal typed and no more. */
  readonly report: (message: string) => void;
}

export interface ChildSpawn {
  /** The conversation delegating, as the caller already established it. */
  readonly parent: ConversationTarget;
  /** The message of the parent's whose tool call spawned the child. */
  readonly spawnedByMessageId: string;
  /** The words the child's first turn opens with. */
  readonly task: string;
  readonly label?: string;
  /** Whether the parent waits on the child's completion coming back to it. */
  readonly expectsCompletion: boolean;
}

/** Why no child was opened, in words a caller can read back. */
export const CHILD_OPEN_REFUSAL = {
  UNCONFIGURED:
    "Not opened: this deployment holds no secret or no origin for eve, so it opens no child.",
  NO_PARENT: "Not opened: the delegating conversation does not stand for this account.",
  EVE_REFUSED: "Not opened: eve refused to open the child's session.",
} as const;

type ChildOpenRefusal = (typeof CHILD_OPEN_REFUSAL)[keyof typeof CHILD_OPEN_REFUSAL];

export type ChildOpened =
  | { readonly ok: true; readonly childId: string; readonly sessionId: string }
  | { readonly ok: false; readonly refusal: ChildOpenRefusal };

/** Opens one child for the delegation, as the module comment describes. */
export const openChild = /* @__PURE__ */ Effect.fn("openChild")(function* (
  seams: ChildOpenerSeams,
  spawn: ChildSpawn,
): Effect.fn.Return<ChildOpened, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const secret = seams.deploymentSecret();
  const origin = seams.eveOrigin();
  if (secret === undefined || origin === undefined) {
    seams.report(
      `A child of conversation ${spawn.parent.conversationId} could not be opened: the deployment holds no secret or no origin for eve.`,
    );
    return { ok: false, refusal: CHILD_OPEN_REFUSAL.UNCONFIGURED };
  }
  const { userId } = spawn.parent;
  const childId = yield* openChildConversation({
    userId,
    parentConversationId: spawn.parent.conversationId,
    spawnedByMessageId: spawn.spawnedByMessageId,
    label: spawn.label ?? null,
    expectsCompletion: spawn.expectsCompletion,
    now: new Date(seams.now()),
  });
  if (childId === undefined) {
    seams.report(
      `A child of conversation ${spawn.parent.conversationId} could not be opened: the conversation does not stand for account ${userId}.`,
    );
    return { ok: false, refusal: CHILD_OPEN_REFUSAL.NO_PARENT };
  }
  const eve = seams.eve({
    origin,
    caller: { kind: EVE_CALLER.DEPLOYMENT, secret, account: userId },
  });
  // eve's open is a request over the network: an answer refusing it and a call that never answered
  // are the same child not opened, said with what is known of each.
  const sessionId = yield* Effect.tryPromise({
    try: () =>
      eve.open({ conversationId: childId, turn: BRAIN_HOST_TURN.CHILD_TASK, message: spawn.task }),
    catch: (cause) => String(cause),
  }).pipe(
    Effect.map((opened) => {
      if (opened.outcome === EVE_SEND_OUTCOME.ACCEPTED) return opened.sessionId;
      seams.report(
        `eve refused to open a session for child ${childId} with status ${opened.status}.`,
      );
      return undefined;
    }),
    Effect.catch((failure) => {
      seams.report(`A session for child ${childId} could not be opened: ${failure}.`);
      return Effect.succeed(undefined);
    }),
  );
  if (sessionId === undefined) {
    yield* discardChildConversation(userId, childId);
    return { ok: false, refusal: CHILD_OPEN_REFUSAL.EVE_REFUSED };
  }
  yield* claimRuntimeSession({ userId, conversationId: childId }, sessionId, new Date(seams.now()));
  return { ok: true, childId, sessionId };
});
