/**
 * operator.ts -- the member's operator in a workspace ensured, or reset and ensured afresh: the one agent per member per workspace that manages their other agents.
 *
 * The operator is an ordinary coding agent of kind operator, with no task
 * and no repository, started blank on the one Start path
 * (`start.ts`'s `startCodingAgent`), so it runs on the member's default
 * model and effort, on their own keys and meter, as any agent they start
 * does. An ensure answers the operator standing in the workspace where
 * there is one, and makes one where there is none: the Start runs under
 * the workspace's row lock, and the partial unique index on
 * `(organization_id, user_id)` over standing operators holds it to one
 * whatever raced it (`createCodingAgent`). Each ensure carries a fresh key,
 * since the operator, not the key, is what makes two ensures one. A Reset
 * stops the turn the standing operator runs, as an archive by hand stops one
 * first, refusing where it cannot, archives it as its member, its transcript
 * kept, and ensures a fresh one. The member's choice is checked against the
 * catalog before anything is archived, so a Reset the catalog would refuse
 * leaves the standing operator standing. Nothing runs: an operator is made
 * with its conversation and no session, and its first turn comes later.
 *
 * Only a member of the workspace who turned the operator experiment on
 * (`EXPERIMENT.OPERATOR`) ensures one; anyone else is answered as though
 * the workspace named nothing, as Chat's gate answers.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { accountExperimentOn } from "@luke/database/models/account-store";
import {
  archiveOperatorAgent,
  type CodingAgent,
  readStandingOperator,
} from "@luke/database/models/coding-agent-store";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { EXPERIMENT } from "@luke/settings";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import type { AgentSessions, EveTypedTurn } from "../brain-host/eve-sessions.js";
import {
  acceptedAgentChoice,
  type CodingAgentStart,
  type StartServices,
  startCodingAgent,
} from "./start.js";

/** What an ensure asks beyond the member and the workspace: whether the standing operator is archived first, and how its turn is stopped before it is. */
export interface OperatorEnsure<R> {
  readonly reset: boolean;
  /** Stops the turn the standing operator runs, refusing where it cannot, as an archive by hand stops one first (`coder-host/stop.ts`'s `stoppedForGood`). */
  readonly stopStanding: (agent: CodingAgent) => Effect.Effect<void, HostedRefusal, R>;
}

/** What an ensure came to: the operator, and the one a Reset archived, whose sandbox its caller stops. */
export interface OperatorEnsured extends CodingAgentStart {
  readonly retired: CodingAgent | undefined;
}

/**
 * The member's operator in the workspace, as above: the one standing, or
 * one made now, after the standing one is archived where the ensure is a
 * Reset. Refused as naming nothing for an account that is no member of the
 * workspace or has the experiment off, and as invalid where the member's
 * default model has left the catalog.
 */
export const ensureOperator = /* @__PURE__ */ Effect.fn("web/ensureOperator")(function* <R>(
  eve: Effect.Effect<
    AgentSessions<EveTypedTurn>,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  userId: string,
  workspaceId: string,
  ensure: OperatorEnsure<R>,
): Effect.fn.Return<OperatorEnsured, HostedRefusal, StartServices | R> {
  const on = yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.OPERATOR));
  if (!on) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  // The choice is checked before a Reset archives anything, so a refusal leaves the operator standing.
  const choice = yield* acceptedAgentChoice(userId, undefined).pipe(
    Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
  );
  // A Reset retires only the member's own operator, and only in a workspace they are a member of.
  const standing = ensure.reset
    ? yield* hostedStoreOrUnavailable(readStandingOperator(userId, workspaceId))
    : Option.none<CodingAgent>();
  let retired: CodingAgent | undefined;
  if (Option.isSome(standing)) {
    // An archived operator works on unseen, so a turn still running is stopped before the stamp.
    yield* ensure.stopStanding(standing.value);
    const archived = yield* hostedStoreOrUnavailable(archiveOperatorAgent(userId, workspaceId));
    retired = Option.isSome(archived) ? standing.value : undefined;
  }
  const started = yield* startCodingAgent(eve, userId, {
    taskId: null,
    organizationId: workspaceId,
    repository: null,
    kind: CODING_AGENT_KIND.OPERATOR,
    blank: true,
    prompt: undefined,
    idempotencyKey: randomUUID(),
    choice,
  }).pipe(Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)));
  return { ...started, retired };
});
