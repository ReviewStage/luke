import type { DatabaseServices } from "@luke/database/core/query";
import { settledTurnAgent } from "@luke/database/models/agent-store";
import { readWorkspaceFace, type WorkspaceFace } from "@luke/database/models/workspace-store";
import { type SettledAgentTurn, SettledTurnListener } from "@luke/database/models/writer";
import { PULL_REQUEST_CHAPTERS_FAILURE } from "@luke/database/pull-request-chapters-vocabulary";
import type { ConversationRuntime } from "@luke/database/storage-vocabulary";
import type { AgentKind, AgentMachineKind } from "@luke/features/agent-wire";
import type { AutomationFiringKind, AutomationTriggerKind } from "@luke/features/automation-wire";
import type { IntegrationProvider } from "@luke/features/integration-wire";
import type { ProviderKeyProvider } from "@luke/features/provider-key-wire";
import type { TASK_STATUS } from "@luke/features/task-wire";
import { TURN_FAILURE } from "@luke/features/turn-run";
import type { INVITATION_ROLE } from "@luke/features/workspace-invitation-wire";
import { TURN_STATUS } from "@luke/wire";
import { Clock, Context, Effect, Layer, Option, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { readAccountPerson } from "../accounts/account-person.js";
import { PRODUCT_PLATFORM } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { afterResponse } from "../http/after-response.js";
import {
  type PosthogBatchItem,
  type PosthogGroupFields,
  postBatchEffect,
} from "../providers/posthog.js";
import { DEPLOYMENT_VARIABLE, deploymentNamed } from "./events.js";

/**
 * What the service counts about the work done through it: the core loop the
 * desktop cannot see, because it happens on the service or in an agent's
 * sandbox — a task started, a coding agent started, a member's message to it,
 * each of its turns ended, a Stop, an archive, a pull request opened and
 * merged, an automation made, changed, or deleted, an integration connected,
 * and a member's changes to their skills, channels, machines, and workspace.
 *
 * It holds to the desktop's counted events' rule
 * (`@luke/features/analytics`'s `product-events.ts`): an event is a name from
 * this file, and every property is one of this file's fixed words, a boolean,
 * a count, or an id from a catalog the service itself checked (a provider, a
 * model, an effort). Nothing typed, nothing a model wrote, and no title, branch,
 * repository, prompt, or row id has a property it could travel in, which the
 * types below enforce at each call site.
 *
 * The one row id the vocabulary admits is the workspace's, and only as the
 * event's `$groups` key, never as a property: PostHog's group analytics files
 * an event under the group that key names, which is how a count says how many
 * workspaces are active and what a team does together, and a key is all a
 * group is joined by. An event whose act belongs to one workspace carries it,
 * which the actor each event is typed with enforces (`ServerEventActor`); an
 * account's own setup carries none. Each workspace's group is named, by a
 * `$groupidentify` beside its first event on an instance and again once a day
 * or on a rename, with its name as its members read it and when it was made,
 * and nothing else, as a person's name already rides the desktop's `$set`.
 * No workspace is ever deleted, and PostHog's API deletes no single group,
 * so a group, once named, stays in PostHog as its workspace stays here.
 *
 * What it counts of a team is the member's own act: a thread post or a plan
 * edit or comment an agent made, through its own tools, is left out rather
 * than counted under the member who started the agent, so a count of posts is
 * a count of people talking, and an agent's work is the agent events'.
 *
 * The events are joined to the same person the desktop's are, by the account's
 * own user id, so PostHog's funnels run from the site's sign-in through the
 * desktop's counts to the work itself; and erased with them on account
 * deletion, which deletes by that id. Since a capture runs after its request
 * has answered, or with no request at all (a settled turn, the sweep, an
 * automation's run), it reads the account's row first and posts nothing for
 * one no longer there, so a late event does not bring back the person a
 * deletion erased; one that slips in during the deletion itself is accepted.
 */

export const SERVER_EVENT = {
  TASK_CREATE: "task:create",
  AGENT_START: "agent:start",
  PULL_REQUEST_CREATE: "agent:pull_request_create",
  INBOX_ANSWER_SEND: "inbox:answer_send",
  AUTOMATION_CREATE: "automation:create",
  PULL_REQUEST_CHAPTERS_GENERATE: "pull_request:chapters_generate",
  INTEGRATION_CONNECTION_CREATE: "integration:connection_create",
  INTEGRATION_CONNECTION_DELETE: "integration:connection_delete",
  WORKSPACE_CREATE: "workspace:create",
  AGENT_HANDOFF: "agent:handoff",
  MESSAGE_SEND: "agent:message_send",
  TURN_END: "agent:turn_end",
  AGENT_STOP: "agent:stop",
  AGENT_ARCHIVE: "agent:archive",
  PULL_REQUEST_MERGE: "pull_request:merge",
  ACCOUNT_SIGN_UP: "account:sign_up",
  WORKSPACE_INVITE_SEND: "workspace:invite_send",
  WORKSPACE_INVITE_ACCEPT: "workspace:invite_accept",
  THREAD_POST: "thread:post",
  PLAN_EDIT: "plan:edit",
  PLAN_COMMENT: "plan:comment",
  AUTOMATION_RUN_START: "automation:run_start",
  GITHUB_APP_INSTALL: "github:app_install",
  HOST_INSTALL: "host:install",
  TASK_FINISH: "task:finish",
  AGENT_START_FAIL: "agent:start_fail",
  GITHUB_ACCOUNT_LINK: "github:account_link",
  GITHUB_TOKEN_SAVE: "github:token_save",
  REPOSITORY_PIN: "repository:pin",
  PROVIDER_KEY_CREATE: "provider_key:create",
  PULL_REQUEST_ACTION: "pull_request:action",
  AGENT_SETTINGS_CHANGE: "agent:settings_change",
  SKILL_CHANGE: "skill:change",
  DICTATION_USE: "dictation:use",
  MEMORY_FORGET: "memory:forget",
  HOST_PAIRING_CHANGE: "host:pairing_change",
  CHANNEL_CHANGE: "channel:change",
  WORKSPACE_MEMBER_CHANGE: "workspace:member_change",
  AUTOMATION_CHANGE: "automation:change",
  AGENT_TOOL_OPEN: "agent:tool_open",
} as const;

type ServerEventName = (typeof SERVER_EVENT)[keyof typeof SERVER_EVENT];

/** Where a task was started from: the sidebar's own Start, or an agent's tool. */
export const SERVER_TASK_SOURCE = {
  SIDEBAR: "sidebar",
  AGENT: "agent",
} as const;

/** Who started a coding agent: a member by hand, another agent through its `start_agent`, or an automation's run. */
export const SERVER_AGENT_STARTER = {
  MEMBER: "member",
  AGENT: "agent",
  AUTOMATION: "automation",
} as const;

/** Who made an automation: a member, or an agent through its `create_automation`. */
export const SERVER_AUTOMATION_SOURCE = {
  MEMBER: SERVER_AGENT_STARTER.MEMBER,
  AGENT: SERVER_AGENT_STARTER.AGENT,
} as const;

/** How a coding agent began: fresh on a plan or a prompt, or carried on from another agent. */
export const SERVER_AGENT_START_KIND = {
  FRESH: "fresh",
  FORK: "fork",
  CONTINUE: "continue",
} as const;

/** Which harness a Claude Code or Codex agent runs, as `conversations.runtime` spells it. */
export const SERVER_AGENT_HARNESS = {
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;

/**
 * How a message reached a Claude Code or Codex agent's runner: written to
 * the runner already up (`warm`), the runner launched again in a sandbox
 * still up (`relaunched`), the sandbox resumed from its snapshot first
 * (`resumed`), or a fresh sandbox opened where the snapshot was gone
 * (`fresh`). What each machine's warm window (`CODER.RUNNER_WARM`) is tuned by.
 */
export const SERVER_HANDOFF_PATH = {
  WARM: "warm",
  RELAUNCHED: "relaunched",
  RESUMED: "resumed",
  FRESH: "fresh",
} as const;

/** How an agent's turn ended: answered, failed, stopped by a Stop, or settled by the sweep with no end heard. */
export const SERVER_TURN_OUTCOME = {
  COMPLETED: "completed",
  FAILED: "failed",
  STOPPED: "stopped",
  ABANDONED: "abandoned",
} as const;

/**
 * How long an agent's turn ran, as a bucket rather than a count, each named
 * for its upper bound and read in order: the first whose bound the turn ran
 * under is its bucket, and one past them all is `over_4h`.
 */
export const SERVER_TURN_DURATION = {
  UNDER_1M: "under_1m",
  UNDER_5M: "under_5m",
  UNDER_15M: "under_15m",
  UNDER_1H: "under_1h",
  UNDER_4H: "under_4h",
  OVER_4H: "over_4h",
} as const;

/**
 * Why a failed turn failed: the store's own failure word, or `unknown` where
 * the settled row names none of them.
 */
export const SERVER_TURN_FAILURE = {
  ...TURN_FAILURE,
  UNKNOWN: "unknown",
} as const;

const MINUTE_MS = 60_000;

const TURN_DURATION_BOUNDS = [
  [SERVER_TURN_DURATION.UNDER_1M, MINUTE_MS],
  [SERVER_TURN_DURATION.UNDER_5M, 5 * MINUTE_MS],
  [SERVER_TURN_DURATION.UNDER_15M, 15 * MINUTE_MS],
  [SERVER_TURN_DURATION.UNDER_1H, 60 * MINUTE_MS],
  [SERVER_TURN_DURATION.UNDER_4H, 240 * MINUTE_MS],
] as const;

/** Which account a pull request was opened as. */
export const SERVER_PULL_REQUEST_OPENER = {
  DEVELOPER: "developer",
  APP: "app",
} as const;

/** How a generation of a pull request's chapters came out: made, or the store's word for why it failed. */
export const SERVER_CHAPTERS_OUTCOME = {
  READY: "ready",
  ...PULL_REQUEST_CHAPTERS_FAILURE,
} as const;

/** How an account signed in the first time: the provider's own id, or `unknown` where the request names none of ours. */
export const SERVER_SIGN_IN_METHOD = {
  GOOGLE: "google",
  GITHUB: "github",
  UNKNOWN: "unknown",
} as const;

/** What kind of machine first connected: a box on its approved pairing, or the Mac's own desktop. */
export const SERVER_HOST_KIND = {
  LUKE_HOST: "luke_host",
  THIS_MAC: "this_mac",
} as const;

/** Who finished a task: a member, by moving it to Done or Canceled, or the service, on the merge of its work. */
export const SERVER_TASK_FINISHER = {
  MEMBER: "member",
  MERGE: "merge",
} as const;

/**
 * Why a coding agent's Start failed after its agent was made: eve or the
 * runtime could not be reached, the agent's first line could not be written,
 * the runtime refused the open, or the request was cut short before the
 * session opened.
 */
export const SERVER_AGENT_START_FAILURE = {
  UNREACHABLE: "unreachable",
  FIRST_LINE: "first_line",
  REFUSED: "refused",
  CUT_SHORT: "cut_short",
} as const;

/** The pull request changes a member makes through the app that are counted; every other change is left out. */
export const SERVER_PULL_REQUEST_ACTION = {
  MERGE: "merge",
  REVIEW: "review",
  AUTO_MERGE: "auto_merge",
  CLOSE: "close",
} as const;

/** What of an agent a member changed: the model it runs on, or its effort. */
export const SERVER_AGENT_SETTING = {
  MODEL: "model",
  EFFORT: "effort",
} as const;

/** What a member did to an installed skill. */
export const SERVER_SKILL_ACTION = {
  INSTALL: "install",
  ENABLE: "enable",
  DISABLE: "disable",
  UPDATE: "update",
  SHARE: "share",
  REMOVE: "remove",
} as const;

/**
 * How long a dictated clip ran, as a bucket, named for its upper bound as the
 * turn's are; the service holds a clip to two minutes, so none runs over.
 */
export const SERVER_DICTATION_DURATION = {
  UNDER_10S: "under_10s",
  UNDER_30S: "under_30s",
  UNDER_1M: "under_1m",
  UNDER_2M: "under_2m",
} as const;

const SECOND_MS = 1_000;

const DICTATION_DURATION_BOUNDS = [
  [SERVER_DICTATION_DURATION.UNDER_10S, 10 * SECOND_MS],
  [SERVER_DICTATION_DURATION.UNDER_30S, 30 * SECOND_MS],
  [SERVER_DICTATION_DURATION.UNDER_1M, MINUTE_MS],
] as const;

/** What a member did to a box's pairing or an enrolled machine. */
export const SERVER_HOST_PAIRING_ACTION = {
  APPROVE: "approve",
  DENY: "deny",
  REMOVE: "remove",
} as const;

/** What a member did to a channel; an unarchive is left out. */
export const SERVER_CHANNEL_ACTION = {
  CREATE: "create",
  EDIT: "edit",
  ARCHIVE: "archive",
  THREAD_MOVE: "thread_move",
} as const;

/** What was done to a workspace's members or to the workspace itself. */
export const SERVER_WORKSPACE_MEMBER_ACTION = {
  REMOVE: "remove",
  ROLE_CHANGE: "role_change",
  TRANSFER: "transfer",
  LEAVE: "leave",
  RENAME: "rename",
  INVITE_CANCEL: "invite_cancel",
} as const;

/** What was done to an automation that is counted: a change, a toggle among them, or a delete. */
export const SERVER_AUTOMATION_CHANGE_ACTION = {
  EDIT: "edit",
  DELETE: "delete",
} as const;

/** Which of an agent's tools a member opened or took up by hand. */
export const SERVER_AGENT_TOOL = {
  TERMINAL: "terminal",
  BROWSER: "browser",
  BROWSER_TAKEOVER: "browser_takeover",
  BROWSER_HANDBACK: "browser_handback",
  ADD_TO_PLAN: "add_to_plan",
} as const;

type Values<T> = T[keyof T];

/** Where a task came to rest: done or canceled, the two a finish counts. */
export type ServerTaskFinishStatus = typeof TASK_STATUS.DONE | typeof TASK_STATUS.CANCELED;

export type ServerAgentStartFailure = Values<typeof SERVER_AGENT_START_FAILURE>;

export type ServerAgentStarter = Values<typeof SERVER_AGENT_STARTER>;

export type ServerSkillAction = Values<typeof SERVER_SKILL_ACTION>;

export type ServerChannelAction = Values<typeof SERVER_CHANNEL_ACTION>;

export type ServerAgentTool = Values<typeof SERVER_AGENT_TOOL>;

export type ServerWorkspaceMemberAction = Values<typeof SERVER_WORKSPACE_MEMBER_ACTION>;

/**
 * Exactly what each event carries. A model and an effort are catalog ids the
 * start already checked against the catalog it offers, and a provider is the
 * integration catalog's own id; every other value is a word from this file, or
 * a kind the store's own schema enumerates.
 */
export interface ServerEventProperties {
  [SERVER_EVENT.TASK_CREATE]: {
    source: Values<typeof SERVER_TASK_SOURCE>;
  };
  [SERVER_EVENT.AGENT_START]: {
    model: string;
    effort: string;
    start_kind: Values<typeof SERVER_AGENT_START_KIND>;
    is_from_automation: boolean;
    started_by: Values<typeof SERVER_AGENT_STARTER>;
    has_task: boolean;
    /** What the agent is: a coder, or a task's pilot. */
    agent_kind: AgentKind;
  };
  [SERVER_EVENT.PULL_REQUEST_CREATE]: {
    opened_as: Values<typeof SERVER_PULL_REQUEST_OPENER>;
    is_draft: boolean;
  };
  [SERVER_EVENT.INBOX_ANSWER_SEND]: Record<string, never>;
  [SERVER_EVENT.AUTOMATION_CREATE]: {
    trigger_kind: AutomationTriggerKind;
    source: Values<typeof SERVER_AUTOMATION_SOURCE>;
  };
  /** Counts alone: how many chapters and hunks a generation told, how long it took, and how it came out. */
  [SERVER_EVENT.PULL_REQUEST_CHAPTERS_GENERATE]: {
    outcome: Values<typeof SERVER_CHAPTERS_OUTCOME>;
    chapters: number;
    hunks: number;
    duration_ms: number;
  };
  [SERVER_EVENT.INTEGRATION_CONNECTION_CREATE]: { provider: IntegrationProvider };
  [SERVER_EVENT.INTEGRATION_CONNECTION_DELETE]: { provider: IntegrationProvider };
  [SERVER_EVENT.WORKSPACE_CREATE]: Record<string, never>;
  /** Counts alone: how the message reached the runner, whether a turn was under way, and how long since the agent's last turn ended. */
  [SERVER_EVENT.AGENT_HANDOFF]: {
    harness: Values<typeof SERVER_AGENT_HARNESS>;
    path: Values<typeof SERVER_HANDOFF_PATH>;
    turn_running: boolean;
    idle_seconds?: number;
  };
  /** A member's own message to an agent: what answers it, where it runs, what it is, whether a turn was under way, and whether it waited in the agent's queue first. */
  [SERVER_EVENT.MESSAGE_SEND]: {
    runtime: ConversationRuntime;
    machine: AgentMachineKind;
    agent_kind: AgentKind;
    turn_running: boolean;
    queued: boolean;
  };
  [SERVER_EVENT.TURN_END]: {
    outcome: Values<typeof SERVER_TURN_OUTCOME>;
    /** Why the turn failed, where its outcome is `failed` alone. */
    failure?: Values<typeof SERVER_TURN_FAILURE>;
    duration: Values<typeof SERVER_TURN_DURATION>;
    agent_kind: AgentKind;
  };
  /** A member's Stop. */
  [SERVER_EVENT.AGENT_STOP]: { agent_kind: AgentKind };
  [SERVER_EVENT.AGENT_ARCHIVE]: { agent_kind: AgentKind };
  [SERVER_EVENT.PULL_REQUEST_MERGE]: Record<string, never>;
  [SERVER_EVENT.ACCOUNT_SIGN_UP]: { method: Values<typeof SERVER_SIGN_IN_METHOD> };
  /** The role is the one the invitation offers, which only the plugin's two roles are. */
  [SERVER_EVENT.WORKSPACE_INVITE_SEND]: { role: Values<typeof INVITATION_ROLE> };
  [SERVER_EVENT.WORKSPACE_INVITE_ACCEPT]: Record<string, never>;
  /** A member's post alone: whether it carried the answer to the thread's open ask, and whether it held a picture or a file. */
  [SERVER_EVENT.THREAD_POST]: { answered_ask: boolean; has_media: boolean };
  [SERVER_EVENT.PLAN_EDIT]: Record<string, never>;
  /** A member's comment alone: whether it replied on a thread, or started one. */
  [SERVER_EVENT.PLAN_COMMENT]: { is_reply: boolean };
  /** Attributed to the automation's owner, whoever or whatever fired the run. */
  [SERVER_EVENT.AUTOMATION_RUN_START]: { trigger_kind: AutomationFiringKind };
  [SERVER_EVENT.GITHUB_APP_INSTALL]: Record<string, never>;
  [SERVER_EVENT.HOST_INSTALL]: { kind: Values<typeof SERVER_HOST_KIND> };
  /** A task moved to Done or Canceled, by a member's own move or by the service on its work's merge. */
  [SERVER_EVENT.TASK_FINISH]: {
    status: ServerTaskFinishStatus;
    by: Values<typeof SERVER_TASK_FINISHER>;
  };
  /** A Start whose agent was made and then discarded because its session never opened. */
  [SERVER_EVENT.AGENT_START_FAIL]: {
    failure: ServerAgentStartFailure;
    started_by: Values<typeof SERVER_AGENT_STARTER>;
    agent_kind: AgentKind;
  };
  /** A GitHub account linked to a signed-in account, a sign-up through GitHub left out. */
  [SERVER_EVENT.GITHUB_ACCOUNT_LINK]: Record<string, never>;
  [SERVER_EVENT.GITHUB_TOKEN_SAVE]: Record<string, never>;
  /** A repository pinned or unpinned in the sidebar; the repository is never named. */
  [SERVER_EVENT.REPOSITORY_PIN]: { pinned: boolean };
  /** A provider's key or sign-in saved, by the provider's catalog id alone. */
  [SERVER_EVENT.PROVIDER_KEY_CREATE]: { provider: ProviderKeyProvider };
  /** A member's own change to a pull request, an agent's through its own tools left out. */
  [SERVER_EVENT.PULL_REQUEST_ACTION]: { action: Values<typeof SERVER_PULL_REQUEST_ACTION> };
  /** One counted for each of the model and the effort that a member's change made differ. */
  [SERVER_EVENT.AGENT_SETTINGS_CHANGE]: { changed: Values<typeof SERVER_AGENT_SETTING> };
  /** A member's change to an installed skill; which skill is never named. */
  [SERVER_EVENT.SKILL_CHANGE]: { action: Values<typeof SERVER_SKILL_ACTION> };
  /** One transcribed clip, by how long it ran; its words are never counted. */
  [SERVER_EVENT.DICTATION_USE]: { duration: Values<typeof SERVER_DICTATION_DURATION> };
  /** A member's forget of one of the workspace's memories; what it held is never counted. */
  [SERVER_EVENT.MEMORY_FORGET]: Record<string, never>;
  [SERVER_EVENT.HOST_PAIRING_CHANGE]: { action: Values<typeof SERVER_HOST_PAIRING_ACTION> };
  [SERVER_EVENT.CHANNEL_CHANGE]: { action: Values<typeof SERVER_CHANNEL_ACTION> };
  [SERVER_EVENT.WORKSPACE_MEMBER_CHANGE]: { action: Values<typeof SERVER_WORKSPACE_MEMBER_ACTION> };
  /** Who changed it is the member or one of their agents, as `automation:create` says. */
  [SERVER_EVENT.AUTOMATION_CHANGE]: {
    action: Values<typeof SERVER_AUTOMATION_CHANGE_ACTION>;
    source: Values<typeof SERVER_AUTOMATION_SOURCE>;
  };
  [SERVER_EVENT.AGENT_TOOL_OPEN]: { tool: Values<typeof SERVER_AGENT_TOOL> };
}

/**
 * The events whose act belongs to no one workspace: an account's own sign-up
 * and setup, and its pins, machines, and dictation, which reach every
 * workspace it is in alike, and its skills, which may be personal and are
 * changed by id, naming no workspace.
 */
type AccountEventName =
  | typeof SERVER_EVENT.ACCOUNT_SIGN_UP
  | typeof SERVER_EVENT.INTEGRATION_CONNECTION_CREATE
  | typeof SERVER_EVENT.INTEGRATION_CONNECTION_DELETE
  | typeof SERVER_EVENT.GITHUB_ACCOUNT_LINK
  | typeof SERVER_EVENT.GITHUB_TOKEN_SAVE
  | typeof SERVER_EVENT.PROVIDER_KEY_CREATE
  | typeof SERVER_EVENT.REPOSITORY_PIN
  | typeof SERVER_EVENT.HOST_INSTALL
  | typeof SERVER_EVENT.SKILL_CHANGE
  | typeof SERVER_EVENT.DICTATION_USE
  | typeof SERVER_EVENT.HOST_PAIRING_CHANGE;

/**
 * Who an event is counted under: the account that acted, and the one
 * workspace its act belongs to. Every event not named above belongs to one,
 * so an event added later carries its workspace unless it is said not to.
 */
export type ServerEventActor<Name extends ServerEventName> = Name extends AccountEventName
  ? { readonly userId: string; readonly workspaceId?: never }
  : { readonly userId: string; readonly workspaceId: string };

/** One event as the service records it. */
interface ServerEvent<Name extends ServerEventName = ServerEventName> {
  readonly name: Name;
  readonly userId: string;
  /** The workspace the event is grouped under, where its act belongs to one. */
  readonly workspaceId?: string;
  readonly properties: ServerEventProperties[Name];
}

/** The group type a workspace is filed under in PostHog, one of the project's five. */
const WORKSPACE_GROUP_TYPE = "workspace";

/** The event PostHog takes a group's properties from. */
const GROUP_IDENTIFY_EVENT = "$groupidentify";

/**
 * How often an instance names a workspace's group again: its first event on
 * the instance names it, and one a day after, so a group made before this
 * count existed, or an account's first workspace renamed with the account,
 * is named within a day of its next event.
 */
const WORKSPACE_GROUP_REFRESH_MS = 24 * 60 * 60_000;

/** The `$lib` every server-recorded event is stamped with, beside the desktop's own. */
const SERVER_EVENT_LIB = "luke-service";

/**
 * How long one capture may take. It runs once the request has answered
 * (`recordServerEvent`), the instance kept awake for it, and is bounded so a
 * slow processor costs a count rather than an instance held open.
 */
const SERVER_EVENT_TIMEOUT_MS = 2_000;

/** The privacy fields and stamps every item a server batch posts carries. */
function stamped(properties: PosthogBatchItem["properties"], environment: string) {
  return {
    ...properties,
    // Without it an event with no address resolves to the data centre's.
    $geoip_disable: true,
    $lib: SERVER_EVENT_LIB,
    platform: PRODUCT_PLATFORM.SERVER,
    environment,
  };
}

/**
 * The item a server event posts, under the same privacy fields the desktop's
 * batch carries, stamped with the deployment that recorded it as the
 * desktop's are (`events.ts`), so a preview's or a local service's counts can
 * be told from production's, and filed under its workspace's group where it
 * has one.
 */
function serverEventItem(event: ServerEvent, now: number, environment: string): PosthogBatchItem {
  return {
    event: event.name,
    distinct_id: event.userId,
    timestamp: new Date(now).toISOString(),
    properties: stamped(
      {
        ...event.properties,
        ...(event.workspaceId === undefined
          ? undefined
          : { $groups: { [WORKSPACE_GROUP_TYPE]: event.workspaceId } }),
      },
      environment,
    ),
  };
}

/**
 * What a workspace's group is named with in PostHog: its name as its members
 * read it, and when it was made, and nothing else. The one place a
 * workspace's name leaves the service for PostHog.
 */
function workspaceGroupProperties(face: WorkspaceFace): PosthogGroupFields {
  return { name: face.name, created_at: face.createdAt.toISOString() };
}

/** The `$groupidentify` that names one workspace's group (`workspaceGroupProperties`). */
function workspaceGroupItem(
  userId: string,
  workspaceId: string,
  face: WorkspaceFace,
  now: number,
  environment: string,
): PosthogBatchItem {
  return {
    event: GROUP_IDENTIFY_EVENT,
    distinct_id: userId,
    timestamp: new Date(now).toISOString(),
    properties: stamped(
      {
        $group_type: WORKSPACE_GROUP_TYPE,
        $group_key: workspaceId,
        $group_set: workspaceGroupProperties(face),
      },
      environment,
    ),
  };
}

interface ProductAnalyticsValues {
  /** Records one event, or does nothing; it never fails and never names the key. */
  readonly capture: (event: ServerEvent) => Effect.Effect<void>;
  /** Names one workspace's group now, however lately it was named, as a rename asks; never fails. */
  readonly nameWorkspace: (userId: string, workspaceId: string) => Effect.Effect<void>;
}

/**
 * The service's own analytics. Read optionally (`recordServerEvent`), so a
 * call site's requirements do not change and a runtime or a test that provides
 * none records nothing.
 */
class ProductAnalytics extends Context.Service<ProductAnalytics, ProductAnalyticsValues>()(
  "ProductAnalytics",
) {}

/**
 * The deployment's analytics, from the same project token the desktop's batch
 * is posted under. A deployment without one — a Preview, a local run — records
 * nothing, the same kill switch `/api/events` has. Each workspace's group is
 * named beside the first of its events this instance posts and once a day
 * after (`WORKSPACE_GROUP_REFRESH_MS`), from the workspace's own row; an
 * instance keeps only when it last named each, and a read or a post that
 * fails leaves it to name the group again with the next event. An event of
 * an account whose row is gone, or cannot be read, is not posted.
 */
const productAnalyticsOfEnvironment = Layer.effect(
  ProductAnalytics,
  Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const client = yield* HttpClient.HttpClient;
    const database = yield* Effect.context<DatabaseServices>();
    const key = environment.posthogProjectApiKey;
    if (key === undefined) {
      return { capture: () => Effect.void, nameWorkspace: () => Effect.void };
    }
    const host = environment.posthogIngestHost;
    // Vercel's own variable, read as the layer is built, as `/api/events` reads it per request.
    const deployment = deploymentNamed(process.env[DEPLOYMENT_VARIABLE]);
    const named = new Map<string, number>();
    const post = (items: readonly PosthogBatchItem[]) =>
      postBatchEffect(
        { api_key: Redacted.value(key), historical_migration: false, batch: items },
        { ...(host === undefined ? undefined : { host }), timeoutMs: SERVER_EVENT_TIMEOUT_MS },
      ).pipe(Effect.provideService(HttpClient.HttpClient, client));
    // The group's naming item, or none where the workspace is gone or its row cannot be read.
    const groupItems = (userId: string, workspaceId: string, now: number) =>
      readWorkspaceFace(workspaceId).pipe(
        Effect.provideContext(database),
        Effect.map(
          Option.match({
            onNone: () => [],
            onSome: (face) => [workspaceGroupItem(userId, workspaceId, face, now, deployment)],
          }),
        ),
        Effect.orElseSucceed((): PosthogBatchItem[] => []),
      );
    // Posts the items, the group's naming first, and notes the group named once PostHog took them.
    const postNaming = (
      workspaceId: string,
      naming: readonly PosthogBatchItem[],
      rest: readonly PosthogBatchItem[],
      now: number,
    ) =>
      Effect.gen(function* () {
        const answer = yield* post([...naming, ...rest]);
        if (naming.length > 0 && answer?.ok === true) named.set(workspaceId, now);
      });
    const due = (workspaceId: string, now: number) => {
      const last = named.get(workspaceId);
      return last === undefined || now - last >= WORKSPACE_GROUP_REFRESH_MS;
    };
    // Whether the account still stands; a deleted one's person must not be posted back.
    const stands = (userId: string) =>
      readAccountPerson(userId).pipe(
        Effect.provideContext(database),
        Effect.map((person) => person !== undefined),
      );
    return {
      capture: (event: ServerEvent) =>
        Effect.gen(function* () {
          if (!(yield* stands(event.userId))) return;
          const now = yield* Clock.currentTimeMillis;
          const item = serverEventItem(event, now, deployment);
          const workspaceId = event.workspaceId;
          if (workspaceId === undefined || !due(workspaceId, now)) return yield* post([item]);
          yield* postNaming(
            workspaceId,
            yield* groupItems(event.userId, workspaceId, now),
            [item],
            now,
          );
        }).pipe(Effect.ignore),
      nameWorkspace: (userId: string, workspaceId: string) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const naming = yield* groupItems(userId, workspaceId, now);
          if (naming.length > 0) yield* postNaming(workspaceId, naming, [], now);
        }).pipe(Effect.ignore),
    };
  }),
);

/**
 * Counts one event where the work was committed, under the account that
 * acted and the workspace its act belongs to. Typed per event, so a call
 * site can only hand over that event's own properties and its own kind of
 * actor; a runtime without `ProductAnalytics` makes this a no-op. The capture
 * runs once the request has answered (`after-response.ts`), so no answer
 * waits on PostHog; a runtime that runs nothing past its answers captures it
 * in place.
 */
export function recordServerEvent<Name extends ServerEventName>(
  name: Name,
  actor: ServerEventActor<Name>,
  properties: ServerEventProperties[Name],
): Effect.Effect<void> {
  return recordServerEventOf(name, Effect.succeed(Option.some({ actor, properties })));
}

/** The events whose act belongs to one workspace. */
type WorkspaceEventName = Exclude<ServerEventName, AccountEventName>;

/**
 * Counts one event in the workspace a read finds once the request has
 * answered, for a call site that holds no workspace of the act's own, such as
 * a post on a thread whose item names only its agent; counts nothing where
 * the read finds none or fails, as `recordServerEventOf` does.
 */
export function recordServerEventIn<Name extends WorkspaceEventName, E, R>(
  name: Name,
  userId: string,
  workspace: Effect.Effect<Option.Option<string>, E, R>,
  properties: ServerEventProperties[Name],
): Effect.Effect<void, never, R> {
  return recordServerEventOf(
    name,
    Effect.map(
      workspace,
      Option.map((workspaceId) => ({
        // SAFETY: every `WorkspaceEventName` is typed with this actor, which
        // TypeScript cannot follow through the conditional over a generic name.
        actor: { userId, workspaceId } as ServerEventActor<Name>,
        properties,
      })),
    ),
  );
}

/** One event's actor and properties, as a count read once the request has answered finds them. */
interface CountedRead<Name extends ServerEventName> {
  readonly actor: ServerEventActor<Name>;
  readonly properties: ServerEventProperties[Name];
}

/**
 * Counts one event whose actor and properties are read once the request has
 * answered, or counts nothing where that read finds none or fails, so a read
 * the count needs never holds or fails the work it follows.
 */
function recordServerEventOf<Name extends ServerEventName, E, R>(
  name: Name,
  counted: Effect.Effect<Option.Option<CountedRead<Name>>, E, R>,
): Effect.Effect<void, never, R> {
  return Effect.flatMap(Effect.serviceOption(ProductAnalytics), (analytics) =>
    Option.isNone(analytics)
      ? Effect.void
      : afterResponse(
          name,
          Effect.flatMap(counted, (read) => {
            if (Option.isNone(read)) return Effect.void;
            const { actor, properties } = read.value;
            // SAFETY: `properties` is typed as this `name`'s own entry above;
            // the union `ServerEvent` widens the pairing TypeScript cannot follow.
            return analytics.value.capture({
              name,
              userId: actor.userId,
              ...(actor.workspaceId === undefined ? undefined : { workspaceId: actor.workspaceId }),
              properties,
            } as ServerEvent);
          }),
        ),
  );
}

/**
 * Names a workspace's group again once the request has answered, for a
 * rename, so the new name reaches PostHog without waiting on the next day's
 * naming; a runtime without `ProductAnalytics` names nothing.
 */
export function workspaceRenamed(userId: string, workspaceId: string): Effect.Effect<void> {
  return Effect.flatMap(Effect.serviceOption(ProductAnalytics), (analytics) =>
    Option.isNone(analytics)
      ? Effect.void
      : afterResponse("workspace group", analytics.value.nameWorkspace(userId, workspaceId)),
  );
}

/** What a settled turn's row says of how it ended, in the count's words. */
function turnOutcomeOf(turn: SettledAgentTurn): Values<typeof SERVER_TURN_OUTCOME> {
  if (turn.status === TURN_STATUS.SETTLED) return SERVER_TURN_OUTCOME.COMPLETED;
  if (turn.status === TURN_STATUS.CANCELLED) return SERVER_TURN_OUTCOME.STOPPED;
  return turn.failure === TURN_FAILURE.ABANDONED
    ? SERVER_TURN_OUTCOME.ABANDONED
    : SERVER_TURN_OUTCOME.FAILED;
}

const TURN_FAILURE_WORDS: ReadonlySet<string> = new Set(Object.values(TURN_FAILURE));

function isTurnFailure(word: string | null): word is Values<typeof TURN_FAILURE> {
  return word !== null && TURN_FAILURE_WORDS.has(word);
}

/** A failed turn's failure word, held to the fixed set, so no other word the row holds reaches the count. */
function turnFailureOf(turn: SettledAgentTurn): Values<typeof SERVER_TURN_FAILURE> {
  return isTurnFailure(turn.failure) ? turn.failure : SERVER_TURN_FAILURE.UNKNOWN;
}

function turnDurationOf(ranMs: number): Values<typeof SERVER_TURN_DURATION> {
  const bucket = TURN_DURATION_BOUNDS.find(([, bound]) => ranMs < bound);
  return bucket === undefined ? SERVER_TURN_DURATION.OVER_4H : bucket[0];
}

/** The bucket a dictated clip's length falls in. */
export function dictationDurationOf(ms: number): Values<typeof SERVER_DICTATION_DURATION> {
  const bucket = DICTATION_DURATION_BOUNDS.find(([, bound]) => ms < bound);
  return bucket === undefined ? SERVER_DICTATION_DURATION.UNDER_2M : bucket[0];
}

/**
 * Counts an agent turn the store writer settled, wherever it was settled:
 * the relay's or a runner's own end, a lost runner's or ended session's, and
 * the sweep's abandon alike, since each is the one write that moved the turn
 * to its end and a repeat of it settles nothing. It is counted under the
 * account the turn stands in, the agent's starter, as `agent:start` is, so an
 * automation's run counts under its owner, in the agent's workspace. The
 * agent's kind and workspace are read once the
 * request has answered, by then past any transaction the settle ran inside,
 * and only where the turn still stands ended, so a settle that transaction
 * rolled back is not counted. The deployment's listener hears each turn
 * here and hands it on to its starter beside
 * (`../agents/coder-host/settled-turns.ts`).
 */
export function turnEndCounted(
  turn: SettledAgentTurn,
): Effect.Effect<void, never, DatabaseServices> {
  return recordServerEventOf(
    SERVER_EVENT.TURN_END,
    Effect.map(
      settledTurnAgent(turn.turnId),
      Option.map((agent) => {
        const outcome = turnOutcomeOf(turn);
        return {
          actor: { userId: turn.userId, workspaceId: agent.organizationId },
          properties: {
            outcome,
            ...(outcome === SERVER_TURN_OUTCOME.FAILED
              ? { failure: turnFailureOf(turn) }
              : undefined),
            duration: turnDurationOf(turn.ranMs),
            agent_kind: agent.kind,
          },
        };
      }),
    ),
  );
}

/** A listener that counts the settled turns and nothing else, for a test over what an endpoint counted. */
const turnEndCounting = Layer.succeed(SettledTurnListener, { heard: turnEndCounted });

/** The deployment's analytics as `productAnalyticsOfEnvironment` posts them. */
export const productAnalyticsFromEnvironment = productAnalyticsOfEnvironment;

/**
 * Analytics that keeps what it was handed rather than posting it, for a test
 * that asserts what an endpoint counted, the store's settled turns among it.
 */
export function recordingProductAnalytics() {
  const recorded: ServerEvent[] = [];
  const layer = Layer.merge(
    Layer.succeed(ProductAnalytics, {
      capture: (event) => Effect.sync(() => void recorded.push(event)),
      nameWorkspace: () => Effect.void,
    }),
    turnEndCounting,
  );
  return { layer, recorded };
}
