import type { DatabaseServices } from "@luke/database/core/query";
import { type CodingAgent, readCodingAgentRouting } from "@luke/database/models/coding-agent-store";
import { replaceCodingAgentWakeups } from "@luke/database/models/coding-agent-wakeups";
import { REWIND_REFUSAL, rewindConversation } from "@luke/database/models/conversation-rewind";
import { recordedRuntimeSession } from "@luke/database/models/recorded-session";
import type { StoreWriter } from "@luke/database/models/writer";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { admitsPlanWriter, controlsAgent } from "../agent-reach.js";
import { EVE_RESET_OUTCOME } from "../brain-host/eve-sessions.js";
import { isNativeRuntime } from "./native-runtime.js";
import { runnerHalted } from "./runtime-sessions.js";
import { cancelledTurn, type EveReach, eveFor } from "./stop.js";

/**
 * rewind.ts -- a coding agent taken back to just before one of the developer's lines, as though that line and everything after it were never said.
 *
 * Whatever the agent is doing stops first, so nothing it still writes lands
 * after the cut: a native agent's runner is ended, keeping its sandbox and
 * the harness's own session, which the next message's launch cuts before
 * the same line and resumes (`conversation-rewind.ts`'s `nativeRewind`);
 * an eve agent's turn under way is stopped and its session retired, so the
 * next message opens a fresh one seeded with what is left. Then the
 * conversation is cut in one transaction. The agent's checkout is left as
 * it stands: only the conversation goes back.
 */

/** Why a cut the store refused is refused to its caller. */
const REFUSAL_OF_REWIND = {
  [REWIND_REFUSAL.NOT_FOUND]: HOSTED_REFUSAL.NOT_FOUND,
  [REWIND_REFUSAL.INSIDE_TURN]: HOSTED_REFUSAL.INVALID_REQUEST,
} as const;

/** What the agent is doing stopped, as above; refused as unavailable where it could not be. */
const stoppedForRewind = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: EveReach,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  account: string,
  agent: CodingAgent,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  // Wakeups a released wait left belong to the work the rewind drops.
  yield* hostedStoreOrUnavailable(replaceCodingAgentWakeups(agent.id, []));
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return;
  const routing = yield* hostedStoreOrUnavailable(readCodingAgentRouting(agent.userId, agent.id));
  const runtime = Option.isSome(routing) ? routing.value.runtime : CONVERSATION_RUNTIME.EVE;
  if (isNativeRuntime(runtime)) {
    if (!(yield* runnerHalted(agent, runtime, sessionId))) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    return;
  }
  const eve = eveFor(reach, request, account);
  yield* cancelledTurn(eve, writer, agent);
  const reset = yield* Effect.flatMap(eve, (sessions) => sessions.reset(sessionId)).pipe(
    Effect.catchTag("EveUnreachable", () => Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)),
  );
  if (reset.outcome === EVE_RESET_OUTCOME.FAILED) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
});

/**
 * The agent taken back to just before the developer's line named, as
 * above. Refused where the caller may not write to the agent, where no
 * such line stands, or where the line sits inside a turn's work.
 */
export const rewoundAgent = /* @__PURE__ */ Effect.fn("web/rewoundAgent")(function* (
  reach: EveReach,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  account: string,
  agent: CodingAgent,
  messageId: string,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  // An agent on its starter's own GitHub token takes words from its starter alone, and so is rewound by them alone.
  if (!controlsAgent(account, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* admitsPlanWriter(account, agent);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  yield* stoppedForRewind(reach, writer, request, account, agent);
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const cut = yield* hostedStoreOrUnavailable(rewindConversation(target, messageId));
  if (Result.isFailure(cut)) return yield* Effect.fail(REFUSAL_OF_REWIND[cut.failure]);
});
