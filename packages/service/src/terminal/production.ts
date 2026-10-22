/**
 * production.ts -- the terminal relay's dependencies as the deployment stands them: the agent read by the one rule, its sandbox over Vercel's REST API, the PTY reached by WebSocket (`sandbox-pty.ts`), and the lease in the store.
 *
 * Each dependency answers over the services the function's runtime holds,
 * captured once as the relay stands, so the relay itself requires none. A
 * store that cannot take a keystroke's renewal is logged, since the next
 * keystroke tries again; one that cannot claim the credential's renewal is
 * read as not claimed, and one that cannot give a claim back is logged, so
 * the claim lapses on the agent's own rule. A keep-alive of the sandbox
 * Vercel did not confirm is logged, since the next one tries again.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { hasRepository, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import {
  claimCredentialRenewal,
  holdSandbox,
  releaseCredentialRenewal,
} from "@luke/database/models/sandbox-terminal-lease";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
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

/** What the relay's dependencies answer over. */
export type RelayServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

/** The relay's dependencies over the services the runtime holds now. */
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
            const found = yield* readCodingAgent(userId, agentId);
            if (Option.isNone(found) || found.value.archivedAt !== null) return Option.none();
            const agent = found.value;
            // Note that a shell in an agent on its starter's own GitHub token is its starter's alone.
            if (!controlsAgent(userId, agent)) return Option.none();
            // An agent with no repository opens no sandbox for a shell to reach.
            if (!hasRepository(agent)) return Option.none();
            const target = { userId: agent.userId, conversationId: agent.conversationId };
            const [session] = yield* standingSessionsOf(agent.userId, [agent.conversationId]);
            return Option.some({
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
