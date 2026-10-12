import type { DatabaseServices } from "@sidecar/database/core/query";
import {
  readAccountPreferences,
  writeAccountPreferences,
} from "@sidecar/database/models/account-store";
import {
  type CodingAgent,
  type CodingAgentBriefText,
  createCodingAgent,
  discardCodingAgent,
  listCodingAgents,
  readCodingAgentByKey,
} from "@sidecar/database/models/coding-agent-store";
import { readPlan, type StoredPlan } from "@sidecar/database/models/plan-store";
import {
  type CodingAgentAttachment,
  ROLLOUT_ROLE,
  type RolloutRole,
} from "@sidecar/hosted/coding-agent-wire";
import type { IntegrationProvider } from "@sidecar/hosted/integration-wire";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { CODING_AGENT_DEFAULT_CHOICE } from "@sidecar/hosted/models-wire";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import { ROLLOUT_BASE } from "@sidecar/hosted/plan-wire";
import { failureKind } from "@sidecar/runtime/effect";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../../github/github-app.js";
import { eveContent } from "../attached-files.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import {
  describeUnreachable,
  EVE_SEND_OUTCOME,
  type EveSessions,
} from "../brain-host/eve-sessions.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrArchived,
  hostedStoreOrUnavailable,
} from "../http-effect.js";
import {
  acceptedModelChoice,
  type ModelCatalog,
  type ModelChoiceRefused,
} from "../model-catalog.js";
import { workspaceRepository } from "../workspace-repository.js";
import { anthropicFastAccess } from "./account-keys.js";
import { type BriefPlan, pullRequestBrief, stackKeeperBrief } from "./brief.js";

/**
 * start.ts -- an agent started on a plan: the one path a Start takes, from the Start button or from Luke's voice.
 *
 * The model, effort, and context window are the ask's own where it names a
 * model, the account's stored default otherwise, either checked against the
 * catalog, which also
 * refuses a stored default that has since left it; a refused choice is
 * answered as the catalog's own refusal, so the route can say invalid and
 * the voice tool can say which choices there are. The plan must name a
 * repository the account still reaches through the Luke GitHub App, and
 * through its workspace's installation where it has one, read now rather
 * than when the plan named it (`hosted/workspace-repository.ts`). The
 * agent and its conversation are made under the ask's key, and a retry
 * carrying the same key is the same agent and opens nothing again; a new
 * agent's eve session opens with the plan's document as the Markdown Copy
 * would put on the clipboard, or with the ask's task in the plan's place
 * and the files attached to it, which only a task carries.
 * A Start at a position of the plan's rollout makes that pull request's
 * builder, a position past the rollout naming none, on the base branch the ask names, and is refused as
 * `position-taken` where a live builder already holds the position; a
 * Start of the rollout's keeper is refused as `keeper-taken` where a live
 * keeper stands. A retry under the same key still answers the agent it made.
 * A worker handed no task is handed its pull request's brief (`brief.ts`) in the plan's place,
 * naming the branch each pull request below it stands on: the ask's base for
 * the one it builds on, and the branch an earlier worker last stood on for
 * the rest, archived or not. A position the rollout does not name is
 * refused as invalid. The keeper is handed no task but the keeper's brief
 * (`brief.ts`), the rollout's pull requests with every branch a builder
 * recorded, and a keeper of a rollout with nothing in it is refused as
 * invalid.
 * An eve that did not take the opening leaves no agent behind, so the retry
 * under the same key starts afresh. An ask that named a choice makes it
 * the account's default, so the menu's last choice and the default stay one
 * value. Who reaches eve is the caller's: the route holds the developer's
 * own bearer, and the voice brain's tool acts as the deployment for the
 * account, which the coder channel's table admits for exactly this opening
 * (`coder-host/channel.ts`).
 */

/** What a Start asks: the plan, the key a retry carries again, the choice where one was made, the task where the agent is handed one in the plan's place, with the files attached to it, and the MCP servers its draft switched off. */
export interface StartAsk {
  readonly planId: string;
  readonly idempotencyKey: string;
  readonly choice: ModelChoice | undefined;
  readonly task: string | undefined;
  readonly attachments?: readonly CodingAgentAttachment[] | undefined;
  readonly disabledServers?: readonly IntegrationProvider[] | undefined;
  /** The pull request of the plan's rollout the agent works, counted from one, where it is that pull request's worker. */
  readonly position?: number | undefined;
  /** The branch the agent's work bases on, where it is not the repository's default. */
  readonly baseBranch?: string | undefined;
  /** What the agent does for the plan's rollout, where it is one of its agents; a position already implies a builder. */
  readonly role?: RolloutRole | undefined;
  /** Whether a named choice becomes the account's default, as a developer's own Start makes it; an automation's run keeps the default as it stands. */
  readonly rememberChoice?: boolean;
}

/** What a Start came to: the agent, and whether this ask made it or found it under its key. */
export interface CodingAgentStart {
  readonly agent: CodingAgent;
  readonly created: boolean;
}

/** What a Start reaches: the store, the catalog, GitHub through the App on the developer's standing, and the network to eve. */
export type StartServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog;

/**
 * The choice an agent runs on: the one named where one is, the account's
 * default otherwise, either checked against the catalog as the account is
 * offered it, so a fast version withheld from it, its key's organization
 * never granted fast mode, is refused here
 * rather than at the agent's first step. A catalog that
 * could not be read is an outage; a choice it refuses is its own refusal.
 */
export const acceptedAgentChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: ModelChoice | undefined,
): Effect.fn.Return<
  ModelChoice,
  HostedRefusal | ModelChoiceRefused,
  DatabaseServices | ModelCatalog
> {
  const choice =
    named ??
    (yield* hostedStoreOrUnavailable(readAccountPreferences(userId)))?.codingAgent ??
    CODING_AGENT_DEFAULT_CHOICE;
  const fastAccess = yield* hostedStoreOrUnavailable(anthropicFastAccess(userId));
  return yield* acceptedModelChoice(choice, fastAccess).pipe(
    Effect.catchTag("ModelCatalogUnavailable", (unavailable) =>
      Effect.logWarning(
        `the model catalog could not be read: ${failureKind(unavailable.cause)}`,
      ).pipe(Effect.andThen(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE))),
    ),
  );
});

/**
 * The role a Start asks for in the plan's rollout, or none for an agent
 * outside it. A position makes a builder, and a builder needs one. The
 * keeper stands at no position and on no base, and is handed no task, since
 * its brief is the rollout's stacks. Any other mix names no agent.
 */
function rolloutRoleOf(ask: StartAsk): Effect.Effect<RolloutRole | undefined, HostedRefusal> {
  const role = ask.position === undefined ? ask.role : (ask.role ?? ROLLOUT_ROLE.BUILDER);
  switch (role) {
    case undefined:
      return Effect.succeed(undefined);
    case ROLLOUT_ROLE.BUILDER:
      return ask.position === undefined
        ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
        : Effect.succeed(role);
    case ROLLOUT_ROLE.KEEPER:
      return ask.position === undefined && ask.baseBranch === undefined && ask.task === undefined
        ? Effect.succeed(role)
        : Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
}

/** What the brief reads of a stored plan. */
function briefPlanOf(stored: StoredPlan): BriefPlan {
  return { text: stored.text, rollout: stored.plan.rollout };
}

/** The branch each earlier pull request of the rollout stands on where it is known: the newest worker's at each position, archived or not, where it has recorded one, and the ask's base for the one the worker builds on. */
const branchesBelow = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  planId: string,
  base: number | undefined,
  baseBranch: string | undefined,
) {
  // An archived worker's branch still stands on GitHub, under the pull request it opened.
  const agents = yield* hostedStoreOrUnavailable(
    listCodingAgents(userId, planId, { includeArchived: true }),
  );
  const branches = new Map<number, string>();
  // The agents come oldest first at each position, so the newest worker decides, and one that
  // has recorded no branch yet names none, rather than a predecessor's it replaced.
  for (const agent of agents) {
    if (agent.position === null) continue;
    if (agent.branch === null) branches.delete(agent.position);
    else branches.set(agent.position, agent.branch);
  }
  if (base !== undefined && baseBranch !== undefined) branches.set(base, baseBranch);
  return branches;
});

/** What the agent is handed: the keeper's brief, the ask's task, the brief for the position it names, or the plan whole; undefined for a position the rollout does not name or a keeper of a rollout with nothing in it. */
const briefTextOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  stored: StoredPlan,
  ask: StartAsk,
  role: RolloutRole | undefined,
) {
  if (role === ROLLOUT_ROLE.KEEPER) {
    const branches = yield* branchesBelow(userId, ask.planId, undefined, undefined);
    const brief = stackKeeperBrief(ask.planId, stored.plan.rollout, branches);
    return brief === undefined ? undefined : ({ planSnapshot: brief, task: null } as const);
  }
  const task =
    ask.task === undefined ? undefined : ({ planSnapshot: null, task: ask.task } as const);
  if (ask.position === undefined) {
    return task ?? ({ planSnapshot: planMarkdown(stored.plan), task: null } as const);
  }
  const plan = briefPlanOf(stored);
  const item = plan.rollout[ask.position - 1];
  if (item === undefined) return undefined;
  if (task !== undefined) return task;
  const base = item.base === ROLLOUT_BASE.MAIN ? undefined : item.base;
  const branches = yield* branchesBelow(userId, ask.planId, base, ask.baseBranch);
  const brief = pullRequestBrief(plan, ask.position, branches);
  return brief === undefined ? undefined : ({ planSnapshot: brief, task: null } as const);
});

/** Starts the account's agent on the plan, as above; eve is composed only once a new agent needs its session opened, so a retry that found its agent asks for none. */
export const startCodingAgent = /* @__PURE__ */ Effect.fn("web/startCodingAgent")(function* (
  eve: Effect.Effect<EveSessions, HostedRefusal, HttpClient.HttpClient>,
  userId: string,
  ask: StartAsk,
): Effect.fn.Return<CodingAgentStart, HostedRefusal | ModelChoiceRefused, StartServices> {
  const role = yield* rolloutRoleOf(ask);
  const choice = yield* acceptedAgentChoice(userId, ask.choice);
  const plan = yield* hostedStoreOrUnavailable(readPlan(userId, ask.planId));
  if (Option.isNone(plan)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  // A position names a pull request of the plan's rollout, so one past it names no builder; a
  // retry still answers the builder its Start made at that position of this plan, whatever the
  // rollout has since become, and a key that made anything else answers nothing here.
  if (ask.position !== undefined && ask.position > plan.value.plan.rollout.length) {
    const made = yield* hostedStoreOrUnavailable(readCodingAgentByKey(userId, ask.idempotencyKey));
    const retried = Option.filter(
      made,
      (agent) => agent.planId === ask.planId && agent.position === ask.position,
    );
    if (Option.isSome(retried)) return { agent: retried.value, created: false };
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const repository = plan.value.plan.repository;
  if (repository === null) return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
  yield* workspaceRepository(plan.value.plan.workspaceId, repository);
  const brief: CodingAgentBriefText | undefined = yield* briefTextOf(userId, plan.value, ask, role);
  if (brief === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const started = yield* hostedStoreOrArchived(
    createCodingAgent(userId, {
      planId: ask.planId,
      idempotencyKey: ask.idempotencyKey,
      model: choice.model,
      effort: choice.effort,
      contextWindow: choice.contextWindow,
      ...brief,
      repository,
      disabledServers: ask.disabledServers,
      position: ask.position,
      baseBranch: ask.baseBranch,
      role,
    }),
  );
  if (Option.isNone(started)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { agent, created } = started.value;
  if (!created) return { agent, created };
  // The session opens with the plan or the task as its first message; an eve that did not take
  // it leaves no agent behind, so the retry under the same key starts afresh.
  const sessions = yield* eve;
  const opened = yield* sessions
    .open({
      conversationId: agent.conversationId,
      turn: BRAIN_HOST_TURN.TYPED,
      message:
        brief.task === null ? brief.planSnapshot : eveContent(brief.task, ask.attachments ?? []),
    })
    .pipe(
      Effect.catchTag("EveUnreachable", (failure) =>
        Effect.as(
          Effect.logWarning(
            `eve could not be reached to start a coding agent: ${describeUnreachable(failure)}`,
          ),
          undefined,
        ),
      ),
    );
  if (opened === undefined || opened.outcome !== EVE_SEND_OUTCOME.ACCEPTED) {
    yield* hostedStoreOrUnavailable(discardCodingAgent(userId, agent.id));
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  if (ask.choice !== undefined && ask.rememberChoice !== false) {
    yield* hostedStoreOrUnavailable(writeAccountPreferences(userId, { codingAgent: choice }));
  }
  return { agent, created };
});
