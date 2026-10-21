/**
 * agent-reach.ts -- the one rule for which coding agent a request reaches: the bearer's account, and an agent of a workspace it belongs to.
 *
 * Every route that names an agent by its id reads it through here, its
 * transcript, its controls, and its terminals alike, so who may reach an
 * agent is decided once. An id that is no UUID names no row, and another
 * workspace's agent reads as none at all.
 *
 * An agent that runs on its starter's own GitHub token is reached by the
 * members who see it (`@luke/database/models/workspace-store`), but steered,
 * given a shell, or started from by its starter alone (`controlsAgent`),
 * since all of that acts on GitHub as them.
 *
 * An agent its starter's Claude or ChatGPT plan pays for is read and forked
 * by every member who reaches it, a fork running on the forker's own payer,
 * but written to (messaged, steered, continued, or stopped) by those
 * `PLAN_AGENT_WRITER_POLICY` admits (`admitsPlanWriter`).
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  readCodingAgent,
  readCodingAgentRouting,
} from "@luke/database/models/coding-agent-store";
import { readAccountNames } from "@luke/database/models/workspace-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { CODING_AGENT_PAYER, type CodingAgentPayer } from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result } from "effect";
import { unparsedWire, wireUuidSchema } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import type { StoreFailure } from "../http/store-failure.js";

/** What resolves a request's bearer to the account it answers for. */
export interface AccountResolving {
  readonly resolveUserId: UserIdResolver;
}

/** The query name a rewrite moves the path's agent id into. */
const AGENT_ID_QUERY = "id";

/** Who an owner-only refusal names where the starter's account is gone. */
const UNNAMED_STARTER = "the member who started it";

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

/** An id a path named, or not found where it is no UUID, since it names no row. */
export const pathUuid = /* @__PURE__ */ Effect.fnUntraced(function* (
  id: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
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
  return yield* pathUuid(id);
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
  return yield* reachedAgentById(userId, agentId);
});

/**
 * The agent an id names for an account already resolved, as `reachedAgent`
 * reads it, for a procedure whose path carries the id: an id that is no
 * UUID names no row, and is not found.
 */
export const reachedAgentById = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
): Effect.fn.Return<ReachedAgent, HostedRefusal, DatabaseServices> {
  const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, yield* pathUuid(id)));
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return {
    userId,
    agent: agent.value,
    target: { userId: agent.value.userId, conversationId: agent.value.conversationId },
  };
});

/**
 * Whether the account may message the agent, open or use a shell in its
 * sandbox, or start an agent from it: any member who reaches it, but only
 * its starter for one that runs on the starter's own GitHub token.
 */
export function controlsAgent(
  userId: string,
  agent: Pick<CodingAgent, "userId" | "githubAccess">,
): boolean {
  return agent.githubAccess !== GITHUB_ACCESS.TOKEN || agent.userId === userId;
}

/** The name of the member who alone controls the agent, as a refusal says it: their name now, or who they were where their account is gone. */
export function agentStarterName(
  agent: Pick<CodingAgent, "userId">,
): Effect.Effect<string, StoreFailure, DatabaseServices> {
  return Effect.map(
    readAccountNames([agent.userId]),
    (names) => names.get(agent.userId) ?? UNNAMED_STARTER,
  );
}

/**
 * Who may write to an agent its starter's plan pays for: message it, steer
 * it, continue it, or stop it. Everyone who reaches it still reads it and
 * forks it onto their own payer.
 *
 * - `STARTER`: its starter alone, and the agents its starter started, which
 *   act as the starter.
 * - `WORKSPACE`: any member who reaches it, as for an agent on any other payer.
 */
export const PLAN_AGENT_WRITERS = {
  STARTER: "starter",
  WORKSPACE: "workspace",
} as const;

export type PlanAgentWriters = (typeof PLAN_AGENT_WRITERS)[keyof typeof PLAN_AGENT_WRITERS];

/**
 * The switch: who writes to a plan-funded agent. The developer decided "same
 * as today": any member who reaches it messages, steers, continues, or stops
 * it, billed to its starter's plan, as with an agent on any other payer.
 * Changing it is this one line.
 */
export const PLAN_AGENT_WRITER_POLICY: PlanAgentWriters = PLAN_AGENT_WRITERS.WORKSPACE;

/** The payers that are a member's own plan, which the policy above holds writers to. */
const PLAN_PAYERS: ReadonlySet<CodingAgentPayer> = new Set([
  CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION,
]);

/**
 * Whether the account may write to the agent, which its payer funds: any
 * member who reaches an agent on any other payer, or none recorded; and for
 * one a plan pays for, those the policy admits.
 */
export function writesToAgent(
  userId: string,
  agent: Pick<CodingAgent, "userId">,
  payer: CodingAgentPayer | null,
  policy: PlanAgentWriters = PLAN_AGENT_WRITER_POLICY,
): boolean {
  if (payer === null || !PLAN_PAYERS.has(payer)) return true;
  return policy === PLAN_AGENT_WRITERS.WORKSPACE || agent.userId === userId;
}

/**
 * The account admitted to write to the agent (`writesToAgent`), its payer
 * read now, or refused as not permitted; an agent the account no longer
 * reaches is not found.
 */
export const admitsPlanWriter = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Pick<CodingAgent, "id" | "userId">,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  const routing = yield* hostedStoreOrUnavailable(readCodingAgentRouting(userId, agent.id));
  if (Option.isNone(routing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (!writesToAgent(userId, agent, routing.value.payer)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
});
