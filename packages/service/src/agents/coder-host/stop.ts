import type { DatabaseServices } from "@luke/database/core/query";
import {
  awaitingLinesOfReached,
  type CodingAgent,
  type CodingAgentLatestTurn,
  latestTurnsOfReached,
  RUNNING_TURN_STATUSES,
} from "@luke/database/models/coding-agent-store";
import { recordedRuntimeSession } from "@luke/database/models/recorded-session";
import { readAccountNames } from "@luke/database/models/workspace-store";
import type { StoreWriter } from "@luke/database/models/writer";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { Clock, DateTime, Effect, Redacted, Result } from "effect";
import type { HttpClient } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import {
  describeUnreachable,
  EVE_CANCEL_OUTCOME,
  EVE_MOUNT,
  type EveMount,
  type EveSessions,
  eveSessions,
} from "../brain-host/eve-sessions.js";
import { type AgentTurnStanding, codingAgentSummary, summaryAccounts } from "./status.js";

/**
 * stop.ts -- the one Stop: eve's cancel of a coding agent's turn under way, then the row's stamp.
 *
 * A Stop pressed on the agent, its archive, and the delete of the task it
 * works on all stop it here, reaching eve as the developer over the
 * request's own authorization. The cancel names the turn the row was
 * written for, so a turn that ended meanwhile is not followed by a newer
 * one stopped in its place, and an eve that refuses leaves the row as it
 * stood and the caller unavailable. An agent stopped for good, as an
 * archive or a delete wants it, must also have no turn coming that no
 * Stop could name yet: a session still coming up, or a line awaiting the
 * turn it opens, is refused as not ready until that turn exists or has
 * ended. Every agent here was read through the caller's membership of its
 * task's workspace, so a member stops a teammate's agent on the agent's own
 * conversation, whichever of them started it.
 */

/** How a route reaches eve: the origin the deployment names, or a test's own eve. */
export interface EveReach {
  /** The origin eve answers on; nothing where the deployment names none, which refuses every Start and Stop as unavailable. */
  eveOrigin: () => string | undefined;
  /** eve as the developer reaches it, over the request's own authorization; a test hands a fake, and the deployment composes eve's client over the ambient `HttpClient`. */
  eve?: (authorization: Redacted.Redacted) => EveSessions;
}

/** eve as the developer reaches it, the coding agents' service unless another is named, or unavailable where the deployment names no origin for eve. */
export const eveFor = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: EveReach,
  request: Request,
  mount: EveMount = EVE_MOUNT.CODER,
): Effect.fn.Return<EveSessions, HostedRefusal, HttpClient.HttpClient> {
  const authorization = Redacted.make(request.headers.get("authorization") ?? "");
  if (reach.eve !== undefined) return reach.eve(authorization);
  const origin = reach.eveOrigin();
  if (origin === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return yield* eveSessions({ origin, caller: { authorization }, mount });
});

/** Where each of the agents' conversations named stands now, read by id since the agents passed the task's gate: its newest turn, and whether a line of the developer's awaits one. */
export const standingsOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  conversationIds: readonly string[],
): Effect.fn.Return<
  (conversationId: string) => AgentTurnStanding,
  HostedRefusal,
  DatabaseServices
> {
  const turns = yield* hostedStoreOrUnavailable(latestTurnsOfReached(conversationIds));
  const awaiting = yield* hostedStoreOrUnavailable(awaitingLinesOfReached(conversationIds));
  return (conversationId) => ({
    turn: turns.get(conversationId),
    awaitingLineAt: awaiting.get(conversationId),
  });
});

/** The agent's summary with its status read now. */
export const summaryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: CodingAgent,
): Effect.fn.Return<CodingAgentSummary, HostedRefusal, DatabaseServices> {
  const standing = yield* standingsOf([agent.conversationId]);
  const names = yield* hostedStoreOrUnavailable(readAccountNames(summaryAccounts(agent)));
  return codingAgentSummary(
    agent,
    standing(agent.conversationId),
    yield* Clock.currentTimeMillis,
    names,
  );
});

/** Whether the turn is one a Stop has something to stop: still running, with eve's id to name, and no Stop on it yet. */
function stoppable(turn: CodingAgentLatestTurn | undefined): turn is CodingAgentLatestTurn & {
  readonly eveTurnId: string;
} {
  return (
    turn !== undefined &&
    RUNNING_TURN_STATUSES.has(turn.status) &&
    turn.eveTurnId !== null &&
    turn.cancelRequestedAt === null
  );
}

/** eve's cancel of the agent's turn under way, then the row's stamp; nothing where no turn runs that a Stop has to stop. */
export const stoppedTurn = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: EveReach,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  agent: CodingAgent,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const turn = (yield* standingsOf([agent.conversationId]))(agent.conversationId).turn;
  if (!stoppable(turn)) return;
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return;
  // The cancel names the turn the row was written for, never the session's turn under way, so a
  // turn that ended between the read above and eve's answer is answered `no_active_turn` and
  // nothing newer is stopped in its place.
  const eve = yield* eveFor(reach, request);
  const cancelled = yield* eve
    .cancel(sessionId, turn.eveTurnId)
    .pipe(
      Effect.catchTag("EveUnreachable", (failure) =>
        Effect.as(
          Effect.logWarning(
            `eve could not be reached to stop a coding agent: ${describeUnreachable(failure)}`,
          ),
          { outcome: EVE_CANCEL_OUTCOME.FAILED, status: HOSTED_HTTP_STATUS.BAD_GATEWAY } as const,
        ),
      ),
    );
  if (cancelled.outcome === EVE_CANCEL_OUTCOME.FAILED) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  const at = yield* DateTime.nowAsDate;
  const stamped = yield* hostedStoreOrUnavailable(
    Effect.flatMap(writer, (write) => write.requestTurnCancel(target, { turnId: turn.id, at })),
  );
  if (Result.isFailure(stamped)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
});

/**
 * The agent stopped as a Stop stops it, with nothing left to work on out of
 * sight: a session still coming up, or a line awaiting the turn it opens,
 * has no turn a Stop can name yet, so it is refused as not ready until
 * there is one to stop or it has ended.
 */
export const stoppedForGood = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: EveReach,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  agent: CodingAgent,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  yield* stoppedTurn(reach, writer, request, agent);
  const { status } = yield* summaryOf(agent);
  if (status === CODING_AGENT_STATUS.STARTING || status === CODING_AGENT_STATUS.RUNNING) {
    return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  }
});
