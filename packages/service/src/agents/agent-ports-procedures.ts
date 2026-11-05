/**
 * agent-ports-procedures.ts -- the TCP ports a server listens on in a coding agent's cloud sandbox, for a member's Forward to localhost control, on the hosted oRPC router.
 *
 * The agent is reached by the Terminal tab's own rule
 * (`terminal/sandbox-reach.ts`): a member of its workspace, its starter
 * alone for one on the starter's own GitHub token, and an archived agent
 * gone; every other account reads it as none. The ports are read from the
 * running sandbox each time they are asked (`terminal/listening-ports.ts`),
 * one look at where the sandbox stands and one short command in it, so the
 * desktop polls this every few seconds while the control is open or
 * forwarding is on. A stopped sandbox is never woken here, and answers where
 * it stands with no ports; an agent on a Mac has no sandbox, and answers
 * none, as stopped.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import { Effect, type Layer } from "effect";
import type { HttpClient } from "effect/http";
import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { AgentSandbox } from "./terminal/agent-sandbox.js";
import { reachedAgentSession, sandboxOrUpstream } from "./terminal/sandbox-reach.js";

export interface AgentPortsProcedureSeams {
  resolveUserId: UserIdResolver;
  /** The agent's sandbox as the ports are read in it: Vercel's in production, a script's in a test. */
  readonly sandbox: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient | DatabaseServices>;
}

/** The agent ports resource: its one read, to a signed-in caller. */
export function agentPortsProcedures(seams: AgentPortsProcedureSeams) {
  const signedIn = hosted.agentPorts.use(accountMiddleware(seams.resolveUserId));
  return {
    /** The ports listened on in the agent's sandbox, and where it stands. */
    list: signedIn.list.effect(function* ({ input, context }) {
      const { sessionId, machine } = yield* reachedAgentSession(context.userId, input.id);
      if (machine === AGENT_MACHINE.DEVICE) return { sandbox: SANDBOX_STATE.STOPPED, ports: [] };
      if (sessionId === undefined) return { sandbox: SANDBOX_STATE.STARTING, ports: [] };
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
