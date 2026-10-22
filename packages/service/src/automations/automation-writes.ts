import { createHash, randomBytes } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  AUTOMATION_ACCESS,
  type Automation,
  type AutomationChanges,
  type AutomationRunInHistory,
  createAutomationCommitted,
  deleteAutomationCommitted,
  listAutomationRuns,
  updateAutomationCommitted,
} from "@luke/database/models/automation-store";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { readTaskHeader } from "@luke/database/models/task-store";
import { isWorkspaceMember, personalWorkspaceOf } from "@luke/database/models/workspace-store";
import { nextScheduledRun, readSchedule } from "@luke/features/automation-schedule";
import {
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationAction,
  type AutomationRunSummary,
  type AutomationScope,
  type AutomationSummary,
  type AutomationTarget,
  type AutomationTrigger,
  type automationChangeRequestSchema,
  type automationCreateRequestSchema,
} from "@luke/features/automation-wire";
import { CODING_AGENT_KIND, CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { Clock, Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { acceptedAgentChoice } from "../agents/coder-host/start.js";
import {
  type AgentTurnStanding,
  codingAgentFailureOf,
  codingAgentStatusOf,
} from "../agents/coder-host/status.js";
import { standingsOf } from "../agents/coder-host/stop.js";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import type { ModelCatalog } from "../providers/model-catalog.js";

/**
 * automation-writes.ts -- an automation made, changed, and deleted as an account asks, and read for the wire: one implementation for the automations routes and the agents' automation tools.
 *
 * The routes (`automations-procedures.ts`) and a coding agent's
 * `create_automation`, `update_automation`, and `delete_automation`
 * (`../agents/automation-tools.ts`) write through these alike, so what a
 * write checks is checked once: a schedule must read (five-field cron in a
 * known zone, no more often than every fifteen minutes), a model choice
 * must be one the catalog offers the account, an automation stands on a
 * task that names a repository or on a workspace with repositories its
 * installation reaches, but for one aimed at the account's own operator,
 * which works in none. A schedule's next due instant is computed whenever
 * the automation is made, resumed, or given a new trigger, and cleared
 * while it is paused. A webhook trigger's secret is minted here, kept only
 * as its SHA-256, and answered once, on the write that made it.
 */

/** The bytes of randomness in a webhook trigger's secret. */
const WEBHOOK_SECRET_BYTES = 32;

/** A webhook trigger's secret, answered once, and the hash the store keeps of it. */
interface WebhookSecret {
  readonly secret: string;
  readonly hash: string;
}

/** A fresh webhook secret and its hash. */
function mintWebhookSecret(): WebhookSecret {
  const secret = randomBytes(WEBHOOK_SECRET_BYTES).toString("base64url");
  return { secret, hash: createHash("sha256").update(secret).digest("hex") };
}

/** When a trigger is first due from `now`: a schedule's next instant, nothing for any other, and the refusal for a schedule that does not read. */
const firstDue = /* @__PURE__ */ Effect.fnUntraced(function* (
  trigger: AutomationTrigger,
  now: number,
): Effect.fn.Return<Date | null, HostedRefusal> {
  if (trigger.kind !== AUTOMATION_TRIGGER.SCHEDULE) return null;
  if (Result.isFailure(readSchedule(trigger, new Date(now)))) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return nextScheduledRun(trigger, new Date(now)) ?? null;
});

/** The action as the catalog takes it: a named model must be one offered the account, refused as an invalid request otherwise. */
const checkedAction = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  action: AutomationAction,
): Effect.fn.Return<AutomationAction, HostedRefusal, DatabaseServices | ModelCatalog> {
  if (action.choice === undefined) return action;
  yield* acceptedAgentChoice(userId, action.choice).pipe(
    Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
  );
  return action;
});

/** A run's agent for the wire: its status read from its standing, and why it failed where it did. */
function agentOf(
  id: string,
  title: string | null,
  createdAt: Date,
  ownKey: boolean,
  standing: AgentTurnStanding,
  now: number,
): NonNullable<AutomationRunSummary["agent"]> {
  const status = codingAgentStatusOf(standing.turn, {
    createdAt,
    now,
    awaitingLineAt: standing.awaitingLineAt,
  });
  const failureReason =
    status === CODING_AGENT_STATUS.FAILED ? codingAgentFailureOf(standing.turn) : undefined;
  return {
    id,
    title,
    status,
    ownKey,
    ...(failureReason === undefined ? undefined : { failureReason }),
  };
}

/** One run for the wire, its agent's status read from the standing given. */
function runSummaryOf(
  run: AutomationRunInHistory,
  standingOf: (conversationId: string) => AgentTurnStanding,
  now: number,
  readerId: string,
): AutomationRunSummary {
  const agent =
    run.codingAgentId === null || run.agentConversationId === null || run.agentCreatedAt === null
      ? null
      : agentOf(
          run.codingAgentId,
          run.agentTitle,
          run.agentCreatedAt,
          run.agentUserId === readerId,
          standingOf(run.agentConversationId),
          now,
        );
  return {
    id: run.id,
    firing: run.firing,
    status: run.status,
    reason: run.reason,
    agent,
    firedAt: run.firedAt.getTime(),
    settledAt: run.settledAt?.getTime() ?? null,
  };
}

/** The runs given summarized, their agents' standings read in one pass. */
export const runSummaries = /* @__PURE__ */ Effect.fnUntraced(function* (
  readerId: string,
  runs: readonly AutomationRunInHistory[],
): Effect.fn.Return<readonly AutomationRunSummary[], HostedRefusal, DatabaseServices> {
  const conversations = runs.flatMap((run) =>
    run.agentConversationId === null ? [] : [run.agentConversationId],
  );
  const standingOf = yield* standingsOf(conversations);
  const now = yield* Clock.currentTimeMillis;
  return runs.map((run) => runSummaryOf(run, standingOf, now, readerId));
});

/** One automation for the wire as the account reads it, with its newest run, whether the account made it, and who did. */
export const summaryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  automation: Automation,
): Effect.fn.Return<AutomationSummary, HostedRefusal, DatabaseServices> {
  const newest = yield* hostedStoreOrUnavailable(listAutomationRuns(userId, automation.id, 1));
  const [lastRun] = yield* runSummaries(userId, newest);
  return {
    id: automation.id,
    planId: automation.taskId,
    planName: automation.taskName,
    ...(automation.organizationId === null
      ? undefined
      : { workspaceId: automation.organizationId }),
    name: automation.name,
    enabled: automation.enabled,
    pausedReason: null,
    trigger: automation.trigger,
    action: automation.action,
    guards: automation.guards,
    nextRunAt: automation.nextRunAt?.getTime() ?? null,
    lastRun: lastRun ?? null,
    createdAt: automation.createdAt.getTime(),
    scope: automation.scope,
    repositories: automation.repositories,
    target:
      automation.targetKind === AUTOMATION_TARGET.SAME_AGENT
        ? { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: automation.targetAgentId }
        : { kind: AUTOMATION_TARGET.NEW_AGENT },
    archiveSuccessful: automation.archiveSuccessful,
    mine: automation.userId === userId,
    creatorId: automation.userId,
  };
});

/** Where a run lands, as the store keeps it. */
interface TargetColumns {
  readonly targetKind: AutomationTarget["kind"];
  readonly targetAgentId: string | null;
}

/**
 * A target the account may aim runs at: a new agent each run, or an agent
 * the account reads; an agent it cannot read is refused as no request at
 * all, the same as a malformed one.
 */
const checkedTarget = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  target: AutomationTarget,
): Effect.fn.Return<TargetColumns, HostedRefusal, DatabaseServices> {
  if (target.kind === AUTOMATION_TARGET.NEW_AGENT) {
    return { targetKind: AUTOMATION_TARGET.NEW_AGENT, targetAgentId: null };
  }
  const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, target.agentId));
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return { targetKind: AUTOMATION_TARGET.SAME_AGENT, targetAgentId: agent.value.id };
});

/** Refuses a workspace scope in the account's personal workspace, where everything is the account's own. */
const checkedScope = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  organizationId: string | null,
  scope: AutomationScope,
): Effect.fn.Return<AutomationScope, HostedRefusal, DatabaseServices> {
  if (scope === AUTOMATION_SCOPE.PERSONAL) return scope;
  const personal = yield* hostedStoreOrUnavailable(personalWorkspaceOf(userId));
  const inPersonal = Option.isSome(personal) && personal.value === organizationId;
  if (organizationId === null || inPersonal) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return scope;
});

/**
 * The repositories an automation's runs work in, each as GitHub spells it,
 * where the workspace's installation reaches every one; refused as the
 * first it does not reach is refused.
 */
const reachedRepositories = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  repositories: readonly string[],
): Effect.fn.Return<
  readonly string[],
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  // Note that an automation reaches through the workspace's installation alone, so it asks as no member.
  const reached = yield* Effect.forEach(repositories, (repository) =>
    workspaceRepository(organizationId, repository, undefined),
  );
  return reached.map((one) => one.repository.fullName);
});

/**
 * Whether the target is the account's own operator, standing in the
 * workspace the automation stands in: the one target an automation with no
 * repository may hand its runs to, since its runs steer an agent that works
 * in none and start no agent in a repository.
 */
const aimedAtOwnOperator = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  organizationId: string | null,
  target: AutomationTarget | undefined,
): Effect.fn.Return<boolean, HostedRefusal, DatabaseServices> {
  if (target?.kind !== AUTOMATION_TARGET.SAME_AGENT || organizationId === null) return false;
  const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, target.agentId));
  return (
    Option.isSome(agent) &&
    agent.value.kind === CODING_AGENT_KIND.OPERATOR &&
    agent.value.userId === userId &&
    agent.value.organizationId === organizationId
  );
});

/** Where a new automation stands: its task, as the task names its workspace and repository, or a workspace and the repositories named, each reached through it. */
interface Standing {
  readonly taskId: string | null;
  readonly organizationId: string;
  readonly repositories: readonly string[] | undefined;
}

/**
 * Where the request puts a new automation, read as the account: on a task
 * that names a repository, or on a workspace the account is a member of with
 * repositories its installation reaches; a request naming both, or neither,
 * or a workspace with no repositories, is refused as no request at all. The
 * one automation that needs no repository is one aimed at the account's own
 * operator (`aimedAtOwnOperator`), its heartbeat or one like it, which may
 * stand on a task with none or a workspace naming none.
 */
const standingOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  made: typeof automationCreateRequestSchema.Type,
): Effect.fn.Return<Standing, HostedRefusal, DatabaseServices | GitHubApp | HttpClient.HttpClient> {
  if (made.planId !== undefined) {
    if (made.workspaceId !== undefined || made.repositories !== undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }
    const task = yield* hostedStoreOrUnavailable(readTaskHeader(userId, made.planId));
    if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    if (
      task.value.repository === null &&
      !(yield* aimedAtOwnOperator(userId, task.value.workspaceId, made.target))
    ) {
      return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
    }
    return {
      taskId: made.planId,
      organizationId: task.value.workspaceId,
      repositories: undefined,
    };
  }
  if (made.workspaceId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, made.workspaceId));
  if (made.repositories === undefined) {
    // Note that only a run handed to the account's own operator works in no repository.
    if (!member || !(yield* aimedAtOwnOperator(userId, made.workspaceId, made.target))) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }
    return { taskId: null, organizationId: made.workspaceId, repositories: [] };
  }
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const repositories = yield* reachedRepositories(made.workspaceId, made.repositories);
  return { taskId: null, organizationId: made.workspaceId, repositories };
});

/**
 * The store's changes for a request against the automation as it stands:
 * the trigger and model checked, the due instant computed afresh whenever
 * the automation ends up enabled with a schedule and either was resumed or
 * given a new trigger, cleared while paused, and the owner's pause or resume
 * clearing why the service paused it. A webhook sent again is no change; a
 * trigger becoming a webhook mints its secret, and a hash the caller sends
 * replaces a webhook's secret with the one it minted.
 */
const changesOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  standing: Automation,
  asked: typeof automationChangeRequestSchema.Type,
): Effect.fn.Return<
  { readonly changes: AutomationChanges; readonly webhookSecret: string | undefined },
  HostedRefusal,
  DatabaseServices | ModelCatalog | GitHubApp | HttpClient.HttpClient
> {
  const now = yield* Clock.currentTimeMillis;
  // A webhook sent again is no change, since a webhook names nothing but its kind, so its secret
  // survives a form that sends the whole automation back.
  const newTrigger =
    asked.trigger?.kind === AUTOMATION_TRIGGER.WEBHOOK &&
    standing.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK
      ? undefined
      : asked.trigger;
  const trigger = newTrigger ?? standing.trigger;
  const enabled = asked.enabled ?? standing.enabled;
  const due = yield* firstDue(trigger, now);
  // Note that an action sent without its servers keeps the ones saved, because a desktop from before
  // them sends the whole action back on a prompt's edit, and would otherwise switch every one back on.
  const kept =
    asked.action === undefined ||
    asked.action.disabledServers !== undefined ||
    standing.action.disabledServers === undefined
      ? asked.action
      : { ...asked.action, disabledServers: standing.action.disabledServers };
  const action = kept === undefined ? undefined : yield* checkedAction(userId, kept);
  const becameWebhook =
    newTrigger?.kind === AUTOMATION_TRIGGER.WEBHOOK &&
    standing.trigger.kind !== AUTOMATION_TRIGGER.WEBHOOK;
  // A secret is replaced on a webhook alone: there is none to replace on any other trigger.
  if (asked.webhookSecretHash !== undefined && trigger.kind !== AUTOMATION_TRIGGER.WEBHOOK) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  // A secret the caller minted stands in place of one minted here, so no secret is answered that would not hold.
  const webhook =
    becameWebhook && asked.webhookSecretHash === undefined ? mintWebhookSecret() : undefined;
  const secretHash = asked.webhookSecretHash ?? webhook?.hash;
  const scope =
    asked.scope === undefined
      ? undefined
      : yield* checkedScope(userId, standing.organizationId, asked.scope);
  const target =
    asked.target === undefined ? undefined : yield* checkedTarget(userId, asked.target);
  // An automation with no repository hands its runs to its owner's operator, and to no other target.
  if (
    asked.target !== undefined &&
    asked.repositories === undefined &&
    standing.repositories.length === 0 &&
    !(yield* aimedAtOwnOperator(userId, standing.organizationId, asked.target))
  ) {
    return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
  }
  // Note that new repositories are read through the automation's own workspace, as its runs will
  // reach them, and that one standing on a task takes its task's repository and no other.
  if (asked.repositories !== undefined && standing.taskId !== null) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const repositories =
    asked.repositories === undefined || standing.organizationId === null
      ? undefined
      : yield* reachedRepositories(standing.organizationId, asked.repositories);
  // Note that only a resume or a pause moves the due instant, so a form that sends `enabled` as it stands skips no firing.
  const reschedules =
    newTrigger !== undefined || (asked.enabled !== undefined && asked.enabled !== standing.enabled);
  const changes: AutomationChanges = {
    ...(asked.name === undefined ? undefined : { name: asked.name }),
    ...(asked.enabled === undefined ? undefined : { enabled: asked.enabled }),
    ...(newTrigger === undefined ? undefined : { trigger: newTrigger }),
    ...(action === undefined ? undefined : { action }),
    ...(asked.guards === undefined ? undefined : { guards: asked.guards }),
    ...(reschedules ? { nextRunAt: enabled ? due : null } : undefined),
    ...(secretHash === undefined ? undefined : { webhookSecretHash: secretHash }),
    ...(scope === undefined ? undefined : { scope }),
    ...(repositories === undefined ? undefined : { repositories }),
    ...target,
    ...(asked.archiveSuccessful === undefined
      ? undefined
      : { archiveSuccessful: asked.archiveSuccessful }),
  };
  return { changes, webhookSecret: webhook?.secret };
});

/** A write as it answers: the automation as it then stands, a webhook secret the write minted, and the transaction it committed in. */
export interface AutomationWritten {
  readonly automation: AutomationSummary;
  readonly webhookSecret: string | undefined;
  readonly txid: string;
}

/**
 * An automation made for the account as the request asks, on a task of
 * its with a repository or on a workspace of its with the repositories its
 * runs work in, under the id given where the caller names one.
 */
export const createAutomationAs = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  made: typeof automationCreateRequestSchema.Type,
  id?: string,
): Effect.fn.Return<
  AutomationWritten,
  HostedRefusal,
  DatabaseServices | ModelCatalog | GitHubApp | HttpClient.HttpClient
> {
  const now = yield* Clock.currentTimeMillis;
  const nextRunAt = yield* firstDue(made.trigger, now);
  const action = yield* checkedAction(userId, made.action);
  const standing = yield* standingOf(userId, made);
  const scope = yield* checkedScope(
    userId,
    standing.organizationId,
    made.scope ?? AUTOMATION_SCOPE.PERSONAL,
  );
  const target = yield* checkedTarget(userId, made.target ?? { kind: AUTOMATION_TARGET.NEW_AGENT });
  const webhook =
    made.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK ? mintWebhookSecret() : undefined;
  const created = yield* hostedStoreOrUnavailable(
    createAutomationCommitted(userId, {
      ...(id === undefined ? undefined : { id }),
      taskId: standing.taskId,
      organizationId: standing.organizationId,
      repositories: standing.repositories,
      name: made.name,
      trigger: made.trigger,
      action,
      guards: made.guards ?? AUTOMATION_DEFAULT_GUARDS,
      nextRunAt,
      webhookSecretHash: webhook?.hash ?? null,
      scope,
      ...target,
      archiveSuccessful: made.archiveSuccessful ?? false,
    }),
  );
  if (Option.isNone(created)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  yield* recordServerEvent(SERVER_EVENT.AUTOMATION_CREATE, userId, {
    trigger_kind: made.trigger.kind,
  });
  return {
    automation: yield* summaryOf(userId, created.value.automation),
    webhookSecret: webhook?.secret,
    txid: created.value.txid,
  };
});

/**
 * One automation the account reads changed as the request asks, answered as
 * it then stands; one it reads but may not change, or turn on or off where
 * the request names `enabled` alone, is refused as not permitted.
 */
export const changeAutomationAs = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  standing: Automation,
  asked: typeof automationChangeRequestSchema.Type,
): Effect.fn.Return<
  AutomationWritten,
  HostedRefusal,
  DatabaseServices | ModelCatalog | GitHubApp | HttpClient.HttpClient
> {
  const { changes, webhookSecret } = yield* changesOf(userId, standing, asked);
  // Turning it on or off alone is the toggle, which more of the workspace may do than change it.
  const access = Object.keys(asked).every((field) => field === "enabled")
    ? AUTOMATION_ACCESS.TOGGLE
    : AUTOMATION_ACCESS.CHANGE;
  const written = yield* hostedStoreOrUnavailable(
    updateAutomationCommitted(userId, standing.id, changes, access),
  );
  if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return {
    automation: yield* summaryOf(userId, written.value.automation),
    webhookSecret,
    txid: written.value.txid,
  };
});

/** One automation the account reads deleted with its history, answering the transaction it went in; one it may not delete is refused as not permitted. */
export const removeAutomationAs = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
): Effect.fn.Return<string, HostedRefusal, DatabaseServices> {
  const deleted = yield* hostedStoreOrUnavailable(deleteAutomationCommitted(userId, id));
  if (Option.isNone(deleted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return deleted.value.txid;
});
