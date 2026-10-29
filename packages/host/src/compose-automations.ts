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
  readParams,
} from "@luke/gateway";
import { Data, Effect, FiberMap, Result, type Scope } from "effect";
import { Base64Url, Hex } from "effect/encoding";
import * as HttpClient from "effect/http/HttpClient";
import {
  type AutomationListCollections,
  type AutomationRow,
  automationListCollections,
  changedFields,
  writtenFields,
} from "./automation-collections.js";
import { followAutomations } from "./automation-follow.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { ROW_GONE, type RowRefused, type RowWritten } from "./live-collection.js";
import { confirmWrite, type TxWait } from "./live-follow.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-automations.ts -- the account's automations, asked of the service on the window's behalf: listed, made, changed, deleted, run now, and their runs read.
 *
 * Nothing is held here but the follows. Every ask is one call of the
 * service answered whole. What a window draws, a workspace's automations, an
 * automation's runs, or a workspace's runs, it follows while drawn (`automation-follow.ts`) on
 * the service's live read for the account signed in as it started, each
 * change emitted as `AUTOMATIONS_CHANGED`; following again starts it
 * over, and letting it go, or a sign-out, ends it. A followed workspace's
 * automations stand in a collection (`automation-collections.ts`), which a
 * change or a deletion of one is drawn on the moment it is asked, and a new
 * one once the service has made it, each answered once the list drawn
 * shows it. Behind a closed account gate, or on a run
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
  | "workspaceRunsLive"
>;

export interface AutomationsDependencies {
  kernel: Pick<HostKernel, "emit" | "now" | "hostedServiceBaseUrl"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, which a follow names from its start; none where nobody is. */
  accountId: () => string | undefined;
  client: AutomationsClient;
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
      workspaceRuns: FiberMap.make<string>(),
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
    [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: new Map<string, TxWait>(),
  };

  /** Each followed workspace's automations in a collection, by the workspace's id, for as long as its follow stands. */
  const lists = new Map<string, AutomationListCollections>();

  /** The followed list that holds an automation, and the workspace it is of; none where no followed list holds it. */
  const listShowing = (automationId: string) => {
    for (const [workspaceId, list] of lists) {
      if (list.holds(automationId)) return { workspaceId, list };
    }
    return undefined;
  };

  /**
   * A write confirmed once its transaction arrives on every follow that
   * would show it, so no view the window draws after the answer lacks it; a
   * write that changed nothing, or one no follow hands a wait for, waits for
   * nothing, and one not confirmed in time is answered all the same.
   */
  const confirmed = (txid: string | undefined, on: readonly (TxWait | undefined)[]) =>
    Effect.suspend(() => {
      const standing = on.filter((wait): wait is TxWait => wait !== undefined);
      return txid === undefined
        ? Effect.void
        : Effect.asVoid(
            Effect.all(
              standing.map((wait) => confirmWrite(wait, txid)),
              { concurrency: "unbounded" },
            ),
          );
    });

  /**
   * The waits of the follows that show a write to an automation: its
   * workspace's list, named or as a followed list holds it, and, for a run,
   * its runs and its workspace's runs, each of which a run moves. Note that
   * no other follow is waited on, since a read whose rows the write did not
   * move never carries its transaction and would only hold the write to its
   * timeout.
   */
  const waitsShowing = (automationId: string, workspaceId: string | undefined, ran: boolean) => {
    const listed = workspaceId ?? listShowing(automationId)?.workspaceId;
    return [
      listed === undefined ? undefined : waits[AUTOMATION_FOLLOW.WORKSPACE].get(listed),
      ran ? waits[AUTOMATION_FOLLOW.RUNS].get(automationId) : undefined,
      ran && listed !== undefined ? waits[AUTOMATION_FOLLOW.WORKSPACE_RUNS].get(listed) : undefined,
    ];
  };

  /**
   * A change to an automation, or its deletion, drawn at once on the
   * followed list that holds it and standing until that list carries it
   * (`automation-collections.ts`); one no followed list holds is only
   * written, as no window draws it.
   */
  const writtenOver = <Answer>(
    automationId: string,
    change: () => Partial<AutomationRow> | typeof ROW_GONE,
    written: Effect.Effect<RowWritten<AutomationRow, Answer> | RowRefused<Answer>>,
  ): Effect.Effect<Answer> =>
    Effect.suspend(() => {
      const showing = listShowing(automationId);
      return showing === undefined
        ? Effect.map(written, (result) => ("refused" in result ? result.refused : result.answer))
        : showing.list.write(automationId, change, written);
    });

  /** The service asked behind the gate, over the host's own HTTP client. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.AUTOMATIONS_LIST]: (params) =>
      Effect.gen(function* () {
        const list = yield* readParams(
          automationListParamsSchema,
          params,
          "a list names a task, a workspace, or neither",
        );
        return carried<AutomationListView>(yield* asked(client.list(list)));
      }),
    [GATEWAY_METHOD.AUTOMATIONS_CREATE]: (params) =>
      Effect.gen(function* () {
        const made = yield* readParams(
          automationCreateParamsSchema,
          params,
          "an automation names where it stands, a name, a trigger, and an action",
        );
        const answer = yield* asked(client.create(made));
        // A new automation is drawn on its workspace's followed list before its create answers.
        if ("automation" in answer) {
          const { automation, txid } = answer;
          const list =
            automation.workspaceId === undefined ? undefined : lists.get(automation.workspaceId);
          if (list !== undefined) yield* list.made(automation, txid);
        }
        return carried<AutomationView>(answer);
      }),
    [GATEWAY_METHOD.AUTOMATIONS_CHANGE]: (params) =>
      Effect.gen(function* () {
        const change = yield* readParams(
          automationChangeParamsSchema,
          params,
          "a change names an automation and what changes",
        );
        return yield* writtenOver(
          change.automationId,
          () => changedFields(change.change),
          Effect.map(asked(client.change(change)), (answer) =>
            "automation" in answer
              ? {
                  answer: carried<AutomationView>(answer),
                  txid: answer.txid,
                  fields: writtenFields(answer.automation),
                }
              : { refused: carried<AutomationView>(answer) },
          ),
        );
      }),
    [GATEWAY_METHOD.AUTOMATIONS_DELETE]: (params) =>
      Effect.gen(function* () {
        const named = yield* readParams(
          automationIdParamsSchema,
          params,
          "a delete names an automation",
        );
        // Note that a delete is confirmed on its list alone, since its runs' follow ends not found rather than carrying it.
        return yield* writtenOver(
          named.automationId,
          () => ROW_GONE,
          Effect.map(asked(client.remove(named)), (answer) =>
            "deleted" in answer
              ? {
                  answer: carried<AutomationDeletedView>(answer),
                  txid: answer.txid,
                  fields: ROW_GONE,
                }
              : { refused: carried<AutomationDeletedView>(answer) },
          ),
        );
      }),
    [GATEWAY_METHOD.AUTOMATIONS_RUN]: (params) =>
      Effect.gen(function* () {
        const run = yield* readParams(
          automationRunParamsSchema,
          params,
          "a run names an automation and a key",
        );
        const answer = yield* asked(client.runNow(run));
        // A run stands in its automation's followed history, in its workspace's followed runs, and as the last run on a followed list.
        if ("run" in answer) {
          yield* confirmed(answer.txid, waitsShowing(run.automationId, undefined, true));
        }
        return carried<AutomationRunView>(answer);
      }),
    [GATEWAY_METHOD.AUTOMATIONS_NEW_WEBHOOK_SECRET]: (params) =>
      Effect.gen(function* () {
        const named = yield* readParams(
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
        yield* confirmed(
          replaced.txid,
          waitsShowing(replaced.automation.id, replaced.automation.workspaceId, false),
        );
        return carried<AutomationView>({ automation: replaced.automation, webhookSecret: secret });
      }),
    [GATEWAY_METHOD.AUTOMATIONS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* readParams(
          automationFollowSchema,
          params,
          "a follow names what it follows",
        );
        // The account the follow starts for, which every read names, so one under another's session is refused as signed out and ends.
        // Behind a closed gate every read is told unanswered and asked again; with nobody signed in the follow ends unsaid.
        const userId = dependencies.accountId();
        /** The wait this follow last handed, which only it lets go of. */
        let handed: TxWait | undefined;
        const told = (followed: AutomationFollowed) =>
          kernel.emit(GATEWAY_EVENT.AUTOMATIONS_CHANGED, carried(followed));
        /** A workspace's automations in a collection for as long as this follow stands, which a write to one is drawn on; none for a history. */
        const listed = Effect.gen(function* () {
          if (scope.kind !== AUTOMATION_FOLLOW.WORKSPACE) return undefined;
          const list = yield* automationListCollections({
            draw: (automations) => told({ scope, view: { automations } }),
            serviceBaseUrl: kernel.hostedServiceBaseUrl,
            txWait: () => handed,
          });
          lists.set(scope.id, list);
          // Note that a follow lets go only of its own list, since one started over may stand first.
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (lists.get(scope.id) === list) lists.delete(scope.id);
            }),
          );
          return list;
        });
        const follow = Effect.scoped(
          Effect.flatMap(listed, (list) =>
            followAutomations(
              {
                liveList: (workspaceId, poll, after) =>
                  userId === undefined
                    ? Effect.succeed(LIVE_SIGNED_OUT)
                    : asked(client.listLive(workspaceId, userId, poll, after)),
                liveRuns: (automationId, poll, after) =>
                  userId === undefined
                    ? Effect.succeed(LIVE_SIGNED_OUT)
                    : asked(client.runsLive(automationId, userId, poll, after)),
                liveWorkspaceRuns: (workspaceId, poll, after) =>
                  userId === undefined
                    ? Effect.succeed(LIVE_SIGNED_OUT)
                    : asked(client.workspaceRunsLive(workspaceId, userId, poll, after)),
                takeList: (rows) => (list === undefined ? Effect.void : list.answer(rows)),
                publish: told,
                // Note that a follow lets go only of its own wait, since one started over may hand its wait first.
                onTxWait: (wait) => {
                  const standing = waits[scope.kind];
                  if (wait !== undefined) standing.set(scope.id, wait);
                  else if (standing.get(scope.id) === handed) standing.delete(scope.id);
                  handed = wait;
                },
              },
              scope,
            ),
          ),
        );
        // Following again starts over, so a window that opens on what another already follows hears it at once.
        yield* FiberMap.run(follows[scope.kind], scope.id, follow);
        return {};
      }),
    [GATEWAY_METHOD.AUTOMATIONS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* readParams(
          automationFollowSchema,
          params,
          "a follow names what it follows",
        );
        yield* FiberMap.remove(follows[scope.kind], scope.id);
        return {};
      }),
    [GATEWAY_METHOD.AUTOMATIONS_RUNS]: (params) =>
      Effect.gen(function* () {
        const named = yield* readParams(
          automationIdParamsSchema,
          params,
          "a read names an automation",
        );
        return carried<AutomationRunsView>(yield* asked(client.runs(named)));
      }),
  };

  const reset = Effect.asVoid(
    Effect.all([
      FiberMap.clear(follows.workspace),
      FiberMap.clear(follows.runs),
      FiberMap.clear(follows.workspaceRuns),
    ]),
  );

  return { methods, lifetime: Effect.void, reset };
}
