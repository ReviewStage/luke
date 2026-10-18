/**
 * agent-reach.ts -- the one rule for which coding agent a request reaches: the bearer's account, and an agent of a workspace it belongs to.
 *
 * Every route that names an agent by its id reads it through here, its
 * transcript, its controls, and its terminals alike, so who may reach an
 * agent is decided once. An id that is no UUID names no row, and another
 * workspace's agent reads as none at all.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { type CodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result } from "effect";
import { unparsedWire, wireUuidSchema } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";

/** What resolves a request's bearer to the account it answers for. */
export interface AccountResolving {
  readonly resolveUserId: UserIdResolver;
}

/** The query name a rewrite moves the path's agent id into. */
const AGENT_ID_QUERY = "id";

/** An agent reached, the account that reached it, and its conversation targeted under the member who started it, whom it belongs to. */
export interface ReachedAgent {
  readonly userId: string;
  readonly agent: CodingAgent;
  readonly target: ConversationTarget;
}

/** The bearer's account, or the invalid-token refusal. */
export const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountResolving,
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** The one id the path put under the query name; two is refused, and one that is no UUID names no row. */
export const uuidOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  name: string,
): Effect.fn.Return<string, HostedRefusal> {
  const ids = new URL(request.url).searchParams.getAll(name);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/**
 * The agent the path names, on a task or with none, where the account is a
 * member of its workspace, or not found; its conversation is targeted
 * under the member who started it, which is whom the conversation belongs
 * to.
 */
export const reachedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountResolving,
  request: Request,
): Effect.fn.Return<ReachedAgent, HostedRefusal, DatabaseServices> {
  const agentId = yield* uuidOf(request, AGENT_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, agentId));
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return {
    userId,
    agent: agent.value,
    target: { userId: agent.value.userId, conversationId: agent.value.conversationId },
  };
});
