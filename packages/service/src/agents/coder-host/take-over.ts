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
 * Two members taking over the same agent at once each start an agent, but
 * the source is archived under its own lock for one of them alone, who
 * takes its items and automations, its agent named in the source's
 * archive; the other's take-over is refused, and its agent stopped and
 * archived where a stop lands, or left standing for its member where it is
 * still coming up. A key already spent on another
 * Start is refused rather than handed the source's work.
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
  archiveIdleCodingAgent,
  type CodingAgent,
  IDLE_ARCHIVE,
  readCodingAgent,
  readCodingAgentByKey,
} from "@luke/database/models/coding-agent-store";
import { storeWriter } from "@luke/database/models/writer";
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
import { cancelledTurn, stopsForGood } from "./stop.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** Why the source is archived, as its banner says beside who archived it. */
export const TAKEN_OVER_REASON = "Taken over";

/** Why an agent that lost a race to take over the same source is archived, as its banner says. */
const TAKEN_OVER_FIRST_REASON = "Another member took this agent's source over first";

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
 * The source archived as taken over by the account for `agent`, which the
 * archive names, and its open inbox items and the automations that send it
 * their runs handed to that agent, together or not at all; answers whether
 * `agent` holds the source. The archive is stamped under the source's own
 * lock only where it stands unarchived, so of two take-overs racing one
 * wins and the other moves nothing. A source already archived for the same
 * agent, as by a retry or a second request under the same key, is held by
 * it still, and hands on whatever is left; one archived for another agent,
 * or by anything else, is not.
 */
const handedOver = (userId: string, source: CodingAgent, agent: CodingAgent) =>
  Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const archived = yield* archiveIdleCodingAgent(
          userId,
          source.id,
          {
            by: CODING_AGENT_ARCHIVER.MEMBER,
            userId,
            reason: TAKEN_OVER_REASON,
            agentId: agent.id,
          },
          () => Effect.succeed(true),
        );
        if (archived === IDLE_ARCHIVE.ALREADY) {
          // Read again under the lock the archive took, which the transaction holds.
          const now = yield* readCodingAgent(userId, source.id);
          const heldBy = Option.isSome(now) ? now.value.archivedBy : null;
          if (heldBy?.reason !== TAKEN_OVER_REASON || heldBy.agentId !== agent.id) return false;
        } else if (archived !== IDLE_ARCHIVE.ARCHIVED) {
          return false;
        }
        yield* handOverOpenInboxItems(
          userId,
          { userId: source.userId, agentId: source.id },
          { userId: agent.userId, agentId: agent.id },
        );
        yield* retargetAutomations(userId, source.id, agent.id);
        return true;
      }),
    ),
  );

/**
 * The agent a take-over started that lost the source to another one,
 * stopped and archived saying so, since the work goes on in the other.
 * Note that one still coming up, with no turn a stop can name yet, or
 * whose stop did not land, is left standing rather than archived, because
 * an archive would hide an agent that may still be working; it is the
 * member's own, to stop from its tab.
 */
const lostRace = (
  eve: Effect.Effect<EveSessions<EveTypedTurn>, HostedRefusal, HttpClient.HttpClient>,
  userId: string,
  agent: CodingAgent,
) =>
  Effect.gen(function* () {
    if (agent.archivedAt !== null) return;
    yield* cancelledTurn(eve, storeWriter({ tools: CODER_TOOL_SET }), agent).pipe(
      Effect.catch((refusal) =>
        Effect.logWarning(`a take-over that lost its source was not stopped: ${refusal.error}`),
      ),
    );
    if (!(yield* stopsForGood(agent))) {
      return yield* Effect.logWarning("a take-over that lost its source is still coming up");
    }
    yield* hostedStoreOrUnavailable(
      archiveCodingAgent(userId, agent.id, true, {
        by: CODING_AGENT_ARCHIVER.MEMBER,
        userId,
        reason: TAKEN_OVER_FIRST_REASON,
      }),
    );
  });

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
  // A key already spent on another Start, or a take-over of another agent, hands nothing on.
  const made = yield* hostedStoreOrUnavailable(readCodingAgentByKey(userId, idempotencyKey));
  const retried = Option.isSome(made);
  if (retried && made.value.startedFrom?.agentId !== source.id) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  // Only the take-over that archived it finds it archived and goes on.
  if (source.archivedAt !== null && !retried) {
    return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  }
  const started = yield* startCodingAgent(eve, userId, {
    ...placeOf(source),
    idempotencyKey,
    choice: undefined,
    from: { agentId: source.id },
    summaryModel,
  }).pipe(Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)));
  if (started.agent.startedFrom?.agentId !== source.id) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const holds = yield* hostedStoreOrUnavailable(handedOver(userId, source, started.agent));
  if (!holds) {
    yield* lostRace(eve, userId, started.agent);
    return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  }
  return yield* requestedStartOf(userId, started);
});
