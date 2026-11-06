import type { DatabaseServices } from "@repo/database/core/query";
import { hasRepository, readVisibleAgent } from "@repo/database/models/agent-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import {
  claimCredentialRenewal,
  holdSandbox,
  releaseCredentialRenewal,
} from "@repo/database/models/sandbox-terminal-lease";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Effect, Option } from "effect";
import { HttpClient } from "effect/http";
import { controlsAgent } from "../agents/agent-reach.js";
import { agentRepositoryToken } from "../agents/coder-host/checkout.js";
import { agentTurnUnderWay } from "../agents/coder-host/snapshot.js";
import { connectPty } from "../agents/sandbox-pty.js";
import { keepSessionSandboxAlive } from "../agents/session-sandboxes.js";
import { AgentSandbox, agentSandboxLayer } from "../agents/terminal/agent-sandbox.js";
import type { GitHubApp } from "../github/github-app.js";
import type { RelayDependencies } from "./relay.js";

export type RelayServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

export const relayDependencies: Effect.Effect<RelayDependencies, never, RelayServices> = Effect.gen(
  function* () {
    const context = yield* Effect.context<RelayServices>();
    const client = yield* HttpClient.HttpClient;
    const run = <A, E>(effect: Effect.Effect<A, E, RelayServices>) =>
      Effect.provideContext(effect, context);
    const sandbox = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* AgentSandbox;
      }),
      agentSandboxLayer,
    );
    return {
      reach: (userId, agentId) =>
        run(
          Effect.gen(function* () {
            const found = yield* readVisibleAgent(userId, agentId);
            if (Option.isNone(found) || found.value.archivedAt !== null) return Option.none();
            const agent = found.value;
            if (!controlsAgent(userId, agent)) return Option.none();
            if (!hasRepository(agent)) return Option.none();
            const target = { userId: agent.userId, conversationId: agent.conversationId };
            const [session] = yield* standingSessionsOf(agent.userId, [agent.conversationId]);
            return Option.some({
              userId: agent.userId,
              conversationId: agent.conversationId,
              sessionId: session?.sessionId,
              repositoryCredential: run(agentRepositoryToken(target, agent)),
              memberToken: agent.githubAccess === GITHUB_ACCESS.TOKEN,
              turnUnderWay: run(agentTurnUnderWay(agent.conversationId)),
            });
          }),
        ),
      sandbox,
      connect: (shell) => connectPty(shell, client),
      hold: (conversationId, heldUntil) =>
        run(holdSandbox(conversationId, heldUntil)).pipe(
          Effect.catch(() => Effect.logWarning("a terminal's lease was not moved on")),
        ),
      keepAlive: (sessionId) => run(keepSessionSandboxAlive(sessionId)),
      claimRenewal: (conversationId, sandboxSessionId, now, renewedBefore) =>
        run(claimCredentialRenewal(conversationId, sandboxSessionId, now, renewedBefore)).pipe(
          Effect.orElseSucceed(() => false),
        ),
      releaseRenewal: (conversationId, sandboxSessionId, claimedAt) =>
        run(releaseCredentialRenewal(conversationId, sandboxSessionId, claimedAt)).pipe(
          Effect.catch(() => Effect.logWarning("a terminal's credential claim was not given back")),
        ),
    };
  },
);
