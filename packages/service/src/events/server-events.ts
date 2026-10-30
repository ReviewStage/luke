import { settledTurnAgentKind } from "@luke/database/models/agent-store";
import { type SettledAgentTurn, SettledTurnListener } from "@luke/database/models/writer";
import { PULL_REQUEST_CHAPTERS_FAILURE } from "@luke/database/pull-request-chapters-vocabulary";
import type { ConversationRuntime } from "@luke/database/storage-vocabulary";
import type { AgentKind, AgentMachineKind } from "@luke/features/agent-wire";
import type { AutomationFiringKind, AutomationTriggerKind } from "@luke/features/automation-wire";
import type { IntegrationProvider } from "@luke/features/integration-wire";
import { TURN_FAILURE } from "@luke/features/turn-run";
import type { INVITATION_ROLE } from "@luke/features/workspace-invitation-wire";
import { TURN_STATUS } from "@luke/wire";
import { Clock, Context, Effect, Layer, Option, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { PRODUCT_PLATFORM } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { afterResponse } from "../http/after-response.js";
import { type PosthogBatch, postBatchEffect } from "../providers/posthog.js";

/**
 * What Luke's service counts about the work done through it: the core loop the
 * desktop cannot see, because it happens on the service or in an agent's
 * sandbox — a task started, a coding agent started, a member's message to it,
 * each of its turns ended, a Stop, an archive, a pull request opened and
 * merged, an automation made, an integration connected.
 *
 * It holds to the desktop's counted events' rule
 * (`@luke/features/analytics`'s `product-events.ts`): an event is a name from
 * this file, and every property is one of this file's fixed words, a boolean,
 * a count, or an id from a catalog the service itself checked (a provider, a
 * model, an effort). Nothing typed, nothing a model wrote, and no title, branch,
 * repository, prompt, or row id has a property it could travel in, which the
 * types below enforce at each call site.
 *
 * What it counts of a team is the member's own act: a thread post or a plan
 * edit or comment an agent made, through its own tools, is left out rather
 * than counted under the member who started the agent, so a count of posts is
 * a count of people talking, and an agent's work is the agent events'.
 *
 * The events are joined to the same person the desktop's are, by the account's
 * own user id, so PostHog's funnels run from the site's sign-in through the
 * desktop's counts to the work itself; and erased with them on account
 * deletion, which deletes by that id.
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
} as const;

type ServerEventName = (typeof SERVER_EVENT)[keyof typeof SERVER_EVENT];

/** Where a task was started from: the sidebar's own Start, or an agent's tool. */
export const SERVER_TASK_SOURCE = {
  SIDEBAR: "sidebar",
  AGENT: "agent",
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
 * (`fresh`). What the warm window (`CODER.RUNNER_WARM`) is tuned by.
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

/** What kind of machine first connected: a Linux box on an install token, or the Mac's own desktop. */
export const SERVER_HOST_KIND = {
  LUKE_HOST: "luke_host",
  THIS_MAC: "this_mac",
} as const;

type Values<T> = T[keyof T];

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
    has_task: boolean;
    /** What the agent is, so a member's operator, started with no task, is not counted as a taskless coder. */
    agent_kind: AgentKind;
  };
  [SERVER_EVENT.PULL_REQUEST_CREATE]: {
    opened_as: Values<typeof SERVER_PULL_REQUEST_OPENER>;
    is_draft: boolean;
  };
  [SERVER_EVENT.INBOX_ANSWER_SEND]: Record<string, never>;
  [SERVER_EVENT.AUTOMATION_CREATE]: { trigger_kind: AutomationTriggerKind };
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
  /** A member's own message to an agent: what answers it, where it runs, what it is, and whether a turn was under way. */
  [SERVER_EVENT.MESSAGE_SEND]: {
    runtime: ConversationRuntime;
    machine: AgentMachineKind;
    agent_kind: AgentKind;
    turn_running: boolean;
  };
  [SERVER_EVENT.TURN_END]: {
    outcome: Values<typeof SERVER_TURN_OUTCOME>;
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
}

/** One event as the service records it. */
interface ServerEvent<Name extends ServerEventName = ServerEventName> {
  readonly name: Name;
  readonly userId: string;
  readonly properties: ServerEventProperties[Name];
}

/** The `$lib` every server-recorded event is stamped with, beside the desktop's own. */
const SERVER_EVENT_LIB = "luke-service";

/**
 * How long one capture may take. It runs once the request has answered
 * (`recordServerEvent`), the instance kept awake for it, and is bounded so a
 * slow processor costs a count rather than an instance held open.
 */
const SERVER_EVENT_TIMEOUT_MS = 2_000;

/** The one item a server event posts, under the same privacy fields the desktop's batch carries. */
function serverEventBatch(event: ServerEvent, projectApiKey: string, now: number): PosthogBatch {
  return {
    api_key: projectApiKey,
    historical_migration: false,
    batch: [
      {
        event: event.name,
        distinct_id: event.userId,
        timestamp: new Date(now).toISOString(),
        properties: {
          ...event.properties,
          // Without it an event with no address resolves to the data centre's.
          $geoip_disable: true,
          $lib: SERVER_EVENT_LIB,
          platform: PRODUCT_PLATFORM.SERVER,
        },
      },
    ],
  };
}

interface ProductAnalyticsValues {
  /** Records one event, or does nothing; it never fails and never names the key. */
  readonly capture: (event: ServerEvent) => Effect.Effect<void>;
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
 * nothing, the same kill switch `/api/events` has.
 */
const productAnalyticsOfEnvironment = Layer.effect(
  ProductAnalytics,
  Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const client = yield* HttpClient.HttpClient;
    const key = environment.posthogProjectApiKey;
    if (key === undefined) return { capture: () => Effect.void };
    const host = environment.posthogIngestHost;
    return {
      capture: (event: ServerEvent) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* postBatchEffect(serverEventBatch(event, Redacted.value(key), now), {
            ...(host === undefined ? undefined : { host }),
            timeoutMs: SERVER_EVENT_TIMEOUT_MS,
          });
        }).pipe(Effect.provideService(HttpClient.HttpClient, client), Effect.ignore),
    };
  }),
);

/**
 * Counts one event where the work was committed. Typed per event, so a call
 * site can only hand over that event's own properties; a runtime without
 * `ProductAnalytics` makes this a no-op. The capture runs once the request
 * has answered (`after-response.ts`), so no answer waits on PostHog; a
 * runtime that runs nothing past its answers captures it in place.
 */
export function recordServerEvent<Name extends ServerEventName>(
  name: Name,
  userId: string,
  properties: ServerEventProperties[Name],
): Effect.Effect<void> {
  return recordServerEventOf(name, userId, Effect.succeed(Option.some(properties)));
}

/**
 * Counts one event whose properties are read once the request has answered,
 * or counts nothing where that read finds none or fails, so a read the count
 * needs never holds or fails the work it follows.
 */
function recordServerEventOf<Name extends ServerEventName, E, R>(
  name: Name,
  userId: string,
  properties: Effect.Effect<Option.Option<ServerEventProperties[Name]>, E, R>,
): Effect.Effect<void, never, R> {
  return Effect.flatMap(Effect.serviceOption(ProductAnalytics), (analytics) =>
    Option.isNone(analytics)
      ? Effect.void
      : afterResponse(
          name,
          Effect.flatMap(properties, (read) =>
            Option.isNone(read)
              ? Effect.void
              : // SAFETY: `read` is typed as this `name`'s own entry above; the
                // union `ServerEvent` widens the pairing TypeScript cannot follow.
                analytics.value.capture({ name, userId, properties: read.value } as ServerEvent),
          ),
        ),
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

function turnDurationOf(ranMs: number): Values<typeof SERVER_TURN_DURATION> {
  const bucket = TURN_DURATION_BOUNDS.find(([, bound]) => ranMs < bound);
  return bucket === undefined ? SERVER_TURN_DURATION.OVER_4H : bucket[0];
}

/**
 * Counts every agent turn the store writer settled, wherever it was settled:
 * the relay's or a runner's own end, a lost runner's or ended session's, and
 * the sweep's abandon alike, since each is the one write that moved the turn
 * to its end and a repeat of it settles nothing. It is counted under the
 * account the turn stands in, the agent's starter, as `agent:start` is, so an
 * automation's run counts under its owner. The agent's kind is read once the
 * request has answered, by then past any transaction the settle ran inside,
 * and only where the turn still stands ended, so a settle that transaction
 * rolled back is not counted.
 */
const turnEndCounting = Layer.succeed(SettledTurnListener, {
  heard: (turn) =>
    recordServerEventOf(
      SERVER_EVENT.TURN_END,
      turn.userId,
      Effect.map(
        settledTurnAgentKind(turn.turnId),
        Option.map((agentKind) => ({
          outcome: turnOutcomeOf(turn),
          duration: turnDurationOf(turn.ranMs),
          agent_kind: agentKind,
        })),
      ),
    ),
});

/** The deployment's analytics as `productAnalyticsOfEnvironment` posts them, with the store's settled turns counted through them. */
export const productAnalyticsFromEnvironment = Layer.merge(
  productAnalyticsOfEnvironment,
  turnEndCounting,
);

/**
 * Analytics that keeps what it was handed rather than posting it, for a test
 * that asserts what an endpoint counted, the store's settled turns among it.
 */
export function recordingProductAnalytics() {
  const recorded: ServerEvent[] = [];
  const layer = Layer.merge(
    Layer.succeed(ProductAnalytics, {
      capture: (event) => Effect.sync(() => void recorded.push(event)),
    }),
    turnEndCounting,
  );
  return { layer, recorded };
}
