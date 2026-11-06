import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, readAgentRouting, readVisibleAgent } from "@repo/database/models/agent-store";
import { readAccountNames } from "@repo/database/models/workspace-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_MACHINE, AGENT_PAYER, type AgentPayer } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Effect, Option, type Scope } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  resolvedUserId,
  type UserIdResolver,
  uuidOf,
} from "../http/http-effect.js";
import type { StoreFailure } from "../http/store-failure.js";

export interface AccountResolving {
  readonly resolveUserId: UserIdResolver;
}

const AGENT_ID_QUERY = "id";

const UNNAMED_STARTER = "the member who started it";

export interface ReachedAgent {
  readonly userId: string;
  readonly agent: Agent;
  readonly target: ConversationTarget;
}

export const reachedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountResolving,
  request: Request,
): Effect.fn.Return<ReachedAgent, HostedRefusal, DatabaseServices | Scope.Scope> {
  const agentId = yield* uuidOf(request, AGENT_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  return yield* reachedAgentById(userId, agentId);
});

export const reachedAgentById = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
): Effect.fn.Return<ReachedAgent, HostedRefusal, DatabaseServices> {
  const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(userId, yield* pathUuid(id)));
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return {
    userId,
    agent: agent.value,
    target: { userId: agent.value.userId, conversationId: agent.value.conversationId },
  };
});

export function controlsAgent(
  userId: string,
  agent: Pick<Agent, "userId" | "githubAccess" | "machine">,
): boolean {
  if (agent.userId === userId) return true;
  return agent.githubAccess !== GITHUB_ACCESS.TOKEN && agent.machine !== AGENT_MACHINE.DEVICE;
}

export function agentStarterName(
  agent: Pick<Agent, "userId">,
): Effect.Effect<string, StoreFailure, DatabaseServices> {
  return Effect.map(
    readAccountNames([agent.userId]),
    (names) => names.get(agent.userId) ?? UNNAMED_STARTER,
  );
}

export const PLAN_AGENT_WRITERS = {
  STARTER: "starter",
  WORKSPACE: "workspace",
} as const;

export type PlanAgentWriters = (typeof PLAN_AGENT_WRITERS)[keyof typeof PLAN_AGENT_WRITERS];

const PLAN_AGENT_WRITER_POLICY: PlanAgentWriters = PLAN_AGENT_WRITERS.WORKSPACE;

const PLAN_PAYERS: ReadonlySet<AgentPayer> = new Set([
  AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  AGENT_PAYER.CHATGPT_SUBSCRIPTION,
]);

export function writesToAgent(
  userId: string,
  agent: Pick<Agent, "userId">,
  payer: AgentPayer | null,
  policy: PlanAgentWriters = PLAN_AGENT_WRITER_POLICY,
): boolean {
  if (payer === null || !PLAN_PAYERS.has(payer)) return true;
  return policy === PLAN_AGENT_WRITERS.WORKSPACE || agent.userId === userId;
}

export const admitsPlanWriter = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Pick<Agent, "id" | "userId">,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(userId, agent.id));
  if (Option.isNone(routing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (!writesToAgent(userId, agent, routing.value.payer)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
});
