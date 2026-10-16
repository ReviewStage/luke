import { createHash, randomBytes } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  AUTOMATION_ACCESS,
  type Automation,
  type AutomationChanges,
  type AutomationRunInHistory,
  automationRunByKey,
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  readAutomation,
  recordAutomationRun,
  updateAutomation,
} from "@luke/database/models/automation-store";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { readTask } from "@luke/database/models/task-store";
import { isWorkspaceMember, personalWorkspaceOf } from "@luke/database/models/workspace-store";
import { wireUuidSchema } from "@luke/features";
import { nextScheduledRun, readSchedule } from "@luke/features/automation-schedule";
import {
  AUTOMATION_BOUNDS,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_LIST_QUERY,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationAction,
  type AutomationRunSummary,
  type AutomationScope,
  type AutomationSummary,
  type AutomationTarget,
  type AutomationTrigger,
  automationChangeRequestSchema,
  automationCreateRequestSchema,
  automationRunRequestSchema,
} from "@luke/features/automation-wire";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import type * as HttpClient from "effect/http/HttpClient";
import { acceptedAgentChoice } from "../agents/coder-host/start.js";
import {
  type AgentTurnStanding,
  codingAgentFailureOf,
  codingAgentStatusOf,
} from "../agents/coder-host/status.js";
import { type EveReach, eveFor, standingsOf } from "../agents/coder-host/stop.js";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { executeAutomationRun } from "./automation-runs.js";

/**
 * automations-app.ts -- the account's automations: list and make them, change and delete one, run one now, and read its runs.
 *
 * Every request resolves the bearer before it touches a row, and the store
 * gates every row on the account owning the automation and still reaching
 * its plan (`automation-store.ts`), so an automation of another account, or
 * on a plan of a workspace the account left, answers as not found. What is
 * written is checked as a Start checks it: a schedule must read (five-field
 * cron in a known zone, no more often than every fifteen minutes, which the
 * desktop checks with the same module before it sends), a model choice must
 * be one the catalog offers the account, and the plan must name a
 * repository. A schedule's next due instant is computed here whenever the
 * automation is made, resumed, or given a new trigger, and cleared while it
 * is paused. A webhook trigger's secret is minted here, kept only as its
 * SHA-256, and answered once, on the write that made it.
 *
 * "Run now" records a manual firing under the client's key and acts on it
 * at once, through the same guards and the same start a scheduled run
 * takes (`automations/automation-runs.ts`), reaching eve as the developer under
 * the request's own bearer; the same key again answers the run it made. A
 * run's agent is summarized with its status as the agent's tab reads it.
 */

const PATH = {
  /** GET lists the account's automations, one plan's where `planId` names it; POST makes one. */
  AUTOMATIONS: "/api/automations",
  /** GET reads one, PATCH changes it, DELETE deletes it; the rewrite moves the path's id into the `id` query. */
  AUTOMATION: "/api/automations/automation",
  /** POST runs it now; the rewrite moves the path's id into the `id` query. */
  RUN: "/api/automations/run",
  /** GET reads its runs; the rewrite moves the path's id into the `id` query. */
  RUNS: "/api/automations/runs",
} as const;

const HTTP_METHOD = { GET: "GET", POST: "POST", PATCH: "PATCH", DELETE: "DELETE" } as const;

const QUERY = { ID: "id" } as const;

/**
 * A body past this is no automation: the prompt's bound at six bytes a
 * character, which is the most JSON spends on one (`\u0000`), and the rest of
 * the frame with room, so every prompt the schema takes fits.
 */
const MAXIMUM_BODY_BYTES = AUTOMATION_BOUNDS.MAX_PROMPT_CHARS * 6 + 16_384;

/** How many runs a history read answers. */
const RUNS_READ = 50;

/** The bytes of randomness in a webhook trigger's secret. */
const WEBHOOK_SECRET_BYTES = 32;

export interface AutomationsAppSeams extends EveReach {
  resolveUserId: UserIdResolver;
}

/** What the routes may require of the function that stands them. */
export type AutomationsAppServices =
  | DatabaseServices
  | GitHubApp
  | HttpClient.HttpClient
  | ModelCatalog;

type RouteServices = AutomationsAppServices | HttpServerRequest.HttpServerRequest;

/** The bearer's account, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AutomationsAppSeams,
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** The one id the path put under `id`; two is refused, and one that is no UUID names no row. */
const idOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const ids = new URL(request.url).searchParams.getAll(QUERY.ID);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

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
    lineAwaits: standing.lineAwaits,
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
const runSummaries = /* @__PURE__ */ Effect.fnUntraced(function* (
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
const summaryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
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

/** GET: the account's automations, or one plan's, or one workspace's. */
const listEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  request: Request,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, RouteServices> {
  const query = new URL(request.url).searchParams;
  const tasks = query.getAll(AUTOMATION_LIST_QUERY.TASK_ID);
  const workspaces = query.getAll(AUTOMATION_LIST_QUERY.WORKSPACE_ID);
  if (tasks.length > 1 || workspaces.length > 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const [named] = tasks;
  const [organizationId] = workspaces;
  const task = named === undefined ? undefined : readEither(wireUuidSchema)(unparsedWire(named));
  if ((task !== undefined && Result.isFailure(task)) || organizationId === "") {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const automations = yield* hostedStoreOrUnavailable(
    listAutomations(userId, { taskId: task?.success, organizationId }),
  );
  const summaries = yield* Effect.forEach(automations, (each) => summaryOf(userId, each));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { automations: summaries });
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
  const reached = yield* Effect.forEach(repositories, (repository) =>
    workspaceRepository(organizationId, repository),
  );
  return reached.map((repository) => repository.fullName);
});

/** Where a new automation stands: its plan, as the plan names its workspace and repository, or a workspace and the repositories named, each reached through it. */
interface Standing {
  readonly taskId: string | null;
  readonly organizationId: string;
  readonly repositories: readonly string[] | undefined;
}

/**
 * Where the request puts a new automation, read as the account: on a plan
 * that names a repository, or on a workspace the account is a member of with
 * repositories its installation reaches; a request naming both, or neither,
 * or a workspace with no repositories, is refused as no request at all.
 */
const standingOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  made: typeof automationCreateRequestSchema.Type,
): Effect.fn.Return<Standing, HostedRefusal, RouteServices> {
  if (made.planId !== undefined) {
    if (made.workspaceId !== undefined || made.repositories !== undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }
    const task = yield* hostedStoreOrUnavailable(readTask(userId, made.planId));
    if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    if (task.value.task.repository === null) {
      return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
    }
    return {
      taskId: made.planId,
      organizationId: task.value.task.workspaceId,
      repositories: undefined,
    };
  }
  if (made.workspaceId === undefined || made.repositories === undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, made.workspaceId));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const repositories = yield* reachedRepositories(made.workspaceId, made.repositories);
  return { taskId: null, organizationId: made.workspaceId, repositories };
});

/** POST: an automation made on one of the account's plans with a repository, or on a workspace of the account's with the repositories its runs work in. */
const createEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, RouteServices> {
  const asked = readEither(automationCreateRequestSchema)(
    yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES),
  );
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const made = asked.success;
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
    createAutomation(userId, {
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
  const automation = yield* summaryOf(userId, created.value);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, {
    automation,
    ...(webhook === undefined ? undefined : { webhookSecret: webhook.secret }),
  });
});

/** The automations list path: GET lists, POST makes. */
const automationsEndpoint = /* @__PURE__ */ Effect.fn("web/automationsEndpoint")(function* (
  seams: AutomationsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, RouteServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const userId = yield* resolvedUserId(seams, request);
  return incoming.method === HTTP_METHOD.GET
    ? yield* listEndpoint(userId, request)
    : yield* createEndpoint(userId);
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
  // Note that new repositories are read through the automation's own workspace, as its runs will
  // reach them, and that one standing on a plan takes its plan's repository and no other.
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

/** The one automation path: GET reads it, PATCH changes it, DELETE deletes it. */
const automationEndpoint = /* @__PURE__ */ Effect.fn("web/automationEndpoint")(function* (
  seams: AutomationsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, RouteServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (
    incoming.method !== HTTP_METHOD.GET &&
    incoming.method !== HTTP_METHOD.PATCH &&
    incoming.method !== HTTP_METHOD.DELETE
  ) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const userId = yield* resolvedUserId(seams, request);
  const id = yield* idOf(request);
  const standing = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
  if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (incoming.method === HTTP_METHOD.DELETE) {
    const deleted = yield* hostedStoreOrUnavailable(deleteAutomation(userId, id));
    // One the account reads but may not delete is refused as not permitted, not as gone.
    if (!deleted) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {});
  }
  if (incoming.method === HTTP_METHOD.GET) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      automation: yield* summaryOf(userId, standing.value),
    });
  }
  const asked = readEither(automationChangeRequestSchema)(
    yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES),
  );
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { changes, webhookSecret } = yield* changesOf(userId, standing.value, asked.success);
  // Turning it on or off alone is the toggle, which more of the workspace may do than change it.
  const access = Object.keys(asked.success).every((field) => field === "enabled")
    ? AUTOMATION_ACCESS.TOGGLE
    : AUTOMATION_ACCESS.CHANGE;
  const written = yield* hostedStoreOrUnavailable(updateAutomation(userId, id, changes, access));
  if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    automation: yield* summaryOf(userId, written.value),
    ...(webhookSecret === undefined ? undefined : { webhookSecret }),
  });
});

/** POST: run the automation now, under the client's key, and answer the run as it came out. */
const runEndpoint = /* @__PURE__ */ Effect.fn("web/automationRunEndpoint")(function* (
  seams: AutomationsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, RouteServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const userId = yield* resolvedUserId(seams, request);
  const id = yield* idOf(request);
  const asked = readEither(automationRunRequestSchema)(
    yield* readJsonBodyEffect(AUTOMATION_BOUNDS.MAX_KEY_CHARS * 4 + 64),
  );
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const key = asked.success.idempotencyKey;
  const automation = yield* hostedStoreOrUnavailable(
    readAutomation(userId, id, AUTOMATION_ACCESS.RUN),
  );
  if (Option.isNone(automation)) {
    const readable = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
    return yield* Effect.fail(
      Option.isSome(readable) ? HOSTED_REFUSAL.NOT_PERMITTED : HOSTED_REFUSAL.NOT_FOUND,
    );
  }
  const firedAt = new Date(yield* Clock.currentTimeMillis);
  const recorded = yield* hostedStoreOrUnavailable(
    recordAutomationRun(automation.value, {
      dedupeKey: key,
      firing: { kind: AUTOMATION_FIRING.MANUAL, userId },
      firedAt,
    }),
  );
  if (Option.isSome(recorded)) {
    yield* executeAutomationRun(() => eveFor(seams, request), recorded.value);
  }
  const run = yield* hostedStoreOrUnavailable(automationRunByKey(userId, id, key));
  if (Option.isNone(run)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const [summary] = yield* runSummaries(userId, [run.value]);
  return hostedJsonResponse(
    Option.isSome(recorded) ? HOSTED_HTTP_STATUS.CREATED : HOSTED_HTTP_STATUS.OK,
    { run: summary },
  );
});

/** GET: the automation's runs, newest first. */
const runsEndpoint = /* @__PURE__ */ Effect.fn("web/automationRunsEndpoint")(function* (
  seams: AutomationsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, RouteServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const userId = yield* resolvedUserId(seams, request);
  const id = yield* idOf(request);
  const automation = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
  if (Option.isNone(automation)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const runs = yield* hostedStoreOrUnavailable(listAutomationRuns(userId, id, RUNS_READ));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { runs: yield* runSummaries(userId, runs) });
});

/** The group: the four automation paths, and the hosted vocabulary's own refusal for any other. */
export function automationsApp(seams: AutomationsAppSeams): WebRoutes<AutomationsAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PATH.AUTOMATIONS, hostedRefusing(automationsEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PATH.AUTOMATION, hostedRefusing(automationEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PATH.RUN, hostedRefusing(runEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PATH.RUNS, hostedRefusing(runsEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
