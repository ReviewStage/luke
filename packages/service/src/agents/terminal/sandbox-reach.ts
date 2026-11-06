import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { Effect } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { controlsAgent, reachedAgentById } from "../agent-reach.js";
import { type SandboxUnavailable, snapshotGone } from "../vercel-sandbox-api.js";

interface ReachedAgentSession {
  readonly conversationId: string;
  readonly sessionId: string | undefined;
  readonly machine: Agent["machine"];
}

export const reachedAgentSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
): Effect.fn.Return<ReachedAgentSession, HostedRefusal, DatabaseServices> {
  const { agent } = yield* reachedAgentById(userId, id);
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  const [session] = yield* hostedStoreOrUnavailable(
    standingSessionsOf(agent.userId, [agent.conversationId]),
  );
  return {
    conversationId: agent.conversationId,
    sessionId: session?.sessionId,
    machine: agent.machine,
  };
});

export function sandboxOrUpstream<A, R>(
  effect: Effect.Effect<A, SandboxUnavailable, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(effect, (failure) =>
    Effect.andThen(
      Effect.logWarning(`an agent's sandbox call failed: ${failure.message}`),
      Effect.fail(
        snapshotGone(failure)
          ? HOSTED_REFUSAL.SANDBOX_SNAPSHOT_GONE
          : HOSTED_REFUSAL.UPSTREAM_ERROR,
      ),
    ),
  );
}
