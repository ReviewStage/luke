import type { DatabaseServices } from "@repo/database/core/query";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { Effect, type Layer } from "effect";
import type { HttpClient } from "effect/http";
import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { AgentSandbox } from "./terminal/agent-sandbox.js";
import { reachedAgentSession, sandboxOrUpstream } from "./terminal/sandbox-reach.js";

export interface AgentPortsProcedureSeams {
  resolveUserId: UserIdResolver;
  readonly sandbox: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient | DatabaseServices>;
}

export function agentPortsProcedures(seams: AgentPortsProcedureSeams) {
  const signedIn = hosted.agentPorts.use(accountMiddleware(seams.resolveUserId));
  return {
    list: signedIn.list.effect(function* ({ input, context }) {
      const { sessionId, machine } = yield* reachedAgentSession(context.userId, input.id);
      if (machine === AGENT_MACHINE.DEVICE || sessionId === undefined) {
        return { running: false, ports: [] };
      }
      return yield* Effect.provide(
        Effect.gen(function* () {
          const sandbox = yield* AgentSandbox;
          return yield* sandboxOrUpstream(sandbox.listeningPorts(sessionId));
        }),
        seams.sandbox,
      );
    }),
  };
}
