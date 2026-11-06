import { type AgentOriginLiveAnswer, agentOriginOfLive } from "@repo/features/agent-origin-live";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import type { AgentOrigin } from "@repo/features/agent-wire";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { Effect, Option, type Scope } from "effect";
import { type AppAgentOrigins, NO_AGENT_ORIGINS } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import { pushLive } from "./live-push.js";

interface OriginUnanswered {
  readonly failure: string;
}

export interface OriginFollowDependencies {
  readonly seal: (
    agentId: string,
    poll: boolean,
    userId: string,
    after?: string,
  ) => Effect.Effect<AgentOriginLiveAnswer | OriginUnanswered>;
  readonly accountId: () => string | undefined;
  readonly gate: () => boolean;
  readonly tell: (held: AppAgentOrigins) => void;
}

function goneAfter(failure: string): boolean {
  return failure === AGENT_CALL_FAILURE.NOT_FOUND || failure === LIVE_SIGNED_OUT.failure;
}

function followOrigin(
  dependencies: OriginFollowDependencies,
  agentId: string,
  answers: HeldAnswers<AgentOrigin | null>,
): Effect.Effect<void> {
  const userId = dependencies.accountId();
  return pushLive({
    seal: (poll, after) =>
      dependencies.gate() && userId !== undefined
        ? Effect.map(dependencies.seal(agentId, poll, userId, after), (sealed) =>
            "failure" in sealed
              ? { failure: sealed.failure, gone: goneAfter(sealed.failure) }
              : sealed,
          )
        : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
    decode: (parts) => Option.some(parts.origin),
    publish: (rows) =>
      Effect.sync(() => {
        const origin = rows === undefined ? undefined : agentOriginOfLive(rows);
        if (origin === undefined) return answers.unanswered();
        answers.answered(origin);
      }),
  });
}

export function heldAgentOrigins(
  dependencies: OriginFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.AGENT_ORIGINS, string>({
    empty: NO_AGENT_ORIGINS,
    path: (agentId) => [agentId],
    gate: dependencies.gate,
    follow: (agentId, answers) => followOrigin(dependencies, agentId, answers),
    tell: dependencies.tell,
  });
}
