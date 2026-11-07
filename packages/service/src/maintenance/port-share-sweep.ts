/**
 * port-share-sweep.ts -- the scheduled sweep's close of a shared port's link no one has visited for its idle bound, and its hold on the sandbox while visits come.
 *
 * A shared sandbox carries the share's tag (`agents/terminal/port-share.ts`),
 * which the sweep lists by, one page a minute. A running one's last visit is
 * read from its helper's folder: past the idle bound, the share is closed as
 * the developer's own close does; within it, the sandbox's lease is held
 * from that visit and the sandbox kept alive, as a forwarded port's traffic
 * holds it. A stopped one is left until it runs again, when its old visit
 * closes it. What is logged of a failure is its status alone.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { agentConversation } from "@repo/database/models/agent-store";
import { holdSandbox } from "@repo/database/models/sandbox-terminal-lease";
import { Duration, Effect, Option, Result } from "effect";
import { agentTag } from "../agents/machine/vercel-machine.js";
import { keepSessionSandboxAlive } from "../agents/session-sandboxes.js";
import {
  PORT_SHARE,
  readSharedPort,
  shareHeldUntil,
  unsharePort,
} from "../agents/terminal/port-share.js";
import {
  deploymentOidcToken,
  type ListedSandbox,
  SANDBOX_STATUS,
  SESSION_TAG,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../agents/vercel-sandbox-api.js";

/** How many shared sandboxes are read at once. */
const CONCURRENCY = 5;

/** One shared sandbox swept: its share closed where it went idle, answering whether it was, or its sandbox held. */
const sweptShare = (api: VercelSandboxApi, sandbox: ListedSandbox, now: Date) =>
  Effect.gen(function* () {
    const sandboxSessionId = sandbox.currentSessionId;
    if (sandbox.status !== SANDBOX_STATUS.RUNNING || sandboxSessionId === undefined) return false;
    const running = yield* api.session({ name: sandbox.name, sessionId: sandboxSessionId });
    const visitedAt = (yield* readSharedPort(running))?.visitedAt ?? 0;
    if (now.getTime() - visitedAt >= Duration.toMillis(PORT_SHARE.IDLE)) {
      yield* unsharePort(api, sandbox, running);
      return true;
    }
    const agentId = agentTag(sandbox.tags);
    const conversation = agentId === undefined ? Option.none() : yield* agentConversation(agentId);
    if (Option.isSome(conversation)) {
      yield* holdSandbox(conversation.value.conversationId, shareHeldUntil(visitedAt));
    }
    const sessionId = sandbox.tags?.[SESSION_TAG];
    if (sessionId !== undefined) yield* keepSessionSandboxAlive(sessionId);
    return false;
  }).pipe(
    Effect.catchTag("SandboxUnavailable", (failure) =>
      Effect.as(Effect.logWarning(`a shared port was not swept: ${failure.message}`), false),
    ),
  );

/** Closes the shared ports' links idle past the bound and holds the rest, answering how many closed. */
export const sweepPortShares = /* @__PURE__ */ Effect.fn("web/sweepPortShares")(function* (
  now: Date,
): Effect.fn.Return<number, StoreFailure, DatabaseServices> {
  const api = yield* vercelSandboxApi(deploymentOidcToken);
  const listed = yield* Effect.result(api.listCarrying(PORT_SHARE.TAG, PORT_SHARE.TAG_ON));
  if (Result.isFailure(listed)) {
    yield* Effect.logWarning(`the shared sandboxes were not listed: ${listed.failure.message}`);
    return 0;
  }
  const closed = yield* Effect.forEach(listed.success, (sandbox) => sweptShare(api, sandbox, now), {
    concurrency: CONCURRENCY,
  });
  return closed.filter(Boolean).length;
});
