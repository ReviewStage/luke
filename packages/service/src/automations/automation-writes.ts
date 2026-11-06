import { createHash, randomBytes } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import {
  AUTOMATION_ACCESS,
  type Automation,
  type AutomationChanges,
  type AutomationRunInHistory,
  automationRunByKey,
  createAutomationCommitted,
  deleteAutomationCommitted,
  listAutomationRuns,
  readAutomation,
  recordAutomationRun,
  updateAutomationCommitted,
} from "@repo/database/models/automation-store";
import { isWorkspaceMember, personalWorkspaceOf } from "@repo/database/models/workspace-store";
import { AGENT_STATUS } from "@repo/features/agent-wire";
import { nextScheduledRun, readSchedule } from "@repo/features/automation-schedule";
import {
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
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
} from "@repo/features/automation-wire";
import { Clock, DateTime, Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { acceptedAgentChoice } from "../agents/coder-host/start.js";
import {
  type AgentTurnStanding,
  agentFailureOf,
  agentStatusOf,
} from "../agents/coder-host/status.js";
import { standingsOf } from "../agents/coder-host/stop.js";
import {
  recordServerEvent,
  SERVER_AUTOMATION_CHANGE_ACTION,
  type SERVER_AUTOMATION_SOURCE,
  SERVER_EVENT,
} from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { executeAutomationRun, type SessionsForAccount } from "./automation-runs.js";

const WEBHOOK_SECRET_BYTES = 32;

interface WebhookSecret {
  readonly secret: string;
  readonly hash: string;
}

function mintWebhookSecret(): WebhookSecret {
  const secret = randomBytes(WEBHOOK_SECRET_BYTES).toString("base64url");
  return { secret, hash: createHash("sha256").update(secret).digest("hex") };
}

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

function agentOf(
  id: string,
  title: string | null,
  createdAt: Date,
  ownKey: boolean,
  standing: AgentTurnStanding,
  now: number,
): NonNullable<AutomationRunSummary["agent"]> {
  const status = agentStatusOf(standing.turn, {
    createdAt,
    now,
    awaitingLineAt: standing.awaitingLineAt,
  });
  const failureReason = status === AGENT_STATUS.FAILED ? agentFailureOf(standing.turn) : undefined;
  return {
    id,
    title,
    status,
    ownKey,
    ...(failureReason === undefined ? undefined : { failureReason }),
  };
}

function runSummaryOf(
  run: AutomationRunInHistory,
  standingOf: (conversationId: string) => AgentTurnStanding,
  now: number,
  readerId: string,
): AutomationRunSummary {
  const agent =
    run.agentId === null || run.agentConversationId === null || run.agentCreatedAt === null
      ? null
      : agentOf(
          run.agentId,
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

export const summaryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  automation: Automation,
): Effect.fn.Return<AutomationSummary, HostedRefusal, DatabaseServices> {
  const newest = yield* hostedStoreOrUnavailable(listAutomationRuns(userId, automation.id, 1));
  const [lastRun] = yield* runSummaries(userId, newest);
  return {
    id: automation.id,
    planId: null,
    planName: null,
    workspaceId: automation.organizationId,
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
    slackDelivery: automation.slackDelivery,
    mine: automation.userId === userId,
    creatorId: automation.userId,
  };
});

interface TargetColumns {
  readonly targetKind: AutomationTarget["kind"];
  readonly targetAgentId: string | null;
}

const checkedTarget = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  target: AutomationTarget,
): Effect.fn.Return<TargetColumns, HostedRefusal, DatabaseServices> {
  if (target.kind === AUTOMATION_TARGET.NEW_AGENT) {
    return { targetKind: AUTOMATION_TARGET.NEW_AGENT, targetAgentId: null };
  }
  if (target.agentId === null)
    return { targetKind: AUTOMATION_TARGET.SAME_AGENT, targetAgentId: null };
  const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(userId, target.agentId));
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return { targetKind: AUTOMATION_TARGET.SAME_AGENT, targetAgentId: agent.value.id };
});

const checkedScope = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  organizationId: string,
  scope: AutomationScope,
): Effect.fn.Return<AutomationScope, HostedRefusal, DatabaseServices> {
  if (scope === AUTOMATION_SCOPE.PERSONAL) return scope;
  const personal = yield* hostedStoreOrUnavailable(personalWorkspaceOf(userId));
  if (Option.isSome(personal) && personal.value === organizationId) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return scope;
});

function checkTriggerRepositories(
  trigger: AutomationTrigger,
  repositories: readonly string[],
): Effect.Effect<void, HostedRefusal> {
  return trigger.kind === AUTOMATION_TRIGGER.GITHUB && repositories.length === 0
    ? Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY)
    : Effect.void;
}

const reachedRepositories = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  repositories: readonly string[],
): Effect.fn.Return<
  readonly string[],
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const reached = yield* Effect.forEach(repositories, (repository) =>
    workspaceRepository(organizationId, repository, undefined),
  );
  return reached.map((one) => one.repository.fullName);
});

interface Standing {
  readonly organizationId: string;
  readonly repositories: readonly string[];
}

const standingOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  made: typeof automationCreateRequestSchema.Type,
): Effect.fn.Return<Standing, HostedRefusal, DatabaseServices | GitHubApp | HttpClient.HttpClient> {
  if (made.planId !== undefined || made.workspaceId === undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, made.workspaceId));
  if (made.repositories === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const repositories = yield* reachedRepositories(made.workspaceId, made.repositories);
  return { organizationId: made.workspaceId, repositories };
});

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
  const newTrigger =
    asked.trigger?.kind === AUTOMATION_TRIGGER.WEBHOOK &&
    standing.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK
      ? undefined
      : asked.trigger;
  const trigger = newTrigger ?? standing.trigger;
  const enabled = asked.enabled ?? standing.enabled;
  const due = yield* firstDue(trigger, now);
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
  if (asked.webhookSecretHash !== undefined && trigger.kind !== AUTOMATION_TRIGGER.WEBHOOK) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const webhook =
    becameWebhook && asked.webhookSecretHash === undefined ? mintWebhookSecret() : undefined;
  const secretHash = asked.webhookSecretHash ?? webhook?.hash;
  const scope =
    asked.scope === undefined
      ? undefined
      : yield* checkedScope(userId, standing.organizationId, asked.scope);
  const target =
    asked.target === undefined ? undefined : yield* checkedTarget(userId, asked.target);
  yield* checkTriggerRepositories(trigger, asked.repositories ?? standing.repositories);
  const repositories =
    asked.repositories === undefined
      ? undefined
      : yield* reachedRepositories(standing.organizationId, asked.repositories);
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
    ...(asked.slackDelivery === undefined ? undefined : { slackDelivery: asked.slackDelivery }),
  };
  return { changes, webhookSecret: webhook?.secret };
});

export interface AutomationWritten {
  readonly automation: AutomationSummary;
  readonly webhookSecret: string | undefined;
  readonly txid: string | undefined;
}

export const createAutomationAs = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  made: typeof automationCreateRequestSchema.Type,
  source: (typeof SERVER_AUTOMATION_SOURCE)[keyof typeof SERVER_AUTOMATION_SOURCE],
): Effect.fn.Return<
  AutomationWritten,
  HostedRefusal,
  DatabaseServices | ModelCatalog | GitHubApp | HttpClient.HttpClient
> {
  const now = yield* Clock.currentTimeMillis;
  const nextRunAt = yield* firstDue(made.trigger, now);
  const action = yield* checkedAction(userId, made.action);
  const standing = yield* standingOf(userId, made);
  yield* checkTriggerRepositories(made.trigger, standing.repositories);
  const scope = yield* checkedScope(
    userId,
    standing.organizationId,
    made.scope ?? AUTOMATION_SCOPE.PERSONAL,
  );
  const target = yield* checkedTarget(userId, made.target ?? { kind: AUTOMATION_TARGET.NEW_AGENT });
  const webhook =
    made.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK ? mintWebhookSecret() : undefined;
  const { id } = made;
  const created = yield* hostedStoreOrUnavailable(
    createAutomationCommitted(userId, {
      ...(id === undefined ? undefined : { id }),
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
      slackDelivery: made.slackDelivery ?? false,
    }),
  );
  if (Option.isNone(created)) {
    const standing =
      id === undefined
        ? Option.none()
        : yield* hostedStoreOrUnavailable(readAutomation(userId, id));
    if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return {
      automation: yield* summaryOf(userId, standing.value),
      webhookSecret: undefined,
      txid: undefined,
    };
  }
  yield* recordServerEvent(
    SERVER_EVENT.AUTOMATION_CREATE,
    { userId, workspaceId: standing.organizationId },
    {
      trigger_kind: made.trigger.kind,
      source,
    },
  );
  return {
    automation: yield* summaryOf(userId, created.value.automation),
    webhookSecret: webhook?.secret,
    txid: created.value.txid,
  };
});

export const changeAutomationAs = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  standing: Automation,
  asked: typeof automationChangeRequestSchema.Type,
  source: (typeof SERVER_AUTOMATION_SOURCE)[keyof typeof SERVER_AUTOMATION_SOURCE],
): Effect.fn.Return<
  AutomationWritten,
  HostedRefusal,
  DatabaseServices | ModelCatalog | GitHubApp | HttpClient.HttpClient
> {
  const { changes, webhookSecret } = yield* changesOf(userId, standing, asked);
  const access = Object.keys(asked).every((field) => field === "enabled")
    ? AUTOMATION_ACCESS.TOGGLE
    : AUTOMATION_ACCESS.CHANGE;
  const written = yield* hostedStoreOrUnavailable(
    updateAutomationCommitted(userId, standing.id, changes, access),
  );
  if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* recordServerEvent(
    SERVER_EVENT.AUTOMATION_CHANGE,
    { userId, workspaceId: standing.organizationId },
    { action: SERVER_AUTOMATION_CHANGE_ACTION.EDIT, source },
  );
  return {
    automation: yield* summaryOf(userId, written.value.automation),
    webhookSecret,
    txid: written.value.txid,
  };
});

export const removeAutomationAs = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  standing: Automation,
  source: (typeof SERVER_AUTOMATION_SOURCE)[keyof typeof SERVER_AUTOMATION_SOURCE],
): Effect.fn.Return<string, HostedRefusal, DatabaseServices> {
  const deleted = yield* hostedStoreOrUnavailable(deleteAutomationCommitted(userId, standing.id));
  if (Option.isNone(deleted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* recordServerEvent(
    SERVER_EVENT.AUTOMATION_CHANGE,
    { userId, workspaceId: standing.organizationId },
    { action: SERVER_AUTOMATION_CHANGE_ACTION.DELETE, source },
  );
  return deleted.value.txid;
});

export interface AutomationRanNow {
  readonly run: AutomationRunSummary;
  readonly made: boolean;
  readonly txid: string | undefined;
}

export const runAutomationNowAs = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  automation: Automation,
  key: string,
  sessionsFor: SessionsForAccount,
): Effect.fn.Return<
  AutomationRanNow,
  HostedRefusal,
  DatabaseServices | ModelCatalog | GitHubApp | HttpClient.HttpClient
> {
  const firedAt = yield* DateTime.nowAsDate;
  const recorded = yield* hostedStoreOrUnavailable(
    recordAutomationRun(automation, {
      dedupeKey: key,
      firing: { kind: AUTOMATION_FIRING.MANUAL, userId },
      firedAt,
    }),
  );
  if (Option.isSome(recorded)) yield* executeAutomationRun(sessionsFor, recorded.value);
  const run = yield* hostedStoreOrUnavailable(automationRunByKey(userId, automation.id, key));
  if (Option.isNone(run)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const [summary] = yield* runSummaries(userId, [run.value]);
  if (summary === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return {
    run: summary,
    made: Option.isSome(recorded),
    txid: Option.isSome(recorded) ? recorded.value.txid : undefined,
  };
});
