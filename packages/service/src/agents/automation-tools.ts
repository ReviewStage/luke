import type { DatabaseServices } from "@luke/database/core/query";
import { INTEGRATION_INSTALLATION_STATUS } from "@luke/database/integration-vocabulary";
import {
  AUTOMATION_ACCESS,
  listAutomationRuns,
  listAutomations,
  readAutomation,
} from "@luke/database/models/automation-store";
import { workspaceIntegrationInstallations } from "@luke/database/models/integration-installation-store";
import { readSchedule, SCHEDULE_REFUSAL } from "@luke/features/automation-schedule";
import {
  AUTOMATION_ACTION,
  AUTOMATION_BOUNDS,
  AUTOMATION_DEFAULT_SUBJECT_COOLDOWN_HOURS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationAction,
  type AutomationRunSummary,
  type AutomationSummary,
  type AutomationTarget,
  automationActionSchema,
  automationCreateRequestSchema,
  automationGuardsSchema,
  automationScopeSchema,
  githubTriggerSchema,
  scheduleTriggerSchema,
  sentryTriggerSchema,
} from "@luke/features/automation-wire";
import { disabledServersSchema } from "@luke/features/coding-agent-wire";
import { integrationConnectionOf } from "@luke/features/integration-wire";
import { type ModelChoice, modelChoiceSchema } from "@luke/features/models-wire";
import { TRIGGER_PROVIDER } from "@luke/features/trigger-catalog";
import { isRecord } from "@luke/wire";
import { describeWire } from "@luke/wire/effect";
import { Clock, Effect, Option, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  changeAutomationAs,
  createAutomationAs,
  removeAutomationAs,
  runAutomationNowAs,
  runSummaries,
  summaryOf,
} from "../automations/automation-writes.js";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../http/http-effect.js";
import type { StoreFailure } from "../http/store-failure.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { SentryApp } from "../triggers/sentry/sentry-app-config.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { calledId } from "./called-id.js";
import { acceptedAgentChoice } from "./coder-host/start.js";
import {
  agentToolRejected,
  CODING_AGENT_TOOL_REFUSAL,
  type CodingAgentCall,
  callerUserId,
  callerWorkspace,
  choiceRefusal,
  orStoreRefusal,
  workedRepository,
} from "./coding-agent-tools.js";
import { workspaceAgent } from "./workspace-agents.js";

/**
 * automation-tools.ts -- the tools a coding agent keeps its workspace's automations by: list them, make one, change one, and delete one.
 *
 * Each call acts as the member the agent acts for (its starter), on the
 * automations of the agent's own workspace, under the same rules the
 * automations page writes by (`../automations/automation-writes.ts`): the
 * same checks of a schedule, a model, and the repositories the workspace's
 * installation reaches, and the same access, so a personal automation is
 * its creator's to change and a workspace's its creator's, owners', and
 * admins'. A run starts as the automation's creator, so an automation an
 * agent makes runs as the member who started that agent. A webhook trigger
 * is never made or set here: its secret is shown once, in the window that
 * minted it (`AGENTS.md`), and no agent's answer may carry it. A Sentry
 * trigger is refused where this deployment configures no Sentry integration
 * or the workspace installed none, since nothing would ever fire it. An automation
 * is made under an id drawn from eve's key for the call (`called-id.ts`),
 * so a call eve runs again names the one it made. Every answer is data the
 * model reads, never a credential.
 */

/** How many runs one automation's read answers, the newest first. */
const RUNS_READ = 10;

/** The most characters of a prompt the list shows of each automation; a read by its id shows it whole. */
const LISTED_PROMPT_CHARS = 300;

/** Why a call changed nothing, in words the model can act on. */
export const AUTOMATION_TOOL_REFUSAL = {
  UNREADABLE_CREATE:
    `Not made: give a name of at most ${AUTOMATION_BOUNDS.MAX_NAME_CHARS} characters, a prompt ` +
    `of at most ${AUTOMATION_BOUNDS.MAX_PROMPT_CHARS}, and a trigger: a schedule as ` +
    '{"kind":"schedule","cron":"<five-field cron>","timezone":"<IANA zone>"}, a GitHub event ' +
    'as {"kind":"github","event":"<event>"}, or a Sentry event as ' +
    '{"kind":"integration","provider":"sentry","event":"alert-triggered"}; and a model with its ' +
    "effort, both or neither.",
  UNREADABLE_UPDATE:
    `Not run: name the automation by the id ${AGENT_TOOL.LIST_AUTOMATIONS} answered, and at ` +
    "least one change, a model with its effort, both or neither.",
  UNREADABLE_ID: `Not run: name the automation by the id ${AGENT_TOOL.LIST_AUTOMATIONS} answered.`,
  NO_AUTOMATION:
    "Not run: no automation of your workspace that the developer you work for may read has that " +
    `id; ${AGENT_TOOL.LIST_AUTOMATIONS} names them.`,
  NOT_PERMITTED:
    "Not run: the developer you work for may read that automation but not change or delete it. " +
    "A personal automation is its creator's alone, and a workspace's its creator's, owners', and " +
    "admins'; only its toggle is open to more of the workspace.",
  NO_REPOSITORY:
    "Not made: name the repositories its runs work in, as owner/name, the first where each run " +
    "starts; you work in none to take as its own.",
  NOT_REACHABLE:
    "Not run: the GitHub installation connected to the workspace does not reach one of those " +
    "repositories; name ones it reaches.",
  GITHUB_UNANSWERED:
    "Not run: GitHub did not answer whether the workspace reaches those repositories. The call " +
    "may be made again.",
  CRON: "Not run: the schedule's cron is not five-field cron, such as 0 9 * * 1 for nine on Mondays.",
  TIMEZONE:
    "Not run: the schedule's time zone is not one the IANA database names, such as Europe/London.",
  TOO_FREQUENT: "Not run: a schedule may fire at most once every fifteen minutes.",
  SENTRY_UNCONFIGURED:
    "Not run: this deployment of Luke has no Sentry integration configured, so no automation " +
    "here may fire on Sentry's events; use a schedule or a GitHub event instead.",
  SENTRY_NOT_INSTALLED:
    "Not run: the workspace has not installed Luke's Sentry integration, so no Sentry event " +
    "would fire it. A workspace owner or admin installs it in Workspace settings › " +
    "Integrations › Sentry; make it once that is done.",
  NO_AGENT:
    "Not run: no coding agent of your workspace has that agentId to hand each run to; " +
    `${AGENT_TOOL.LIST_AGENTS} names them, or leave agentId out for a new agent each run.`,
  WORKSPACE_SCOPE:
    "Not run: this is the developer's personal workspace, where every automation is theirs " +
    "alone; leave scope out or name personal.",
  INVALID:
    "Not run: Luke does not take the automation as asked. Check the trigger, the repositories, " +
    "the scope, and the agentId, and that the guards are whole numbers within their bounds.",
  UNKNOWN_SERVERS:
    "Not run: name each connection in disabledServers as your connections are named in your " +
    "instructions, such as neon, sentry, or notion-2 for a second Notion account; these name none:",
  NOT_RUNNABLE:
    "Not run: the developer you work for may read that automation but not run it. A personal " +
    "automation is its creator's to run, and a workspace's every member's.",
  NO_SERVICE: "Not run: this deployment cannot reach the coding agents' service.",
  UNAVAILABLE:
    "Not run: the automations could not be written just now. The call may be made again.",
} as const;

const AUTOMATION_ID = describeWire(
  wireUuidSchema,
  `The automation's id, as ${AGENT_TOOL.LIST_AUTOMATIONS} or ${AGENT_TOOL.CREATE_AUTOMATION} answered it.`,
);

const NAME = describeWire(
  automationCreateRequestSchema.fields.name,
  `Its name, as the automations page lists it, at most ${AUTOMATION_BOUNDS.MAX_NAME_CHARS} characters.`,
);

const PROMPT = describeWire(
  automationActionSchema.fields.prompt,
  "What each run's new coding agent is told to do, as its first message, at most " +
    `${AUTOMATION_BOUNDS.MAX_PROMPT_CHARS} characters: whole and standing alone, since no one ` +
    "watches a run and it remembers no run before it. Luke adds a line beneath it saying what " +
    "fired the run.",
);

const TRIGGER = describeWire(
  Schema.Union([scheduleTriggerSchema, githubTriggerSchema, sentryTriggerSchema]),
  "What fires it: a schedule, five-field cron read in an IANA time zone, at most once every " +
    'fifteen minutes, such as {"kind":"schedule","cron":"0 9 * * 1","timezone":"Europe/London"}; ' +
    "an event of its repositories the Luke GitHub App hears, such as " +
    '{"kind":"github","event":"pull-request-opened"}, narrowed by labels, branches, senders ' +
    "(people alone where left out), moments, drafts, and forks; or an event of the Sentry " +
    "organization that installed Luke's Sentry integration on the workspace (Workspace settings " +
    '› Integrations › Sentry), such as {"kind":"integration","provider":"sentry",' +
    '"event":"alert-triggered","filters":{"project":["web"],"level":["error","fatal"]}}. ' +
    "alert-triggered, the one to prefer, fires when a Sentry issue alert rule whose action is " +
    '"Send a notification via Luke" fires; issue-created fires on every new issue in that ' +
    "organization. Its filters keep it to the projects (by slug), environments, and levels " +
    "named: any value within a field matches, every field named must, case aside. A webhook is " +
    "made only on the automations page, which shows its secret once.",
);

const REPOSITORIES = describeWire(
  automationCreateRequestSchema.fields.repositories.schema,
  "The repositories its runs work in, as owner/name, the first where each run starts; each " +
    "must be one the workspace's GitHub installation reaches.",
);

const MODEL = describeWire(
  modelChoiceSchema.fields.model,
  `The model each run's agent runs on, by its catalog id as ${AGENT_TOOL.LIST_MODELS} lists it; ` +
    "given with the effort or not at all, and the creator's default as each run starts where " +
    "left out.",
);

const EFFORT = describeWire(
  modelChoiceSchema.fields.effort,
  "The reasoning effort, as the model lists it; given with the model or not at all.",
);

const SERVERS = describeWire(
  disabledServersSchema,
  "The connections (MCP servers) each run's agent is not handed, the whole list, each by its " +
    "connection name as your instructions list your connections (neon, sentry, notion-2); every " +
    "connection of the creator's is handed where none are named, and a name that is no " +
    "connection's is refused. A connection the prompt names with an @ is handed even where it is " +
    "listed here.",
);

const GUARDS = describeWire(
  automationGuardsSchema,
  "How far it may go: maxConcurrentRuns, its agents at work at once (1 to " +
    `${AUTOMATION_BOUNDS.MAX_CONCURRENT_RUNS}), past which a firing is skipped, and dailyRunCap, ` +
    `the runs it may start in a day (1 to ${AUTOMATION_BOUNDS.MAX_DAILY_RUNS}); 1 and 10 where ` +
    "left out. A Sentry trigger also takes subjectCooldownHours, the hours before the same " +
    `Sentry issue may start another run (1 to ${AUTOMATION_BOUNDS.MAX_SUBJECT_COOLDOWN_HOURS}), ` +
    `${AUTOMATION_DEFAULT_SUBJECT_COOLDOWN_HOURS} where left out.`,
);

const SCOPE = describeWire(
  automationScopeSchema,
  "Whose it is: personal, its creator's alone, which the workspace's owners and admins see and " +
    "pause; or workspace, which every member sees, runs, and pauses. personal where left out.",
);

const ARCHIVE_SUCCESSFUL = describeWire(
  Schema.Boolean,
  "Whether each run's agent is archived once it finishes without failing and leaves no thread " +
    "open; false where left out.",
);

const AGENT_ID = describeWire(
  wireUuidSchema,
  "An agent of your workspace to hand every run to as a message, by the id " +
    `${AGENT_TOOL.LIST_AGENTS} answered, so each run remembers the ones before; left out, each ` +
    "run starts a new agent.",
);

const LIST_AUTOMATIONS_INPUT = Schema.Struct({
  automationId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      "One automation to read whole, its prompt in full and its newest runs, by the id this " +
        "tool answered; leave it out to list them all.",
    ),
  ),
});

const CREATE_AUTOMATION_INPUT = Schema.Struct({
  name: NAME,
  prompt: PROMPT,
  trigger: TRIGGER,
  repositories: Schema.optionalKey(
    describeWire(
      automationCreateRequestSchema.fields.repositories.schema,
      "The repositories its runs work in, as owner/name, the first where each run starts; each " +
        "must be one the workspace's GitHub installation reaches. The one you work in where left out.",
    ),
  ),
  model: Schema.optionalKey(MODEL),
  effort: Schema.optionalKey(EFFORT),
  disabledServers: Schema.optionalKey(SERVERS),
  agentId: Schema.optionalKey(AGENT_ID),
  guards: Schema.optionalKey(GUARDS),
  scope: Schema.optionalKey(SCOPE),
  archiveSuccessful: Schema.optionalKey(ARCHIVE_SUCCESSFUL),
});

const UPDATE_AUTOMATION_INPUT = Schema.Struct({
  automationId: AUTOMATION_ID,
  name: Schema.optionalKey(NAME),
  enabled: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "false to pause it, so nothing fires it, and true to resume it; a schedule resumed is " +
        "next due from now, with nothing missed run late.",
    ),
  ),
  prompt: Schema.optionalKey(PROMPT),
  trigger: Schema.optionalKey(TRIGGER),
  repositories: Schema.optionalKey(REPOSITORIES),
  model: Schema.optionalKey(MODEL),
  effort: Schema.optionalKey(EFFORT),
  disabledServers: Schema.optionalKey(SERVERS),
  agentId: Schema.optionalKey(
    describeWire(
      Schema.NullOr(wireUuidSchema),
      `An agent of your workspace to hand every run to, by the id ${AGENT_TOOL.LIST_AGENTS} ` +
        "answered; null for a new agent each run.",
    ),
  ),
  guards: Schema.optionalKey(GUARDS),
  scope: Schema.optionalKey(SCOPE),
  archiveSuccessful: Schema.optionalKey(ARCHIVE_SUCCESSFUL),
});

const DELETE_AUTOMATION_INPUT = Schema.Struct({ automationId: AUTOMATION_ID });

const RUN_AUTOMATION_INPUT = Schema.Struct({ automationId: AUTOMATION_ID });

const readListAsked = Schema.decodeUnknownResult(LIST_AUTOMATIONS_INPUT);
const readCreateAsked = Schema.decodeUnknownResult(CREATE_AUTOMATION_INPUT);
const readUpdateAsked = Schema.decodeUnknownResult(UPDATE_AUTOMATION_INPUT);
const readDeleteAsked = Schema.decodeUnknownResult(DELETE_AUTOMATION_INPUT);
const readRunAsked = Schema.decodeUnknownResult(RUN_AUTOMATION_INPUT);

/** The tools as every coding agent is offered them: each its name, its words, and its input schema. */
export const LIST_AUTOMATIONS_TOOL = {
  name: AGENT_TOOL.LIST_AUTOMATIONS,
  description:
    "List the automations of your workspace that the developer you work for may read, newest " +
    "first: each with its id, name, whether it is on, its trigger, the start of its prompt, the " +
    "model and effort its runs take, its repositories, where its runs land, its guards, scope, " +
    "when it is next due, its newest run, and whether the developer made it. Name an " +
    "automationId to read that one whole, its prompt in full and its newest runs, each with why " +
    "it was skipped or failed and the agent it started. An automation fires on a schedule, a " +
    "GitHub event, a webhook, or a Sentry event, and starts a coding agent on its prompt, as " +
    "its creator. Answers `accepted` with them, or `rejected` and why.",
  inputSchema: LIST_AUTOMATIONS_INPUT,
} as const;

export const CREATE_AUTOMATION_TOOL = {
  name: AGENT_TOOL.CREATE_AUTOMATION,
  description:
    "Make an automation in your workspace for the developer you work for, as the automations " +
    "page would: each time its trigger fires, Luke starts a coding agent on its prompt, in its " +
    "repositories, on its creator's keys and connections, with no task and no one watching, or " +
    "hands the run to the one agent named. It is on as it is made, and runs as the developer. " +
    "One fired by Sentry needs Luke's Sentry integration installed on the workspace first. " +
    "Make one when the developer asks for it, never otherwise on your own, and read " +
    `${AGENT_TOOL.LIST_AUTOMATIONS} first so you make none they already have. Answers ` +
    "`accepted` with the automation as it stands, or `rejected` and why.",
  inputSchema: CREATE_AUTOMATION_INPUT,
} as const;

export const UPDATE_AUTOMATION_TOOL = {
  name: AGENT_TOOL.UPDATE_AUTOMATION,
  description:
    "Change an automation of your workspace, by its id as " +
    `${AGENT_TOOL.LIST_AUTOMATIONS} answered it, as its editor on the automations page would: ` +
    "pause or resume it, rename it, or give it a new prompt, trigger, repositories, model and " +
    "effort, switched-off connections, the agent its runs land on, guards, scope, or archiving; " +
    "what you leave out stands, and a trigger given replaces the one standing whole, a switch " +
    "to Sentry needing Luke's Sentry integration installed on the workspace. Change one only " +
    "where the developer asked for it. Answers `accepted` with the automation as it now " +
    "stands, or `rejected` and why.",
  inputSchema: UPDATE_AUTOMATION_INPUT,
} as const;

export const DELETE_AUTOMATION_TOOL = {
  name: AGENT_TOOL.DELETE_AUTOMATION,
  description:
    "Delete an automation of your workspace with its history of runs, by its id as " +
    `${AGENT_TOOL.LIST_AUTOMATIONS} answered it, as its Delete on the automations page would; ` +
    "the agents its runs started stay. Delete one only when the developer asks for it, and " +
    `pause one with ${AGENT_TOOL.UPDATE_AUTOMATION} where they only want it to stop. Answers ` +
    "`accepted` with the automation's id and name, or `rejected` and why.",
  inputSchema: DELETE_AUTOMATION_INPUT,
} as const;

export const RUN_AUTOMATION_TOOL = {
  name: AGENT_TOOL.RUN_AUTOMATION,
  description:
    `Run an automation of your workspace now, by its id as ${AGENT_TOOL.LIST_AUTOMATIONS} ` +
    "answered it, as its Run now on the automations page would: one run, whatever its trigger, " +
    "through the same guards a firing takes, starting its coding agent on its prompt as a " +
    "scheduled run would, or handing it to the one agent it names. Run one when the developer " +
    "asks for it, such as to try an automation just made, never otherwise on your own. Answers " +
    "`accepted` with the run, started with its agent or skipped or failed and why, or " +
    "`rejected` and why.",
  inputSchema: RUN_AUTOMATION_INPUT,
} as const;

/** What the automation tools reach: the store, the catalog a model is checked against, GitHub through the workspace's installation, and Luke's Sentry integration. */
type AutomationToolServices =
  | DatabaseServices
  | ModelCatalog
  | GitHubApp
  | HttpClient.HttpClient
  | SentryApp;

/** A refusal of the shared writes in the model's words. */
function refusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION;
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return AUTOMATION_TOOL_REFUSAL.NOT_PERMITTED;
    case HOSTED_API_ERROR.NO_REPOSITORY:
      return AUTOMATION_TOOL_REFUSAL.NO_REPOSITORY;
    case HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE:
      return AUTOMATION_TOOL_REFUSAL.NOT_REACHABLE;
    case HOSTED_API_ERROR.GITHUB_UNANSWERED:
      return AUTOMATION_TOOL_REFUSAL.GITHUB_UNANSWERED;
    case HOSTED_API_ERROR.INVALID_REQUEST:
      return AUTOMATION_TOOL_REFUSAL.INVALID;
    default:
      return AUTOMATION_TOOL_REFUSAL.UNAVAILABLE;
  }
}

/** The names a call's disabledServers holds that are no connection's, read off the input as sent, since the wire's own read drops them unsaid. */
function unknownServers(input: UnparsedWireValue): readonly string[] {
  const named = isRecord(input) ? input.disabledServers : undefined;
  if (!Array.isArray(named)) return [];
  return named.filter(
    (name): name is string =>
      typeof name === "string" && integrationConnectionOf(name) === undefined,
  );
}

/** A refusal of the servers named that are no connection's, or nothing where every one is. */
function serversRefused(input: UnparsedWireValue): WireRecord | undefined {
  const unknown = unknownServers(input);
  return unknown.length === 0
    ? undefined
    : agentToolRejected(`${AUTOMATION_TOOL_REFUSAL.UNKNOWN_SERVERS} ${unknown.join(", ")}.`);
}

/** An instant as the model reads it. */
function isoOf(at: number | null): string | null {
  return at === null ? null : new Date(at).toISOString();
}

/** One run as an answer names it: what fired it, where it stands and why, and the agent it started. */
function runReading(run: AutomationRunSummary): WireRecord {
  return {
    id: run.id,
    firedBy: run.firing.kind,
    firedAt: isoOf(run.firedAt),
    status: run.status,
    reason: run.reason,
    agent:
      run.agent === null
        ? null
        : {
            id: run.agent.id,
            title: run.agent.title,
            status: run.agent.status,
            ...(run.agent.failureReason === undefined
              ? undefined
              : { failureReason: run.agent.failureReason }),
          },
  };
}

/** Where an automation's runs land, as an answer names it. */
function landingOf(summary: AutomationSummary): WireRecord | string {
  const target = summary.target;
  if (target === undefined || target.kind === AUTOMATION_TARGET.NEW_AGENT) {
    return AUTOMATION_TARGET.NEW_AGENT;
  }
  return { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: target.agentId };
}

/** One automation as an answer names it, its prompt whole or cut to the list's length. */
function automationReading(summary: AutomationSummary, whole: boolean): WireRecord {
  const { prompt } = summary.action;
  const shown =
    whole || prompt.length <= LISTED_PROMPT_CHARS
      ? prompt
      : `${prompt.slice(0, LISTED_PROMPT_CHARS)}…`;
  return {
    id: summary.id,
    name: summary.name,
    enabled: summary.enabled,
    trigger: { ...summary.trigger },
    prompt: shown,
    promptChars: prompt.length,
    model: summary.action.choice?.model ?? null,
    effort: summary.action.choice?.effort ?? null,
    disabledServers: [...(summary.action.disabledServers ?? [])],
    repositories: [...(summary.repositories ?? [])],
    runsLandOn: landingOf(summary),
    guards: { ...summary.guards },
    scope: summary.scope ?? AUTOMATION_SCOPE.PERSONAL,
    archiveSuccessful: summary.archiveSuccessful ?? false,
    nextRunAt: isoOf(summary.nextRunAt),
    lastRun: summary.lastRun === null ? null : runReading(summary.lastRun),
    madeByYourDeveloper: summary.mine ?? false,
  };
}

/** The schedule's refusal in the model's words, where the trigger is a schedule that does not read. */
const scheduleRefused = (
  trigger: { readonly kind: string } & Partial<{ cron: string; timezone: string }>,
) =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    if (trigger.kind !== AUTOMATION_TRIGGER.SCHEDULE) return undefined;
    const read = readSchedule(
      { cron: trigger.cron ?? "", timezone: trigger.timezone ?? "" },
      new Date(now),
    );
    if (Result.isSuccess(read)) return undefined;
    switch (read.failure) {
      case SCHEDULE_REFUSAL.TIMEZONE:
        return AUTOMATION_TOOL_REFUSAL.TIMEZONE;
      case SCHEDULE_REFUSAL.TOO_FREQUENT:
        return AUTOMATION_TOOL_REFUSAL.TOO_FREQUENT;
      default:
        return AUTOMATION_TOOL_REFUSAL.CRON;
    }
  });

/** Sentry's refusal in the model's words, where the trigger is Sentry's and this deployment configures no Sentry integration or the workspace installed none. */
const sentryRefused = Effect.fn("agents/automationSentryRefused")(function* (
  workspaceId: string,
  trigger: { readonly kind: string },
) {
  if (trigger.kind !== AUTOMATION_TRIGGER.INTEGRATION) return undefined;
  const app = yield* SentryApp;
  const configured = yield* Effect.result(app.settings);
  if (Result.isFailure(configured)) return AUTOMATION_TOOL_REFUSAL.SENTRY_UNCONFIGURED;
  const installations = yield* workspaceIntegrationInstallations(workspaceId);
  const installed = installations.some(
    (row) =>
      row.provider === TRIGGER_PROVIDER.SENTRY &&
      row.status === INTEGRATION_INSTALLATION_STATUS.ACTIVE,
  );
  return installed ? undefined : AUTOMATION_TOOL_REFUSAL.SENTRY_NOT_INSTALLED;
});

/** The model and effort named, both or neither; undefined for neither, and null where one came without the other. */
function namedChoice(asked: {
  readonly model?: string;
  readonly effort?: string;
}): ModelChoice | undefined | null {
  if (asked.model === undefined && asked.effort === undefined) return undefined;
  if (asked.model === undefined || asked.effort === undefined) return null;
  return { model: asked.model, effort: asked.effort };
}

/** The choice's refusal in the model's words, where the catalog offers the member no such model and effort. */
const choiceRefused = (
  userId: string,
  choice: ModelChoice | undefined,
  lead: string,
): Effect.Effect<string | undefined, never, DatabaseServices | ModelCatalog> =>
  choice === undefined
    ? Effect.succeed(undefined)
    : acceptedAgentChoice(userId, choice).pipe(
        Effect.as(undefined),
        Effect.catchTag("ModelChoiceRefused", (refused) =>
          Effect.succeed(choiceRefusal(choice, refused.offered, lead)),
        ),
        Effect.catch((refusal) => Effect.succeed(refusalWords(refusal))),
      );

/** Where runs land as the call names an agent, which must be one of the caller's workspace: none named leaves it as it stands. */
const landingNamed = (
  userId: string,
  workspaceId: string,
  agentId: string | null | undefined,
): Effect.Effect<
  Result.Result<AutomationTarget | undefined, string>,
  StoreFailure,
  DatabaseServices
> => {
  if (agentId === undefined) return Effect.succeed(Result.succeed(undefined));
  if (agentId === null)
    return Effect.succeed(Result.succeed({ kind: AUTOMATION_TARGET.NEW_AGENT }));
  return Effect.map(workspaceAgent(userId, workspaceId, agentId), (found) =>
    Option.isNone(found)
      ? Result.fail(AUTOMATION_TOOL_REFUSAL.NO_AGENT)
      : Result.succeed({ kind: AUTOMATION_TARGET.SAME_AGENT, agentId: found.value.id }),
  );
};

/** An automation of the caller's workspace that its member may read, or nothing: one of another workspace is none of the caller's. */
const workspaceAutomation = (userId: string, workspaceId: string, id: string) =>
  Effect.map(readAutomation(userId, id), (found) =>
    Option.filter(found, (automation) => automation.organizationId === workspaceId),
  );

/** One call of `list_automations`: the caller's workspace's automations its member may read, or one of them whole. */
export function runListAutomations(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AutomationToolServices> {
  const asked = readListAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_ID));
  }
  const { automationId } = asked.success;
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace))
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = callerUserId(call.caller);
      const found =
        automationId === undefined
          ? undefined
          : yield* workspaceAutomation(userId, workspace.value, automationId);
      if (found !== undefined && Option.isNone(found)) {
        return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION);
      }
      const read = yield* Effect.gen(function* () {
        if (found === undefined || automationId === undefined) {
          const listed = yield* hostedStoreOrUnavailable(
            listAutomations(userId, { organizationId: workspace.value }),
          );
          const summaries = yield* Effect.forEach(listed, (each) => summaryOf(userId, each));
          return {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            automations: summaries.map((summary) => automationReading(summary, false)),
          };
        }
        const summary = yield* summaryOf(userId, found.value);
        const runs = yield* hostedStoreOrUnavailable(
          listAutomationRuns(userId, automationId, RUNS_READ),
        );
        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          automation: automationReading(summary, true),
          runs: (yield* runSummaries(userId, runs)).map(runReading),
        };
      }).pipe(Effect.result);
      return Result.isSuccess(read) ? read.success : agentToolRejected(refusalWords(read.failure));
    }),
  );
}

/** One call of `create_automation`: an automation made for the caller's member in the caller's workspace, once under the call's key. */
export function runCreateAutomation(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AutomationToolServices> {
  const asked = readCreateAsked(input);
  const choice = Result.isSuccess(asked) ? namedChoice(asked.success) : null;
  if (Result.isFailure(asked) || choice === null) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_CREATE));
  }
  const made = asked.success;
  const servers = serversRefused(input);
  if (servers !== undefined) return Effect.succeed(servers);
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace))
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = callerUserId(call.caller);
      const id = calledId(userId, call.clientKey);
      // A call run again finds the automation it made first, as it was made.
      const already = yield* workspaceAutomation(userId, workspace.value, id);
      if (Option.isSome(already)) {
        const kept = yield* summaryOf(userId, already.value).pipe(Effect.result);
        return Result.isSuccess(kept)
          ? {
              status: ACTION_RESULT_STATUS.ACCEPTED,
              automation: automationReading(kept.success, false),
            }
          : agentToolRejected(refusalWords(kept.failure));
      }
      const schedule = yield* scheduleRefused(made.trigger);
      if (schedule !== undefined) return agentToolRejected(schedule);
      const sentry = yield* sentryRefused(workspace.value, made.trigger);
      if (sentry !== undefined) return agentToolRejected(sentry);
      const model = yield* choiceRefused(userId, choice, "Not made");
      if (model !== undefined) return agentToolRejected(model);
      const landing = yield* landingNamed(userId, workspace.value, made.agentId);
      if (Result.isFailure(landing)) return agentToolRejected(landing.failure);
      const worked = yield* workedRepository(call.caller);
      const repositories = made.repositories ?? (worked === null ? undefined : [worked]);
      const action: AutomationAction = {
        kind: AUTOMATION_ACTION.CODING_AGENT,
        prompt: made.prompt,
        ...(choice === undefined ? undefined : { choice }),
        ...(made.disabledServers === undefined
          ? undefined
          : { disabledServers: made.disabledServers }),
      };
      const written = yield* createAutomationAs(
        userId,
        {
          workspaceId: workspace.value,
          ...(repositories === undefined ? undefined : { repositories }),
          name: made.name,
          trigger: made.trigger,
          action,
          ...(made.guards === undefined ? undefined : { guards: made.guards }),
          ...(made.scope === undefined ? undefined : { scope: made.scope }),
          ...(landing.success === undefined ? undefined : { target: landing.success }),
          ...(made.archiveSuccessful === undefined
            ? undefined
            : { archiveSuccessful: made.archiveSuccessful }),
        },
        id,
      ).pipe(Effect.result);
      if (Result.isFailure(written)) {
        const refusal = written.failure;
        // Note that a workspace scope is refused alike in the personal workspace, which the model can act on.
        if (
          refusal.error === HOSTED_API_ERROR.INVALID_REQUEST &&
          made.scope === AUTOMATION_SCOPE.WORKSPACE
        ) {
          return agentToolRejected(AUTOMATION_TOOL_REFUSAL.WORKSPACE_SCOPE);
        }
        // Note that a create on a workspace with no repositories is refused as malformed, and is said as the repositories it lacks.
        if (refusal.error === HOSTED_API_ERROR.INVALID_REQUEST && repositories === undefined) {
          return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NO_REPOSITORY);
        }
        return agentToolRejected(refusalWords(refusal));
      }
      // A make run again beside the one that wrote answers that automation, which must be this workspace's.
      if (written.success.automation.workspaceId !== workspace.value) {
        return agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNAVAILABLE);
      }
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        automation: automationReading(written.success.automation, false),
      };
    }),
  );
}

/** One call of `update_automation`: an automation of the caller's workspace changed as its member may change it. */
export function runUpdateAutomation(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AutomationToolServices> {
  const asked = readUpdateAsked(input);
  const choice = Result.isSuccess(asked) ? namedChoice(asked.success) : null;
  if (Result.isFailure(asked) || choice === null) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_UPDATE));
  }
  const {
    automationId,
    model: _model,
    effort: _effort,
    agentId,
    prompt,
    disabledServers,
    ...rest
  } = asked.success;
  const servers = serversRefused(input);
  if (servers !== undefined) return Effect.succeed(servers);
  const changesAction =
    prompt !== undefined || choice !== undefined || disabledServers !== undefined;
  if (!changesAction && agentId === undefined && Object.keys(rest).length === 0) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_UPDATE));
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace))
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = callerUserId(call.caller);
      const found = yield* workspaceAutomation(userId, workspace.value, automationId);
      if (Option.isNone(found)) return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION);
      const standing = found.value;
      if (rest.trigger !== undefined) {
        const schedule = yield* scheduleRefused(rest.trigger);
        if (schedule !== undefined) return agentToolRejected(schedule);
        const sentry = yield* sentryRefused(workspace.value, rest.trigger);
        if (sentry !== undefined) return agentToolRejected(sentry);
      }
      const model = yield* choiceRefused(userId, choice, "Not changed");
      if (model !== undefined) return agentToolRejected(model);
      const landing = yield* landingNamed(userId, workspace.value, agentId);
      if (Result.isFailure(landing)) return agentToolRejected(landing.failure);
      const action: AutomationAction | undefined = changesAction
        ? {
            ...standing.action,
            ...(prompt === undefined ? undefined : { prompt }),
            ...(choice === undefined ? undefined : { choice }),
            ...(disabledServers === undefined ? undefined : { disabledServers }),
          }
        : undefined;
      const written = yield* changeAutomationAs(userId, standing, {
        ...rest,
        ...(action === undefined ? undefined : { action }),
        ...(landing.success === undefined ? undefined : { target: landing.success }),
      }).pipe(Effect.result);
      if (Result.isFailure(written)) {
        const refusal = written.failure;
        if (
          refusal.error === HOSTED_API_ERROR.INVALID_REQUEST &&
          rest.scope === AUTOMATION_SCOPE.WORKSPACE
        ) {
          return agentToolRejected(AUTOMATION_TOOL_REFUSAL.WORKSPACE_SCOPE);
        }
        return agentToolRejected(refusalWords(refusal));
      }
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        automation: automationReading(written.success.automation, false),
      };
    }),
  );
}

/** One call of `delete_automation`: an automation of the caller's workspace deleted with its history, as its member may delete it. */
export function runDeleteAutomation(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AutomationToolServices> {
  const asked = readDeleteAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_ID));
  }
  const { automationId } = asked.success;
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace))
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = callerUserId(call.caller);
      const found = yield* workspaceAutomation(userId, workspace.value, automationId);
      if (Option.isNone(found)) return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION);
      const deleted = yield* removeAutomationAs(userId, automationId).pipe(
        Effect.as({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          automation: { id: found.value.id, name: found.value.name },
        }),
        Effect.result,
      );
      return Result.isSuccess(deleted)
        ? deleted.success
        : agentToolRejected(refusalWords(deleted.failure));
    }),
  );
}

/** One call of `run_automation`: an automation of the caller's workspace run now, once under the call's key, as its member may run it. */
export function runRunAutomation(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AutomationToolServices> {
  const asked = readRunAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_ID));
  }
  const { automationId } = asked.success;
  const { eveAs } = call;
  if (eveAs === undefined) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.NO_SERVICE));
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace))
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = callerUserId(call.caller);
      const found = yield* workspaceAutomation(userId, workspace.value, automationId);
      if (Option.isNone(found)) return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION);
      const runnable = yield* readAutomation(userId, automationId, AUTOMATION_ACCESS.RUN);
      if (Option.isNone(runnable)) return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NOT_RUNNABLE);
      // Note that the run reaches eve as the deployment acting for the account it starts as, its creator, whoever fired it, as the sweep's runs do.
      const ran = yield* runAutomationNowAs(
        userId,
        runnable.value,
        calledId(userId, call.clientKey),
        (account) => Effect.succeed(eveAs(account)),
      ).pipe(Effect.result);
      if (Result.isFailure(ran)) return agentToolRejected(refusalWords(ran.failure));
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        automation: { id: runnable.value.id, name: runnable.value.name },
        run: runReading(ran.success.run),
        alreadyRan: !ran.success.made,
      };
    }),
  );
}
