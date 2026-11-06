/**
 * sandbox-reach.ts -- which coding agent's sandbox a member's request reaches, by the Terminal tab's rule, and a sandbox that did not answer as the refusal a route answers.
 *
 * Every route that acts in an agent's sandbox for a member, its shells, its
 * resume, and the ports listened on in it, reads the agent through here, so
 * who may reach a sandbox is decided once (`../agent-reach.ts`'s
 * `controlsAgent`).
 */

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

/** The agent a sandbox route reaches: its conversation, the session its sandbox is tagged with, and the machine it runs on. */
interface ReachedAgentSession {
  readonly conversationId: string;
  readonly sessionId: string | undefined;
  readonly machine: Agent["machine"];
}

/**
 * The agent the path names, still standing: its conversation, which a
 * sandbox's lease is held on, and the session its sandbox is tagged
 * with, or none where the agent has not run yet. An archived agent
 * is gone, as its tab is, and one on its starter's own GitHub token gives its
 * sandbox to its starter alone.
 */
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

/**
 * A sandbox Vercel could not be asked about, as the upstream's refusal a
 * caller may retry, apart from the store's own unavailable, so the tab can
 * say it was the agent's sandbox that did not answer: Vercel Sandbox's API,
 * or a command in a sandbox that API answered for. A sandbox whose snapshot
 * is gone is refused as that, since no retry resumes it. The log names the
 * status Vercel answered, where it answered one.
 */
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
