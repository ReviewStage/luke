/**
 * take-over.ts -- a teammate's coding agent taken over: continued in a new agent of the member who asks, the teammate's archived, and its open inbox items and the automations that send it their runs handed to the new one.
 *
 * An agent runs as the member who started it: their model keys, their Mac,
 * their commits, and their own GitHub token where it reaches its repository
 * through one. So no member hands an agent to another; the member who wants
 * the work presses Take over, and the agent that goes on is theirs from its
 * first session. It is a continue (`start.ts`, `replay.ts`, `snapshot.ts`)
 * as the member asking: on the source's task, or with no task in its
 * workspace and on its repository, handed its brief and its transcript
 * replayed, its work copied, going on in its open pull request, on its
 * model and effort where the member's catalog offers them and refused where
 * not, and refused where the member's own reach does not take the
 * repository, rather than falling back on the teammate's. Once eve has
 * taken it, the source is stopped as a continue's is, and then archived as
 * taken over, so a GitHub event on the pull request they share wakes only
 * the agent that goes on, with its open inbox items and the automations
 * that hand their runs to it moved to the new agent in the same
 * transaction, so an answer or a run never lands on an archived agent.
 *
 * Only a member of the source's workspace reaches it (`agent-reach.ts`),
 * no member takes over their own agent, and an agent on its starter's own
 * GitHub token is gone on with by that starter alone (`controlsAgent`), so
 * a teammate's take-over of one is refused as a continue of it is. A retry under the same key
 * finds the agent its first ask made, its source archived by then, and
 * finishes the hand-over that ask may not have; a source archived by
 * anything else is taken over by nobody.
 */

import { retargetAutomations } from "@luke/database/models/automation-store";
import {
  archiveCodingAgent,
  type CodingAgent,
  readCodingAgentByKey,
} from "@luke/database/models/coding-agent-store";
import { CODING_AGENT_ARCHIVER } from "@luke/features/coding-agent-wire";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlClient } from "effect/sql";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { handOverOpenInboxItems } from "../../inbox/inbox-store.js";
import { reachedAgentById } from "../agent-reach.js";
import type { EveSessions, EveTypedTurn } from "../brain-host/eve-sessions.js";
import type { SummaryModelOf } from "./replay-summary.js";
import {
  type RequestedStart,
  requestedStartOf,
  type StartPlace,
  type StartServices,
  startCodingAgent,
} from "./start.js";

/** Why the source is archived, as its banner says beside who archived it. */
export const TAKEN_OVER_REASON = "Taken over";

/** Where the agent that goes on starts: the source's task, or the source's workspace and repository where it stands on no task. */
function placeOf(source: CodingAgent): StartPlace {
  if (source.taskId !== null) return { taskId: source.taskId, prompt: undefined };
  return {
    taskId: null,
    organizationId: source.organizationId,
    repository: source.repository,
    prompt: source.prompt ?? "",
  };
}

/**
 * The source archived as taken over by the account, where it is not
 * archived yet, and its open inbox items and the automations that send it
 * their runs handed to the agent that goes on, together or not at all.
 */
const handedOver = (userId: string, source: CodingAgent, agent: CodingAgent) =>
  Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (source.archivedAt === null) {
          yield* archiveCodingAgent(userId, source.id, true, {
            by: CODING_AGENT_ARCHIVER.MEMBER,
            userId,
            reason: TAKEN_OVER_REASON,
          });
        }
        yield* handOverOpenInboxItems(
          userId,
          { userId: source.userId, agentId: source.id },
          { userId: agent.userId, agentId: agent.id },
        );
        yield* retargetAutomations(userId, source.id, agent.id);
      }),
    ),
  );

/** The account's take-over of a teammate's agent, as above, answered as a Start is: the agent that goes on, and whether this ask made it. */
export const takeOverCodingAgent = /* @__PURE__ */ Effect.fn("web/takeOverCodingAgent")(function* (
  eve: Effect.Effect<EveSessions<EveTypedTurn>, HostedRefusal, HttpClient.HttpClient>,
  userId: string,
  sourceId: string,
  idempotencyKey: string,
  summaryModel?: SummaryModelOf,
): Effect.fn.Return<RequestedStart, HostedRefusal, StartServices> {
  const { agent: source } = yield* reachedAgentById(userId, sourceId);
  if (source.userId === userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (source.archivedAt !== null) {
    // Only the take-over that archived it finds it archived and goes on.
    const made = yield* hostedStoreOrUnavailable(readCodingAgentByKey(userId, idempotencyKey));
    const retried = Option.isSome(made) && made.value.startedFrom?.agentId === source.id;
    if (!retried) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  }
  const started = yield* startCodingAgent(eve, userId, {
    ...placeOf(source),
    idempotencyKey,
    choice: undefined,
    from: { agentId: source.id },
    summaryModel,
  }).pipe(Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)));
  yield* hostedStoreOrUnavailable(handedOver(userId, source, started.agent));
  return yield* requestedStartOf(userId, started);
});
