import type { HostedAutomationClient } from "@luke/features";
import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationDeletedView,
  type AutomationFollow,
  type AutomationFollowed,
  type AutomationListView,
  type AutomationRunsView,
  type AutomationRunView,
  type AutomationView,
  automationChangeParamsSchema,
  automationCreateParamsSchema,
  automationFollowSchema,
  automationIdParamsSchema,
  automationListParamsSchema,
  automationRunParamsSchema,
} from "@luke/features/automation-view";
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Data, Effect, FiberMap, Result, type Schema, type Scope } from "effect";
import { Base64Url, Hex } from "effect/encoding";
import * as HttpClient from "effect/http/HttpClient";
import { followAutomations } from "./automation-follow.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { confirmWrite, type LiveClient, openRealtimeClient, type TxWait } from "./live-follow.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-automations.ts -- the account's automations, asked of the service on the window's behalf: listed, made, changed, deleted, run now, and their runs read.
 *
 * Nothing is held here but the follows. Every ask is one call of the
 * service answered whole. What a window draws, a workspace's automations or
 * an automation's runs, it follows while drawn (`automation-follow.ts`) on
 * the service's live read for the account signed in as it started, each
 * change emitted as `AUTOMATIONS_CHANGED`; following again starts it
 * over, and letting it go, or a sign-out, ends it. Behind a closed account gate, or on a run
 * that sends nothing, every ask answers unanswered. A webhook's secret is
 * the one secret answered here, by root AGENTS.md's carve-out: one the
 * service minted as a webhook was made, or one minted here at the window's
 * ask, only its hash sent to the service, goes to the window that asked
 * and nowhere else.
 */

/** The service's side of the automations, as this concern asks it. */
export type AutomationsClient = Pick<
  HostedAutomationClient,
  | "list"
  | "create"
  | "change"
  | "remove"
  | "runNow"
  | "runs"
  | "replaceWebhookSecret"
  | "listLive"
  | "runsLive"
>;

export interface AutomationsDependencies {
  kernel: Pick<HostKernel, "emit" | "now" | "hostedServiceBaseUrl"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, which a follow names from its start; none where nobody is. */
  accountId: () => string | undefined;
  client: AutomationsClient;
  /** Realtime's client for a follow's subscription; Realtime's own where none is handed in. */
  openLive?: (url: string) => LiveClient | PromiseLike<LiveClient>;
}

export interface AutomationsComposer extends Composer {
  /** Every follow let go, as a sign-out lets them go. */
  readonly reset: Effect.Effect<void>;
}

/** The follows standing, one map per kind of what is followed, each by its id. */
type Follows = Readonly<Record<AutomationFollow["kind"], FiberMap.FiberMap<string>>>;

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** The bytes of randomness in a webhook secret the host mints, as many as the service's own. */
const WEBHOOK_SECRET_BYTES = 32;

/** A fresh webhook secret: its random bytes as unpadded URL-safe Base64. */
function mintedWebhookSecret(): string {
  return Base64Url.encode(crypto.getRandomValues(new Uint8Array(WEBHOOK_SECRET_BYTES)));
}

/** The secret's SHA-256 as lowercase hex, the one form of it the service holds. */
function webhookSecretHash(secret: string): Effect.Effect<string, WebhookSecretHashFailed> {
  return Effect.map(
    Effect.tryPromise({
      try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
      catch: (cause) => new WebhookSecretHashFailed({ cause }),
    }),
    (digest) => Hex.encode(new Uint8Array(digest)),
  );
}

/** Web Crypto refused to hash a minted webhook secret. */
class WebhookSecretHashFailed extends Data.TaggedError("WebhookSecretHashFailed")<{
  readonly cause: unknown;
}> {}

export function composeAutomations(
  dependencies: AutomationsDependencies,
): Effect.Effect<AutomationsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const follows: Follows = yield* Effect.all({
      workspace: FiberMap.make<string>(),
      runs: FiberMap.make<string>(),
    });
    return composed(dependencies, http, follows);
  });
}

/** The composer's one table, built from its seams; nothing here starts anything but what a window follows. */
function composed(
  dependencies: AutomationsDependencies,
  http: HttpClient.HttpClient,
  follows: Follows,
): AutomationsComposer {
  const { kernel, account, client } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
  /** Each standing follow's wait for a write's transaction, by what it follows and then its id. */
  const waits = {
    [AUTOMATION_FOLLOW.WORKSPACE]: new Map<string, TxWait>(),
    [AUTOMATION_FOLLOW.RUNS]: new Map<string, TxWait>(),
  };

  /**
   * A write confirmed once its transaction arrives on any of the follows
   * that would show it, as Neon's mutations guide says; a write that
   * changed nothing, or one no window follows over Realtime, waits for
   * nothing, and one not confirmed in time is answered all the same.
   */
  const confirmed = (txid: string | undefined, on: readonly (TxWait | undefined)[]) =>
    Effect.suspend(() => {
      const standing = on.filter((wait): wait is TxWait => wait !== undefined);
      return txid === undefined || standing.length === 0
        ? Effect.void
        : Effect.raceAll(standing.map((wait) => confirmWrite(wait, txid)));
    });

  /** The waits of the workspace an automation stands in, or of every workspace followed where it is not known. */
  const workspaceWaits = (workspaceId: string | undefined) =>
    workspaceId === undefined
      ? [...waits[AUTOMATION_FOLLOW.WORKSPACE].values()]
      : [waits[AUTOMATION_FOLLOW.WORKSPACE].get(workspaceId)];

  /** The service asked behind the gate, over the host's own HTTP client. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);

  /** The params read against the method's own schema, or the invalid-params refusal worded. */
  const read = <Params>(
    schema: Schema.Codec<Params, unknown>,
    params: Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0],
    sentence: string,
  ) => {
    const result = readEither(schema)(unparsedWire(params));
    return Result.isFailure(result) ? invalid(sentence) : Effect.succeed(result.success);
  };

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.AUTOMATIONS_LIST]: (params) =>
      Effect.gen(function* () {
        const list = yield* read(
          automationListParamsSchema,
          params,
          "a list names a task, a workspace, or neither",
        );
        return carried<AutomationListView>(yield* asked(client.list(list)));
      }),
    [GATEWAY_METHOD.AUTOMATIONS_CREATE]: (params) =>
      Effect.gen(function* () {
        const made = yield* read(
          automationCreateParamsSchema,
          params,
          "an automation names where it stands, a name, a trigger, and an action",
        );
        const answer = yield* asked(client.create(made));
        if ("automation" in answer) {
          yield* confirmed(answer.txid, workspaceWaits(answer.automation.workspaceId));
        }
        return carried<AutomationView>(answer);
      }),
    [GATEWAY_METHOD.AUTOMATIONS_CHANGE]: (params) =>
      Effect.gen(function* () {
        const change = yield* read(
          automationChangeParamsSchema,
          params,
          "a change names an automation and what changes",
        );
        const answer = yield* asked(client.change(change));
        if ("automation" in answer) {
          yield* confirmed(answer.txid, workspaceWaits(answer.automation.workspaceId));
        }
        return carried<AutomationView>(answer);
      }),
    [GATEWAY_METHOD.AUTOMATIONS_DELETE]: (params) =>
      Effect.gen(function* () {
        const named = yield* read(automationIdParamsSchema, params, "a delete names an automation");
        const answer = yield* asked(client.remove(named));
        // Note that a delete answers no workspace, so it is confirmed on whichever followed list had it.
        if ("deleted" in answer) yield* confirmed(answer.txid, workspaceWaits(undefined));
        return carried<AutomationDeletedView>(answer);
      }),
    [GATEWAY_METHOD.AUTOMATIONS_RUN]: (params) =>
      Effect.gen(function* () {
        const run = yield* read(
          automationRunParamsSchema,
          params,
          "a run names an automation and a key",
        );
        const answer = yield* asked(client.runNow(run));
        // A run stands in its automation's followed history and as the last run on a followed list.
        if ("run" in answer) {
          yield* confirmed(answer.txid, [
            waits[AUTOMATION_FOLLOW.RUNS].get(run.automationId),
            ...workspaceWaits(undefined),
          ]);
        }
        return carried<AutomationRunView>(answer);
      }),
    [GATEWAY_METHOD.AUTOMATIONS_NEW_WEBHOOK_SECRET]: (params) =>
      Effect.gen(function* () {
        const named = yield* read(
          automationIdParamsSchema,
          params,
          "a new secret names an automation",
        );
        if (!gate()) return carried<AutomationView>(UNANSWERED);
        // Note that the secret is minted here and only its hash leaves for the service, so the
        // service never holds it, and the window that asked is the one place it is answered.
        const secret = mintedWebhookSecret();
        // A secret that cannot be hashed is never sent, and the call is answered as unanswered.
        const hashed = yield* Effect.result(webhookSecretHash(secret));
        if (Result.isFailure(hashed)) return carried<AutomationView>(UNANSWERED);
        const replaced = yield* asked(
          client.replaceWebhookSecret({
            automationId: named.automationId,
            webhookSecretHash: hashed.success,
          }),
        );
        if ("failure" in replaced) return carried<AutomationView>(replaced);
        yield* confirmed(replaced.txid, workspaceWaits(replaced.automation.workspaceId));
        return carried<AutomationView>({ automation: replaced.automation, webhookSecret: secret });
      }),
    [GATEWAY_METHOD.AUTOMATIONS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* read(automationFollowSchema, params, "a follow names what it follows");
        // The account the follow starts for, which every read names, so one under another's session is refused as signed out and ends.
        // Behind a closed gate every read is told unanswered and asked again; with nobody signed in the follow ends unsaid.
        const userId = dependencies.accountId();
        /** The wait this follow last handed, which only it lets go of. */
        let handed: TxWait | undefined;
        const follow = followAutomations(
          {
            liveList: (workspaceId, poll, after) =>
              userId === undefined
                ? Effect.succeed(LIVE_SIGNED_OUT)
                : asked(client.listLive(workspaceId, userId, poll, after)),
            liveRuns: (automationId, poll, after) =>
              userId === undefined
                ? Effect.succeed(LIVE_SIGNED_OUT)
                : asked(client.runsLive(automationId, userId, poll, after)),
            openLive: dependencies.openLive ?? openRealtimeClient,
            now: kernel.now,
            serviceBaseUrl: kernel.hostedServiceBaseUrl,
            publish: (followed: AutomationFollowed) =>
              kernel.emit(GATEWAY_EVENT.AUTOMATIONS_CHANGED, carried(followed)),
            // Note that a follow lets go only of its own wait, since one started over may hand its wait first.
            onTxWait: (wait) => {
              const standing = waits[scope.kind];
              if (wait !== undefined) standing.set(scope.id, wait);
              else if (standing.get(scope.id) === handed) standing.delete(scope.id);
              handed = wait;
            },
          },
          scope,
        );
        // Following again starts over, so a window that opens on what another already follows hears it at once.
        yield* FiberMap.run(follows[scope.kind], scope.id, follow);
        return {};
      }),
    [GATEWAY_METHOD.AUTOMATIONS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* read(automationFollowSchema, params, "a follow names what it follows");
        yield* FiberMap.remove(follows[scope.kind], scope.id);
        return {};
      }),
    [GATEWAY_METHOD.AUTOMATIONS_RUNS]: (params) =>
      Effect.gen(function* () {
        const named = yield* read(automationIdParamsSchema, params, "a read names an automation");
        return carried<AutomationRunsView>(yield* asked(client.runs(named)));
      }),
  };

  const reset = Effect.andThen(FiberMap.clear(follows.workspace), FiberMap.clear(follows.runs));

  return { methods, lifetime: Effect.void, reset };
}
