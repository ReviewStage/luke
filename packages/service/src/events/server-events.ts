import type { DatabaseServices } from "@repo/database/core/query";
import { settledTurnAgent } from "@repo/database/models/agent-store";
import { readWorkspaceFace, type WorkspaceFace } from "@repo/database/models/workspace-store";
import { type SettledAgentTurn, SettledTurnListener } from "@repo/database/models/writer";
import { PULL_REQUEST_CHAPTERS_FAILURE } from "@repo/database/pull-request-chapters-vocabulary";
import type { ConversationRuntime } from "@repo/database/storage-vocabulary";
import type { AgentKind, AgentMachineKind } from "@repo/features/agent-wire";
import type { AutomationFiringKind, AutomationTriggerKind } from "@repo/features/automation-wire";
import type { IntegrationProvider } from "@repo/features/integration-wire";
import type { ProviderKeyProvider } from "@repo/features/provider-key-wire";
import type { TASK_STATUS } from "@repo/features/task-wire";
import { TURN_FAILURE } from "@repo/features/turn-run";
import type { INVITATION_ROLE } from "@repo/features/workspace-invitation-wire";
import { TURN_STATUS } from "@repo/wire";
import { Clock, Context, Effect, Layer, Option, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { readAccountPerson } from "../accounts/account-person.js";
import { PRODUCT_PLATFORM } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { afterResponse } from "../http/after-response.js";
import {
  type PosthogBatchItem,
  type PosthogGroupFields,
  type PosthogPerson,
  postBatchEffect,
} from "../providers/posthog.js";
import { DEPLOYMENT_VARIABLE, deploymentNamed, WORKSPACE_GROUP_TYPE } from "./events.js";

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
  DESCRIPTION_EDIT: "description:edit",
  DESCRIPTION_COMMENT: "description:comment",
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
  WORKSPACE_MEMBER_CHANGE: "workspace:member_change",
  AUTOMATION_CHANGE: "automation:change",
  AGENT_TOOL_OPEN: "agent:tool_open",
} as const;

type ServerEventName = (typeof SERVER_EVENT)[keyof typeof SERVER_EVENT];

export const SERVER_TASK_SOURCE = {
  SIDEBAR: "sidebar",
  AGENT: "agent",
} as const;

export const SERVER_AGENT_STARTER = {
  MEMBER: "member",
  AGENT: "agent",
  AUTOMATION: "automation",
} as const;

export const SERVER_AUTOMATION_SOURCE = {
  MEMBER: SERVER_AGENT_STARTER.MEMBER,
  AGENT: SERVER_AGENT_STARTER.AGENT,
} as const;

export const SERVER_AGENT_START_KIND = {
  FRESH: "fresh",
  FORK: "fork",
  CONTINUE: "continue",
} as const;

export const SERVER_AGENT_HARNESS = {
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;

export const SERVER_HANDOFF_PATH = {
  WARM: "warm",
  RELAUNCHED: "relaunched",
  RESUMED: "resumed",
  FRESH: "fresh",
} as const;

export const SERVER_TURN_OUTCOME = {
  COMPLETED: "completed",
  FAILED: "failed",
  STOPPED: "stopped",
  ABANDONED: "abandoned",
} as const;

export const SERVER_TURN_DURATION = {
  UNDER_1M: "under_1m",
  UNDER_5M: "under_5m",
  UNDER_15M: "under_15m",
  UNDER_1H: "under_1h",
  UNDER_4H: "under_4h",
  OVER_4H: "over_4h",
} as const;

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

export const SERVER_PULL_REQUEST_OPENER = {
  DEVELOPER: "developer",
  APP: "app",
} as const;

export const SERVER_CHAPTERS_OUTCOME = {
  READY: "ready",
  ...PULL_REQUEST_CHAPTERS_FAILURE,
} as const;

export const SERVER_SIGN_IN_METHOD = {
  GOOGLE: "google",
  GITHUB: "github",
  UNKNOWN: "unknown",
} as const;

export const SERVER_HOST_KIND = {
  BOX_HOST: "box_host",
  THIS_MAC: "this_mac",
} as const;

export const SERVER_TASK_FINISHER = {
  MEMBER: "member",
  MERGE: "merge",
  RUN: "run",
  SLACK: "slack",
  START: "start",
} as const;

export const SERVER_AGENT_START_FAILURE = {
  UNREACHABLE: "unreachable",
  FIRST_LINE: "first_line",
  REFUSED: "refused",
  CUT_SHORT: "cut_short",
} as const;

export const SERVER_PULL_REQUEST_ACTION = {
  MERGE: "merge",
  REVIEW: "review",
  AUTO_MERGE: "auto_merge",
  CLOSE: "close",
} as const;

export const SERVER_AGENT_SETTING = {
  MODEL: "model",
  EFFORT: "effort",
} as const;

export const SERVER_SKILL_ACTION = {
  INSTALL: "install",
  REMOVE: "remove",
} as const;

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

export const SERVER_HOST_PAIRING_ACTION = {
  APPROVE: "approve",
  DENY: "deny",
  REMOVE: "remove",
} as const;

export const SERVER_WORKSPACE_MEMBER_ACTION = {
  REMOVE: "remove",
  ROLE_CHANGE: "role_change",
  TRANSFER: "transfer",
  LEAVE: "leave",
  RENAME: "rename",
  INVITE_CANCEL: "invite_cancel",
} as const;

export const SERVER_AUTOMATION_CHANGE_ACTION = {
  EDIT: "edit",
  DELETE: "delete",
} as const;

export const SERVER_AGENT_TOOL = {
  TERMINAL: "terminal",
  BROWSER: "browser",
  BROWSER_TAKEOVER: "browser_takeover",
  BROWSER_HANDBACK: "browser_handback",
  ADD_TO_DESCRIPTION: "add_to_description",
} as const;

type Values<T> = T[keyof T];

export type ServerTaskFinishStatus = typeof TASK_STATUS.DONE | typeof TASK_STATUS.CANCELED;

export type ServerAgentStartFailure = Values<typeof SERVER_AGENT_START_FAILURE>;

export type ServerAgentStarter = Values<typeof SERVER_AGENT_STARTER>;

export type ServerSkillAction = Values<typeof SERVER_SKILL_ACTION>;

export type ServerAgentTool = Values<typeof SERVER_AGENT_TOOL>;

export type ServerWorkspaceMemberAction = Values<typeof SERVER_WORKSPACE_MEMBER_ACTION>;

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
  [SERVER_EVENT.PULL_REQUEST_CHAPTERS_GENERATE]: {
    outcome: Values<typeof SERVER_CHAPTERS_OUTCOME>;
    chapters: number;
    hunks: number;
    duration_ms: number;
  };
  [SERVER_EVENT.INTEGRATION_CONNECTION_CREATE]: { provider: IntegrationProvider };
  [SERVER_EVENT.INTEGRATION_CONNECTION_DELETE]: { provider: IntegrationProvider };
  [SERVER_EVENT.WORKSPACE_CREATE]: Record<string, never>;
  [SERVER_EVENT.AGENT_HANDOFF]: {
    harness: Values<typeof SERVER_AGENT_HARNESS>;
    path: Values<typeof SERVER_HANDOFF_PATH>;
    turn_running: boolean;
    idle_seconds?: number;
  };
  [SERVER_EVENT.MESSAGE_SEND]: {
    runtime: ConversationRuntime;
    machine: AgentMachineKind;
    agent_kind: AgentKind;
    turn_running: boolean;
    queued: boolean;
  };
  [SERVER_EVENT.TURN_END]: {
    outcome: Values<typeof SERVER_TURN_OUTCOME>;
    failure?: Values<typeof SERVER_TURN_FAILURE>;
    duration: Values<typeof SERVER_TURN_DURATION>;
    agent_kind: AgentKind;
  };
  [SERVER_EVENT.AGENT_STOP]: { agent_kind: AgentKind };
  [SERVER_EVENT.AGENT_ARCHIVE]: { agent_kind: AgentKind };
  [SERVER_EVENT.PULL_REQUEST_MERGE]: Record<string, never>;
  [SERVER_EVENT.ACCOUNT_SIGN_UP]: { method: Values<typeof SERVER_SIGN_IN_METHOD> };
  [SERVER_EVENT.WORKSPACE_INVITE_SEND]: { role: Values<typeof INVITATION_ROLE> };
  [SERVER_EVENT.WORKSPACE_INVITE_ACCEPT]: Record<string, never>;
  [SERVER_EVENT.THREAD_POST]: { answered_ask: boolean; has_media: boolean };
  [SERVER_EVENT.DESCRIPTION_EDIT]: Record<string, never>;
  [SERVER_EVENT.DESCRIPTION_COMMENT]: { is_reply: boolean };
  [SERVER_EVENT.AUTOMATION_RUN_START]: { trigger_kind: AutomationFiringKind };
  [SERVER_EVENT.GITHUB_APP_INSTALL]: Record<string, never>;
  [SERVER_EVENT.HOST_INSTALL]: { kind: Values<typeof SERVER_HOST_KIND> };
  [SERVER_EVENT.TASK_FINISH]: {
    status: ServerTaskFinishStatus;
    by: Values<typeof SERVER_TASK_FINISHER>;
  };
  [SERVER_EVENT.AGENT_START_FAIL]: {
    failure: ServerAgentStartFailure;
    started_by: Values<typeof SERVER_AGENT_STARTER>;
    agent_kind: AgentKind;
  };
  [SERVER_EVENT.GITHUB_ACCOUNT_LINK]: Record<string, never>;
  [SERVER_EVENT.GITHUB_TOKEN_SAVE]: Record<string, never>;
  [SERVER_EVENT.REPOSITORY_PIN]: { pinned: boolean };
  [SERVER_EVENT.PROVIDER_KEY_CREATE]: { provider: ProviderKeyProvider };
  [SERVER_EVENT.PULL_REQUEST_ACTION]: { action: Values<typeof SERVER_PULL_REQUEST_ACTION> };
  [SERVER_EVENT.AGENT_SETTINGS_CHANGE]: { changed: Values<typeof SERVER_AGENT_SETTING> };
  [SERVER_EVENT.SKILL_CHANGE]: { action: Values<typeof SERVER_SKILL_ACTION> };
  [SERVER_EVENT.DICTATION_USE]: { duration: Values<typeof SERVER_DICTATION_DURATION> };
  [SERVER_EVENT.MEMORY_FORGET]: Record<string, never>;
  [SERVER_EVENT.HOST_PAIRING_CHANGE]: { action: Values<typeof SERVER_HOST_PAIRING_ACTION> };
  [SERVER_EVENT.WORKSPACE_MEMBER_CHANGE]: { action: Values<typeof SERVER_WORKSPACE_MEMBER_ACTION> };
  [SERVER_EVENT.AUTOMATION_CHANGE]: {
    action: Values<typeof SERVER_AUTOMATION_CHANGE_ACTION>;
    source: Values<typeof SERVER_AUTOMATION_SOURCE>;
  };
  [SERVER_EVENT.AGENT_TOOL_OPEN]: { tool: Values<typeof SERVER_AGENT_TOOL> };
}

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

export type ServerEventActor<Name extends ServerEventName> = Name extends AccountEventName
  ? { readonly userId: string; readonly workspaceId?: never }
  : { readonly userId: string; readonly workspaceId: string };

interface ServerEvent<Name extends ServerEventName = ServerEventName> {
  readonly name: Name;
  readonly userId: string;
  readonly workspaceId?: string;
  readonly properties: ServerEventProperties[Name];
}

const GROUP_IDENTIFY_EVENT = "$groupidentify";

const WORKSPACE_GROUP_REFRESH_MS = 24 * 60 * 60_000;

const SERVER_EVENT_LIB = "vespin-service";

const SERVER_EVENT_TIMEOUT_MS = 2_000;

function stamped(properties: PosthogBatchItem["properties"], environment: string) {
  return {
    ...properties,
    $geoip_disable: true,
    $lib: SERVER_EVENT_LIB,
    platform: PRODUCT_PLATFORM.SERVER,
    environment,
  };
}

function serverEventItem(
  event: ServerEvent,
  person: PosthogPerson,
  now: number,
  environment: string,
): PosthogBatchItem {
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
        $set: person,
      },
      environment,
    ),
  };
}

function workspaceGroupProperties(face: WorkspaceFace): PosthogGroupFields {
  return { name: face.name, created_at: face.createdAt.toISOString() };
}

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
  readonly capture: (event: ServerEvent) => Effect.Effect<void>;
  readonly nameWorkspace: (userId: string, workspaceId: string) => Effect.Effect<void>;
}

class ProductAnalytics extends Context.Service<ProductAnalytics, ProductAnalyticsValues>()(
  "ProductAnalytics",
) {}

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
    const deployment = deploymentNamed(process.env[DEPLOYMENT_VARIABLE]);
    const named = new Map<string, number>();
    const post = (items: readonly PosthogBatchItem[]) =>
      postBatchEffect(
        { api_key: Redacted.value(key), historical_migration: false, batch: items },
        { ...(host === undefined ? undefined : { host }), timeoutMs: SERVER_EVENT_TIMEOUT_MS },
      ).pipe(Effect.provideService(HttpClient.HttpClient, client));
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
    return {
      capture: (event: ServerEvent) =>
        Effect.gen(function* () {
          const person = yield* readAccountPerson(event.userId).pipe(
            Effect.provideContext(database),
          );
          if (person === undefined) return;
          const now = yield* Clock.currentTimeMillis;
          const item = serverEventItem(
            event,
            { name: person.name, email: person.email },
            now,
            deployment,
          );
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

export function recordServerEvent<Name extends ServerEventName>(
  name: Name,
  actor: ServerEventActor<Name>,
  properties: ServerEventProperties[Name],
): Effect.Effect<void> {
  return recordServerEventOf(name, Effect.succeed(Option.some({ actor, properties })));
}

type WorkspaceEventName = Exclude<ServerEventName, AccountEventName>;

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
        actor: { userId, workspaceId } as ServerEventActor<Name>,
        properties,
      })),
    ),
  );
}

interface CountedRead<Name extends ServerEventName> {
  readonly actor: ServerEventActor<Name>;
  readonly properties: ServerEventProperties[Name];
}

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

export function workspaceRenamed(userId: string, workspaceId: string): Effect.Effect<void> {
  return Effect.flatMap(Effect.serviceOption(ProductAnalytics), (analytics) =>
    Option.isNone(analytics)
      ? Effect.void
      : afterResponse("workspace group", analytics.value.nameWorkspace(userId, workspaceId)),
  );
}

function turnOutcomeOf(turn: SettledAgentTurn): Values<typeof SERVER_TURN_OUTCOME> {
  if (turn.status === TURN_STATUS.SETTLED) return SERVER_TURN_OUTCOME.COMPLETED;
  if (turn.status === TURN_STATUS.CANCELED) return SERVER_TURN_OUTCOME.STOPPED;
  return turn.failure === TURN_FAILURE.ABANDONED
    ? SERVER_TURN_OUTCOME.ABANDONED
    : SERVER_TURN_OUTCOME.FAILED;
}

const TURN_FAILURE_WORDS: ReadonlySet<string> = new Set(Object.values(TURN_FAILURE));

function isTurnFailure(word: string | null): word is Values<typeof TURN_FAILURE> {
  return word !== null && TURN_FAILURE_WORDS.has(word);
}

function turnFailureOf(turn: SettledAgentTurn): Values<typeof SERVER_TURN_FAILURE> {
  return isTurnFailure(turn.failure) ? turn.failure : SERVER_TURN_FAILURE.UNKNOWN;
}

function turnDurationOf(ranMs: number): Values<typeof SERVER_TURN_DURATION> {
  const bucket = TURN_DURATION_BOUNDS.find(([, bound]) => ranMs < bound);
  return bucket === undefined ? SERVER_TURN_DURATION.OVER_4H : bucket[0];
}

export function dictationDurationOf(ms: number): Values<typeof SERVER_DICTATION_DURATION> {
  const bucket = DICTATION_DURATION_BOUNDS.find(([, bound]) => ms < bound);
  return bucket === undefined ? SERVER_DICTATION_DURATION.UNDER_2M : bucket[0];
}

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

const turnEndCounting = Layer.succeed(SettledTurnListener, { heard: turnEndCounted });

export const productAnalyticsFromEnvironment = productAnalyticsOfEnvironment;

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
