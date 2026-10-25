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
 * leaves the standing operator standing. A Restore, Reset's Undo, stops the
 * standing operator's turn and archives it in favour of the member's own
 * archived operator it names, which it brings back in the same
 * transaction (`restoreOperatorAgent`), and re-aims the heartbeat back at
 * it; it names nothing for an operator that is not the member's own and
 * archived, so no member reaches another's. An operator the ensure made runs
 * one opening turn as it is made (`openedOnItsOpening`), in which it reads
 * its member's open work and says what stands; one the ensure found runs
 * none, so a repeat ensure opens nothing.
 *
 * The ensure that made an operator also aims its heartbeat at it
 * (`aimedItsHeartbeat`): an ordinary personal automation of its member's,
 * in the workspace, with no repository, that hands every run to the
 * operator on weekdays at nine and five in the member's time zone, the zone
 * the client sent with the ensure where it reads, and UTC otherwise, since
 * the service keeps none for an account. A Reset re-aims every automation of
 * the member's aimed at the operator it retired, the heartbeat among them,
 * rather than making a second, and makes one only where none was aimed. A
 * repeat ensure makes none, so a heartbeat the member deleted stays deleted.
 *
 * Only a member of the workspace who turned the operator experiment on
 * (`EXPERIMENT.OPERATOR`) ensures one; anyone else is answered as though
 * the workspace named nothing, as Chat's gate answers.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { accountExperimentOn } from "@luke/database/models/account-store";
import { aimOperatorHeartbeat } from "@luke/database/models/automation-store";
import {
  archiveOperatorAgent,
  type CodingAgent,
  readArchivedOperator,
  readStandingOperator,
  restoreOperatorAgent,
} from "@luke/database/models/coding-agent-store";
import { nextScheduledRun } from "@luke/features/automation-schedule";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationTrigger,
} from "@luke/features/automation-wire";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { failureKind } from "@luke/runtime/effect";
import { EXPERIMENT } from "@luke/settings";
import { DateTime, Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import {
  type AgentSessions,
  describeUnreachable,
  EVE_SEND_OUTCOME,
  type EveTypedTurn,
} from "../brain-host/eve-sessions.js";
import { OPERATOR_HEARTBEAT, OPERATOR_OPENING } from "./instructions.js";
import {
  acceptedAgentChoice,
  type CodingAgentStart,
  type StartServices,
  startCodingAgent,
  startCredentialStands,
} from "./start.js";

/** What an ensure asks beyond the member and the workspace: whether the standing operator is archived first, or which archived one comes back in its place, and how its turn is stopped before it is. */
export interface OperatorEnsure<R> {
  readonly reset: boolean;
  /** The id of the member's own archived operator a Reset retired, brought back in place of the one standing, as Reset's Undo asks. */
  readonly restore: string | undefined;
  /** The IANA zone the member's client runs in, which the heartbeat an ensure makes is read in; UTC where it names none or one that does not read. */
  readonly timeZone: string | undefined;
  /** Stops the turn the standing operator runs, refusing where it cannot, as an archive by hand stops one first (`coder-host/stop.ts`'s `stoppedForGood`). */
  readonly stopStanding: (agent: CodingAgent) => Effect.Effect<void, HostedRefusal, R>;
}

/** What an ensure came to: the operator, and the one a Reset archived, whose sandbox its caller stops. */
export interface OperatorEnsured extends CodingAgentStart {
  readonly retired: CodingAgent | undefined;
}

const OPERATOR_HEARTBEAT_SCHEDULE = {
  /** What the member's Automations lists it as. */
  NAME: "Luke's heartbeat",
  /** Weekdays at nine and five, read in the member's zone. */
  CRON: "0 9,17 * * 1-5",
  /** The zone it is read in where the client named none that reads. */
  FALLBACK_ZONE: "UTC",
} as const;

/** The heartbeat's schedule in the zone given, or in UTC where that zone does not read. */
function heartbeatTrigger(
  timeZone: string | undefined,
  now: Date,
): Extract<AutomationTrigger, { readonly kind: typeof AUTOMATION_TRIGGER.SCHEDULE }> {
  const inZone = {
    kind: AUTOMATION_TRIGGER.SCHEDULE,
    cron: OPERATOR_HEARTBEAT_SCHEDULE.CRON,
    timezone: timeZone ?? OPERATOR_HEARTBEAT_SCHEDULE.FALLBACK_ZONE,
  } as const;
  return nextScheduledRun(inZone, now) === undefined
    ? { ...inZone, timezone: OPERATOR_HEARTBEAT_SCHEDULE.FALLBACK_ZONE }
    : inZone;
}

/**
 * The heartbeat aimed at the operator this ensure made, as above. Note that
 * a store that fails is logged and leaves the operator standing without
 * one, rather than failing the ensure, because a Reset has archived the
 * operator before; the member can make the automation by hand.
 */
const aimedItsHeartbeat = (
  userId: string,
  workspaceId: string,
  operator: CodingAgent,
  retired: CodingAgent | undefined,
  timeZone: string | undefined,
) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const trigger = heartbeatTrigger(timeZone, now);
    const aimed = yield* aimOperatorHeartbeat(userId, {
      operatorId: operator.id,
      retiredId: retired?.id,
      heartbeat: {
        taskId: null,
        organizationId: workspaceId,
        repositories: [],
        name: OPERATOR_HEARTBEAT_SCHEDULE.NAME,
        trigger,
        action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: OPERATOR_HEARTBEAT },
        guards: AUTOMATION_DEFAULT_GUARDS,
        nextRunAt: nextScheduledRun(trigger, now) ?? null,
        webhookSecretHash: null,
        scope: AUTOMATION_SCOPE.PERSONAL,
      },
    });
    if (Option.isNone(aimed)) {
      yield* Effect.logWarning(`operator ${operator.id}'s heartbeat had no workspace to stand in`);
    }
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(
        `operator ${operator.id}'s heartbeat could not be aimed: ${failureKind(failure)}`,
      ),
    ),
  );

/**
 * The operator's session opened on its opening turn (`instructions.ts`'s
 * `OPERATOR_OPENING`), in which it reads its member's open work and says
 * what stands. Note that an eve that does not take it is logged and leaves
 * the operator standing, rather than failing the ensure, because a Reset has
 * archived the operator before and a member must never be left with none;
 * an operator never opened opens on its member's first words, as any blank
 * agent does (`steer.ts`).
 */
const openedOnItsOpening = (
  eve: Effect.Effect<
    AgentSessions<EveTypedTurn>,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  operator: CodingAgent,
) =>
  Effect.gen(function* () {
    const sessions = yield* eve;
    const opened = yield* sessions.open({
      conversationId: operator.conversationId,
      turn: BRAIN_HOST_TURN.TYPED,
      message: OPERATOR_OPENING,
    });
    if (opened.outcome !== EVE_SEND_OUTCOME.ACCEPTED) {
      yield* Effect.logWarning(
        `eve did not take operator ${operator.id}'s opening: ${opened.outcome}`,
      );
    }
  }).pipe(
    Effect.catchTag("EveUnreachable", (failure) =>
      Effect.logWarning(
        `eve could not be reached to open operator ${operator.id}: ${describeUnreachable(failure)}`,
      ),
    ),
    Effect.catch((refusal) =>
      Effect.logWarning(`eve was not composed to open operator ${operator.id}: ${refusal.error}`),
    ),
  );

/**
 * The member's archived operator named brought back in place of the one
 * standing, as above: refused as naming nothing where it is not theirs,
 * not archived, or another operator than the one read stands by the time
 * it is written. The standing one's turn is stopped first, as a Reset stops
 * it, and nothing is archived where that stop is refused.
 */
const restoredOperator = Effect.fnUntraced(function* <R>(
  userId: string,
  workspaceId: string,
  agentId: string,
  ensure: OperatorEnsure<R>,
) {
  const named = yield* hostedStoreOrUnavailable(readArchivedOperator(userId, workspaceId, agentId));
  if (Option.isNone(named)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const standing = yield* hostedStoreOrUnavailable(readStandingOperator(userId, workspaceId));
  if (Option.isSome(standing)) yield* ensure.stopStanding(standing.value);
  const restored = yield* hostedStoreOrUnavailable(
    restoreOperatorAgent(
      userId,
      workspaceId,
      agentId,
      Option.isSome(standing) ? standing.value.id : undefined,
    ),
  );
  if (Option.isNone(restored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { agent, txid, retiredId } = restored.value;
  const retired = Option.isSome(standing) && retiredId !== undefined ? standing.value : undefined;
  yield* aimedItsHeartbeat(userId, workspaceId, agent, retired, ensure.timeZone);
  const answer: OperatorEnsured = { agent, created: false, retired };
  return txid === undefined ? answer : { ...answer, txid };
});

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
  if (ensure.restore !== undefined) {
    return yield* restoredOperator(userId, workspaceId, ensure.restore, ensure);
  }
  // The choice is checked before a Reset archives anything, so a refusal leaves the operator standing.
  const choice = yield* acceptedAgentChoice(userId, undefined).pipe(
    Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
  );
  // So is a credential to pay for it, so a member who removed theirs keeps the operator a Reset would replace.
  yield* startCredentialStands(userId, choice.model);
  // A Reset retires only the member's own operator, and only in a workspace they are a member of.
  const standing = ensure.reset
    ? yield* hostedStoreOrUnavailable(readStandingOperator(userId, workspaceId))
    : Option.none<CodingAgent>();
  let retired: CodingAgent | undefined;
  if (Option.isSome(standing)) {
    // An archived operator works on unseen, so a turn still running is stopped before the stamp.
    yield* ensure.stopStanding(standing.value);
    const archived = yield* hostedStoreOrUnavailable(
      archiveOperatorAgent(userId, workspaceId, standing.value.id),
    );
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
  // Only the ensure that made the operator aims its heartbeat and opens it, so a repeat ensure does neither again.
  if (started.created) {
    yield* aimedItsHeartbeat(userId, workspaceId, started.agent, retired, ensure.timeZone);
    yield* openedOnItsOpening(eve, started.agent);
  }
  return { ...started, retired };
});
