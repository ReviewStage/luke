/**
 * production.ts -- the terminal relay's dependencies as the deployment stands them: the agent read by the one rule, its sandbox over Vercel's REST API, the PTY reached by WebSocket, and the lease in the store.
 *
 * Each dependency answers over the services the function's runtime holds,
 * captured once as the relay stands, so the relay itself requires none. A
 * store that cannot take a keystroke's renewal is logged, since the next
 * keystroke tries again; one that cannot claim the credential's renewal is
 * read as not claimed, and one that cannot give a claim back is logged, so
 * the claim lapses on the agent's own rule.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import {
  claimCredentialRenewal,
  holdSandbox,
  releaseCredentialRenewal,
} from "@luke/database/models/sandbox-terminal-lease";
import { Duration, Effect, Option, Redacted, Schedule } from "effect";
import { HttpClient } from "effect/http";
import { WebSocket } from "ws";
import { controlsAgent } from "../agents/agent-reach.js";
import { agentRepositoryToken } from "../agents/coder-host/checkout.js";
import { AgentSandbox, agentSandboxLayer } from "../agents/terminal/agent-sandbox.js";
import { type InteractiveShell, SandboxUnavailable } from "../agents/vercel-sandbox-api.js";
import type { GitHubApp } from "../github/github-app.js";
import { voiceSocket } from "../voice/socket.js";
import type { RelayDependencies } from "./relay.js";

/** What the relay's dependencies answer over. */
export type RelayServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

const PTY_CONNECT = {
  /** How long the PTY's socket may take to open. */
  OPEN_TIMEOUT: Duration.seconds(10),
  /** How many times the PTY server's health is asked before the socket opens, as Vercel's own CLI asks it. */
  HEALTH_RETRIES: 5,
  HEALTH_SPACING: Duration.millis(100),
} as const;

/** The PTY's socket opened under its minted token, once its server answers healthy. */
function connectPty(shell: InteractiveShell, client: HttpClient.HttpClient) {
  return Effect.gen(function* () {
    const address = new URL(shell.url);
    const health = new URL("/health", `https://${address.host}`);
    yield* client.get(health).pipe(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.void
          : Effect.fail(new SandboxUnavailable({ status: response.status })),
      ),
      Effect.scoped,
      Effect.retry({
        schedule: Schedule.spaced(PTY_CONNECT.HEALTH_SPACING),
        times: PTY_CONNECT.HEALTH_RETRIES,
      }),
      Effect.mapError(() => new SandboxUnavailable({})),
    );
    address.searchParams.set("token", Redacted.value(shell.token));
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocket(address)),
      (open) => Effect.sync(() => open.close()),
    );
    yield* Effect.callback<void, SandboxUnavailable>((resume) => {
      socket.once("open", () => resume(Effect.void));
      socket.once("error", () => resume(Effect.fail(new SandboxUnavailable({}))));
    }).pipe(
      Effect.timeoutOrElse({
        duration: PTY_CONNECT.OPEN_TIMEOUT,
        orElse: () => Effect.fail(new SandboxUnavailable({})),
      }),
    );
    return yield* voiceSocket(socket);
  });
}

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
            const target = { userId: agent.userId, conversationId: agent.conversationId };
            const [session] = yield* standingSessionsOf(agent.userId, [agent.conversationId]);
            return Option.some({
              conversationId: agent.conversationId,
              sessionId: session?.sessionId,
              repositoryToken: run(
                Effect.map(agentRepositoryToken(target, agent), (minted) => minted.token),
              ),
            });
          }),
        ),
      sandbox,
      connect: (shell) => connectPty(shell, client),
      hold: (conversationId, heldUntil) =>
        run(holdSandbox(conversationId, heldUntil)).pipe(
          Effect.catch(() => Effect.logWarning("a terminal's lease was not moved on")),
        ),
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
