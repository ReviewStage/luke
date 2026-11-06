import type { DatabaseServices } from "@repo/database/core/query";
import { hasRepository, readVisibleAgent } from "@repo/database/models/agent-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { holdSandbox } from "@repo/database/models/sandbox-terminal-lease";
import { Effect, Option } from "effect";
import { HttpClient } from "effect/http";
import { controlsAgent } from "../agents/agent-reach.js";
import { connectPty } from "../agents/sandbox-pty.js";
import { keepSessionSandboxAlive } from "../agents/session-sandboxes.js";
import { AgentSandbox, agentSandboxLayer } from "../agents/terminal/agent-sandbox.js";
import type { TunnelDependencies } from "./relay.js";

export type TunnelServices = DatabaseServices | HttpClient.HttpClient;

export const tunnelDependencies: Effect.Effect<TunnelDependencies, never, TunnelServices> =
  Effect.gen(function* () {
    const context = yield* Effect.context<TunnelServices>();
    const client = yield* HttpClient.HttpClient;
    const run = <A, E>(effect: Effect.Effect<A, E, TunnelServices>) =>
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
            const [session] = yield* standingSessionsOf(agent.userId, [agent.conversationId]);
            return Option.some({
              conversationId: agent.conversationId,
              sessionId: session?.sessionId,
            });
          }),
        ),
      open: (sessionId) => sandbox.open(sessionId),
      resume: (sessionId) => sandbox.resume(sessionId),
      connect: (shell) => connectPty(shell, client),
      hold: (conversationId, heldUntil) =>
        run(holdSandbox(conversationId, heldUntil)).pipe(
          Effect.catch(() => Effect.logWarning("a tunnel's lease was not moved on")),
        ),
      keepAlive: (sessionId) => run(keepSessionSandboxAlive(sessionId)),
    };
  });
