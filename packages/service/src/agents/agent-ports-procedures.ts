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
 * forwarding is on. A sandbox that is not running, stopped or never opened,
 * is never woken here, and answers so with no ports; an agent on a Mac has
 * no sandbox, and answers the same.
 *
 * One port may be shared by a public link (`terminal/port-share.ts`), only
 * from a running sandbox: a share is refused as stopped otherwise, and holds
 * the sandbox's lease (`sandbox-terminal-lease.ts`) as a visit does, which
 * the sweep moves on while visits come (`maintenance/port-share-sweep.ts`).
 * The share is read back from the sandbox itself, never the store.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { holdSandbox } from "@repo/database/models/sandbox-terminal-lease";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { Clock, Effect, type Layer } from "effect";
import type { HttpClient } from "effect/http";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { AgentSandbox, type AgentSandboxService } from "./terminal/agent-sandbox.js";
import { shareHeldUntil } from "./terminal/port-share.js";
import { reachedAgentSession, sandboxOrUpstream } from "./terminal/sandbox-reach.js";
import type { SandboxUnavailable } from "./vercel-sandbox-api.js";

export interface AgentPortsProcedureSeams {
  resolveUserId: UserIdResolver;
  /** The agent's sandbox as the ports are read in it: Vercel's in production, a script's in a test. */
  readonly sandbox: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient | DatabaseServices>;
}

/** The agent ports resource: its read, and its one shared port, to a signed-in caller. */
export function agentPortsProcedures(seams: AgentPortsProcedureSeams) {
  const signedIn = hosted.agentPorts.use(accountMiddleware(seams.resolveUserId));
  /** The session of the agent's cloud sandbox the caller reaches; none for an agent on a Mac or one that has not run. */
  const cloudSession = (userId: string, id: string) =>
    Effect.map(reachedAgentSession(userId, id), (reached) => ({
      conversationId: reached.conversationId,
      sessionId: reached.machine === AGENT_MACHINE.DEVICE ? undefined : reached.sessionId,
    }));
  /** One call on the agent's sandbox, a failure of Vercel's refused as upstream. */
  const onSandbox = <A>(
    call: (sandbox: AgentSandboxService) => Effect.Effect<A, SandboxUnavailable>,
  ) =>
    Effect.provide(
      Effect.gen(function* () {
        return yield* sandboxOrUpstream(call(yield* AgentSandbox));
      }),
      seams.sandbox,
    );
  return {
    /** The ports listened on in the agent's sandbox, and whether it is running. */
    list: signedIn.list.effect(function* ({ input, context }) {
      const { sessionId } = yield* cloudSession(context.userId, input.id);
      if (sessionId === undefined) return { running: false, ports: [] };
      return yield* onSandbox((sandbox) => sandbox.listeningPorts(sessionId));
    }),
    /** The port shared by a public link, holding the sandbox as a visit does; a sandbox not running is refused as stopped. */
    share: signedIn.share.effect(function* ({ input, context }) {
      const { conversationId, sessionId } = yield* cloudSession(context.userId, input.params.id);
      if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.SANDBOX_STOPPED);
      const url = yield* onSandbox((sandbox) => sandbox.share(sessionId, input.body.port));
      if (url === undefined) return yield* Effect.fail(HOSTED_REFUSAL.SANDBOX_STOPPED);
      const now = yield* Clock.currentTimeMillis;
      yield* holdSandbox(conversationId, shareHeldUntil(now)).pipe(
        Effect.catch(() => Effect.logWarning("a shared port's lease was not moved on")),
      );
      return { url };
    }),
    /** The shared port's link closed. */
    unshare: signedIn.unshare.effect(function* ({ input, context }) {
      const { sessionId } = yield* cloudSession(context.userId, input.id);
      if (sessionId !== undefined) yield* onSandbox((sandbox) => sandbox.unshare(sessionId));
      return { shared: null };
    }),
    /** The port shared now and its link. */
    shared: signedIn.shared.effect(function* ({ input, context }) {
      const { sessionId } = yield* cloudSession(context.userId, input.id);
      if (sessionId === undefined) return { shared: null };
      return { shared: yield* onSandbox((sandbox) => sandbox.shared(sessionId)) };
    }),
  };
}
