import { Effect, type Redacted, Result, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { abandonChildConversation, openChildConversation } from "../store/children.js";
import type { ConversationTarget } from "../store/index.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import {
  describeUnreachable,
  EVE_CALLER,
  EVE_SEND_OUTCOME,
  type EveSessions,
  type EveSessionsOptions,
} from "./eve-sessions.js";
import { claimRuntimeSession, recordedRuntimeSession } from "./recorded-session.js";

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
 * A child eve refused a session for is no child: the row is stamped as
 * Clear stamps one, so nothing lists it and the purge takes it, and the
 * refusal is answered typed so the caller decides what to tell the brain.
 * The stamp holds to a row no session has claimed, because eve's answer and
 * its session's start are two events and only the row says which came
 * first: an answer lost or unreadable after eve had already started the
 * session finds the row claimed, and the child is answered as opened under
 * the session the row records rather than reported refused while it runs;
 * and an open interrupted before eve answered stamps the row on its way
 * out, so a session starting late finds a cleared conversation and is
 * refused. A deployment with no secret or no origin for eve opens nothing
 * and inserts nothing, the kill switch every hosted door keeps.
 */

/** The one kind of turn the opener sends, which is what its eve client is admitted for and nothing wider. */
export type ChildTurn = typeof BRAIN_HOST_TURN.CHILD_TASK;

export interface ChildOpenerSeams {
  /** The deployment's own secret, the one eve's door admits the deployment under; undefined means it is unset and no child is opened. */
  readonly deploymentSecret: () => Redacted.Redacted | undefined;
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
  NO_PARENT:
    "Not opened: the delegating conversation or its message does not stand for this account.",
  EVE_REFUSED: "Not opened: eve refused to open the child's session.",
} as const;

type ChildOpenRefusal = (typeof CHILD_OPEN_REFUSAL)[keyof typeof CHILD_OPEN_REFUSAL];

/** The child opened, by its conversation and eve session, or why none was. */
export type ChildOpened = Result.Result<
  { readonly childId: string; readonly sessionId: string },
  ChildOpenRefusal
>;

/** Opens one child for the delegation, as the module comment describes. */
export const openChild = /* @__PURE__ */ Effect.fn("web/openChild")(function* (
  seams: ChildOpenerSeams,
  spawn: ChildSpawn,
): Effect.fn.Return<ChildOpened, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const secret = seams.deploymentSecret();
  const origin = seams.eveOrigin();
  if (secret === undefined || origin === undefined) {
    seams.report(
      `A child of conversation ${spawn.parent.conversationId} could not be opened: the deployment holds no secret or no origin for eve.`,
    );
    return Result.fail(CHILD_OPEN_REFUSAL.UNCONFIGURED);
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
      `A child of conversation ${spawn.parent.conversationId} could not be opened: the conversation or message ${spawn.spawnedByMessageId} does not stand for account ${userId}.`,
    );
    return Result.fail(CHILD_OPEN_REFUSAL.NO_PARENT);
  }
  const eve = seams.eve({
    origin,
    caller: { kind: EVE_CALLER.DEPLOYMENT, secret, account: userId },
  });
  const target: ConversationTarget = { userId, conversationId: childId };
  const abandon = abandonChildConversation(userId, childId, new Date(seams.now()));
  // eve's open is a request over the network: an answer refusing it and a call that never answered
  // are the same child not opened, said with what is known of each; a caller ending before eve
  // answers stamps the row on its way out.
  const sessionId = yield* eve
    .open({ conversationId: childId, turn: BRAIN_HOST_TURN.CHILD_TASK, message: spawn.task })
    .pipe(
      Effect.map((opened) => {
        if (opened.outcome === EVE_SEND_OUTCOME.ACCEPTED) return opened.sessionId;
        seams.report(
          `eve refused to open a session for child ${childId} with status ${opened.status}.`,
        );
        return undefined;
      }),
      Effect.catchTag("EveUnreachable", (failure) => {
        seams.report(
          `A session for child ${childId} could not be opened: ${describeUnreachable(failure)}.`,
        );
        return Effect.succeed(undefined);
      }),
      Effect.onInterrupt(() => Effect.ignore(abandon)),
    );
  if (sessionId === undefined) {
    if (yield* abandon) return Result.fail(CHILD_OPEN_REFUSAL.EVE_REFUSED);
    // The row was claimed before the answer was read: eve started the session, whatever it answered.
    const claimed = yield* recordedRuntimeSession(target);
    if (claimed === undefined) return Result.fail(CHILD_OPEN_REFUSAL.EVE_REFUSED);
    seams.report(
      `Child ${childId} runs in session ${claimed}, which claimed it before eve's answer was read.`,
    );
    return Result.succeed({ childId, sessionId: claimed });
  }
  yield* claimRuntimeSession(target, sessionId, new Date(seams.now()));
  return Result.succeed({ childId, sessionId });
});
