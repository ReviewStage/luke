import type { HostedAutomationClient } from "@repo/features";
import {
  automationRunsGraceEdge,
  automationRunsLiveRowsSchema,
  automationRunsOfLiveRows,
  automationsLiveRowsSchema,
  automationWorkspaceRunsGraceEdge,
  automationWorkspaceRunsLiveRowsSchema,
  automationWorkspaceRunsOfLiveRows,
} from "@repo/features/automation-live";
import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationDeletedView,
  type AutomationFollow,
  type AutomationIdParams,
  type AutomationRunView,
  type AutomationView,
  automationChangeParamsSchema,
  automationCreateParamsSchema,
  automationFollowSchema,
  automationIdParamsSchema,
  automationRunParamsSchema,
} from "@repo/features/automation-view";
import { LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, readParams } from "@repo/gateway";
import {
  declaredMethod,
  type EntityPool,
  type FieldChange,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import type { WireRecord, WireValue } from "@repo/wire";
import { Data, Effect, FiberMap, Result, type Scope } from "effect";
import { Base64Url, Hex } from "effect/encoding";
import * as HttpClient from "effect/http/HttpClient";
import { type AppAutomationReads, type AppHostReads, NO_KEYS_HELD } from "./app-state.js";
import {
  AUTOMATION,
  type AutomationListCollections,
  type AutomationRow,
  answeredRow,
  askedRow,
  automationListCollections,
  changedFields,
  writtenFields,
} from "./automation-collections.js";
import { followAutomationRead, historyAtEdges } from "./automation-follow.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostMethodTable } from "./gateway-door.js";
import type { HostKernel } from "./host-kernel.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import { confirmWrite, type TxWait } from "./live-follow.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-automations.ts -- the account's automations, asked of the service on the window's behalf: made, changed, deleted, and run now, and a workspace's automations, its runs, and an automation's runs held for the windows that draw them.
 *
 * Every ask is one call of the service answered whole. What a window
 * draws, a workspace's automations, an automation's runs, or a workspace's
 * runs, it holds (`heldSlice`): the host follows each on the service's live
 * read (`automation-follow.ts`) for the account signed in as it started,
 * from the first window's hold, and keeps it among the few let go latest
 * after the last lets go, each laid on its app-state slice, which every
 * window draws, and told as `AUTOMATIONS_CHANGED`. A sign-out lets every
 * follow go and lays none, and the account gate opening follows the holds
 * anew (`open`). A held workspace's automations stand in the sync engine's
 * pool (`automation-collections.ts`). A new one, a change, or a deletion of
 * one is a write declared here, which the pool draws over every read
 * holding it the moment it is asked, a new one under the id the host minted
 * for it, each answered once the list drawn shows it. Behind a closed account
 * gate, or on a run that sends nothing, every ask answers unanswered. A
 * webhook's secret is the one secret answered here, by root AGENTS.md's
 * carve-out: one the service minted as a webhook was made, or one minted
 * here at the window's ask, only its hash sent to the service, goes to the
 * window that asked and nowhere else, never into a slice.
 */

/** The service's side of the automations, as this concern asks it. */
export type AutomationsClient = Pick<
  HostedAutomationClient,
  | "create"
  | "change"
  | "remove"
  | "runNow"
  | "replaceWebhookSecret"
  | "listLive"
  | "runsLive"
  | "workspaceRunsLive"
>;

export interface AutomationsDependencies {
  kernel: Pick<HostKernel, "emit" | "now" | "createId" | "hostedServiceBaseUrl"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, which a follow names from its start; none where nobody is. */
  accountId: () => string | undefined;
  client: AutomationsClient;
  /** The sync engine's pool, which a held workspace's automations stand in. */
  pool: EntityPool;
}

export interface AutomationsComposer extends Composer {
  /** Every held read followed anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Every follow let go and no read laid, as a sign-out lets them go; the windows' holds stand. */
  readonly reset: Effect.Effect<void>;
}

/** One value for each kind of what the windows hold, by its kind. */
type ByKind<Value> = Readonly<Record<AutomationFollow["kind"], Value>>;

/** Each held read's standing wait for a write's transaction, by what it holds and then its id. */
type Waits = ByKind<Map<string, TxWait>>;

/** What the composer holds for the windows: each held read, the windows' hold on each key, the follows' waits, and the list collections standing. */
interface Held {
  readonly slices: ByKind<HeldSlice<string>>;
  /** The windows' hold on each key, one fiber standing until let go. */
  readonly holds: ByKind<FiberMap.FiberMap<string>>;
  readonly waits: Waits;
  /** Each followed workspace's automations standing in the pool, by the workspace's id, for as long as its follow stands. */
  readonly lists: Map<string, AutomationListCollections>;
}

/** Each held read's follow of one key, its rows told through `answers`, by what it holds. */
interface AutomationFollows {
  readonly [AUTOMATION_FOLLOW.WORKSPACE]: (
    workspaceId: string,
    answers: HeldAnswers<AppHostReads[typeof LIVE_READ.AUTOMATIONS]>,
  ) => Effect.Effect<void>;
  readonly [AUTOMATION_FOLLOW.RUNS]: (
    automationId: string,
    answers: HeldAnswers<AppHostReads[typeof LIVE_READ.AUTOMATION_RUNS]>,
  ) => Effect.Effect<void>;
  readonly [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: (
    workspaceId: string,
    answers: HeldAnswers<AppHostReads[typeof LIVE_READ.AUTOMATION_WORKSPACE_RUNS]>,
  ) => Effect.Effect<void>;
}

/** A call of the service asked behind the gate, or unanswered where the gate stands closed. */
type Asked = <Answer>(
  call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
) => Effect.Effect<Answer | typeof UNANSWERED>;

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

/**
 * A follow's hand-off of its wait for a write's transaction to the waits of
 * what it follows, and the wait it last handed. Note that a follow lets go
 * only of its own wait, since one started over may hand its wait first.
 */
function handing(standing: Map<string, TxWait>, id: string) {
  let handed: TxWait | undefined;
  return {
    onTxWait: (wait: TxWait | undefined) => {
      if (wait !== undefined) standing.set(id, wait);
      else if (standing.get(id) === handed) standing.delete(id);
      handed = wait;
    },
    handed: () => handed,
  };
}

/**
 * Each held read's follow of one key, its rows told through `answers`: a
 * workspace's automations in a collection for as long as its follow
 * stands, which a write to one is drawn on, and a history built at the
 * host's own instant and again at each edge of a run's agent's grace. Each
 * names the account signed in as it starts, so one under another's session
 * is refused as signed out and ends; with nobody signed in it ends unsaid.
 */
function automationFollows(
  dependencies: AutomationsDependencies,
  asked: Asked,
  waits: Waits,
  lists: Held["lists"],
): AutomationFollows {
  const { kernel, client } = dependencies;
  /** A live read for the account the follow started for, or refused as signed out where it started for nobody. */
  const sealed = <Answer>(
    userId: string | undefined,
    read: (userId: string) => Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ) => (userId === undefined ? Effect.succeed(LIVE_SIGNED_OUT) : asked(read(userId)));
  return {
    [AUTOMATION_FOLLOW.WORKSPACE]: (workspaceId, answers) => {
      const userId = dependencies.accountId();
      const wait = handing(waits[AUTOMATION_FOLLOW.WORKSPACE], workspaceId);
      return Effect.scoped(
        Effect.gen(function* () {
          const list = yield* automationListCollections({
            pool: dependencies.pool,
            workspaceId,
            draw: answers.answered,
            serviceBaseUrl: kernel.hostedServiceBaseUrl,
            txWait: wait.handed,
          });
          lists.set(workspaceId, list);
          // Note that a follow lets go only of its own list, since one started over may stand first.
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (lists.get(workspaceId) === list) lists.delete(workspaceId);
            }),
          );
          yield* followAutomationRead(automationsLiveRowsSchema, {
            live: (poll, after) =>
              sealed(userId, (user) => client.listLive(workspaceId, user, poll, after)),
            take: list.answer,
            unanswered: answers.unanswered,
            onTxWait: wait.onTxWait,
          });
        }),
      );
    },
    [AUTOMATION_FOLLOW.RUNS]: (automationId, answers) => {
      const userId = dependencies.accountId();
      const wait = handing(waits[AUTOMATION_FOLLOW.RUNS], automationId);
      return Effect.scoped(
        Effect.flatMap(
          historyAtEdges(automationRunsOfLiveRows, automationRunsGraceEdge, answers.answered),
          (take) =>
            followAutomationRead(automationRunsLiveRowsSchema, {
              live: (poll, after) =>
                sealed(userId, (user) => client.runsLive(automationId, user, poll, after)),
              take,
              unanswered: answers.unanswered,
              onTxWait: wait.onTxWait,
            }),
        ),
      );
    },
    [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: (workspaceId, answers) => {
      const userId = dependencies.accountId();
      const wait = handing(waits[AUTOMATION_FOLLOW.WORKSPACE_RUNS], workspaceId);
      return Effect.scoped(
        Effect.flatMap(
          historyAtEdges(
            automationWorkspaceRunsOfLiveRows,
            automationWorkspaceRunsGraceEdge,
            answers.answered,
          ),
          (take) =>
            followAutomationRead(automationWorkspaceRunsLiveRowsSchema, {
              live: (poll, after) =>
                sealed(userId, (user) => client.workspaceRunsLive(workspaceId, user, poll, after)),
              take,
              unanswered: answers.unanswered,
              onTxWait: wait.onTxWait,
            }),
        ),
      );
    },
  };
}

export function composeAutomations(
  dependencies: AutomationsDependencies,
): Effect.Effect<AutomationsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const { kernel, account } = dependencies;
    const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
    const asked: Asked = (call) =>
      gate()
        ? Effect.provideService(call, HttpClient.HttpClient, http)
        : Effect.succeed(UNANSWERED);
    const waits: Waits = {
      [AUTOMATION_FOLLOW.WORKSPACE]: new Map(),
      [AUTOMATION_FOLLOW.RUNS]: new Map(),
      [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: new Map(),
    };
    const lists: Held["lists"] = new Map();
    const follows = automationFollows(dependencies, asked, waits, lists);
    const told = (held: Partial<AppAutomationReads>) =>
      kernel.emit(GATEWAY_EVENT.AUTOMATIONS_CHANGED, carried(held));
    // Note that each held read is keyed by one id, its slice laid whole as it moves.
    const slices: Held["slices"] = yield* Effect.all({
      [AUTOMATION_FOLLOW.WORKSPACE]: heldSlice<typeof LIVE_READ.AUTOMATIONS, string>({
        empty: NO_KEYS_HELD,
        path: (workspaceId) => [workspaceId],
        gate,
        follow: follows[AUTOMATION_FOLLOW.WORKSPACE],
        tell: (held) => told({ [LIVE_READ.AUTOMATIONS]: held }),
      }),
      [AUTOMATION_FOLLOW.RUNS]: heldSlice<typeof LIVE_READ.AUTOMATION_RUNS, string>({
        empty: NO_KEYS_HELD,
        path: (automationId) => [automationId],
        gate,
        follow: follows[AUTOMATION_FOLLOW.RUNS],
        tell: (held) => told({ [LIVE_READ.AUTOMATION_RUNS]: held }),
      }),
      [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: heldSlice<
        typeof LIVE_READ.AUTOMATION_WORKSPACE_RUNS,
        string
      >({
        empty: NO_KEYS_HELD,
        path: (workspaceId) => [workspaceId],
        gate,
        follow: follows[AUTOMATION_FOLLOW.WORKSPACE_RUNS],
        tell: (held) => told({ [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: held }),
      }),
    });
    const holds: Held["holds"] = yield* Effect.all({
      [AUTOMATION_FOLLOW.WORKSPACE]: FiberMap.make<string>(),
      [AUTOMATION_FOLLOW.RUNS]: FiberMap.make<string>(),
      [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: FiberMap.make<string>(),
    });
    return composed(dependencies, gate, asked, { slices, holds, waits, lists });
  });
}

/** The composer's one table, built from its seams; nothing here starts anything but what a window holds. */
function composed(
  dependencies: AutomationsDependencies,
  gate: () => boolean,
  asked: Asked,
  { slices, holds, waits, lists }: Held,
): AutomationsComposer {
  const { kernel, client } = dependencies;

  /** The held list that holds an automation, and the workspace it is of; none where no held list holds it. */
  const listShowing = (automationId: string) => {
    for (const [workspaceId, list] of lists) {
      if (list.holds(automationId)) return { workspaceId, list };
    }
    return undefined;
  };

  /**
   * A write confirmed once its transaction arrives on every held read that
   * would show it, so no read the window draws after the answer lacks it; a
   * write that changed nothing, or one no held read hands a wait for, waits
   * for nothing, and one not confirmed in time is answered all the same.
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
   * The waits of the held reads that show a write to an automation: its
   * workspace's list, named or as a held list holds it, and, for a run, its
   * runs and its workspace's runs, each of which a run moves. Note that no
   * other read is waited on, since a read whose rows the write did not move
   * never carries its transaction and would only hold the write to its
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
   * An automation made, drawn the moment it is asked from what its create
   * asks, under the id the host minted for it, on its workspace's held list,
   * and taken back where the service refused it. Note that only its row
   * reaches the list, so a webhook's secret the service minted is answered
   * to the window alone; where the list hands no wait, or the service
   * answers a create sent again with no transaction, the automation as the
   * service answered it is taken in the list's place.
   */
  const made: WriteDeclaration<
    AutomationRow,
    FieldChange<AutomationRow>,
    {
      readonly request: AutomationCreateParams & { readonly id: string };
      readonly row: AutomationRow | undefined;
    },
    WireValue
  > = {
    kind: AUTOMATION,
    keys: ({ request, row }) => (row === undefined ? [] : [request.id]),
    // Note that a create that draws no row names no key, so its change is never drawn.
    change: ({ row }) => (row === undefined ? () => ({}) : { made: row }),
    send: ({ request }) =>
      Effect.map(asked(client.create(request)), (answer) =>
        "automation" in answer
          ? {
              answer: carried<AutomationView>(answer),
              txid: answer.txid,
              taken: { made: answeredRow(answer.automation) },
            }
          : { refused: carried<AutomationView>(answer) },
      ),
  };

  /**
   * A change to an automation's fields, drawn at once over every read that
   * holds it. Note that only the written fields reach the list, so a secret
   * a change to a webhook minted is answered to the window alone.
   */
  const changed: WriteDeclaration<
    AutomationRow,
    FieldChange<AutomationRow>,
    AutomationChangeParams,
    WireValue
  > = {
    kind: AUTOMATION,
    keys: (change) => [change.automationId],
    change: (change) => () => changedFields(change.change),
    send: (change) =>
      Effect.map(asked(client.change(change)), (answer) =>
        "automation" in answer
          ? {
              answer: carried<AutomationView>(answer),
              txid: answer.txid,
              taken: () => writtenFields(answer.automation),
            }
          : { refused: carried<AutomationView>(answer) },
      ),
  };

  /**
   * An automation deleted, gone at once from every read that holds it. Note
   * that a delete is confirmed on its list alone, since its runs' follow
   * ends not found rather than carrying it.
   */
  const deleted: WriteDeclaration<
    AutomationRow,
    FieldChange<AutomationRow>,
    AutomationIdParams,
    WireValue
  > = {
    kind: AUTOMATION,
    keys: (named) => [named.automationId],
    change: () => () => ROW_GONE,
    send: (named) =>
      Effect.map(asked(client.remove(named)), (answer) =>
        "deleted" in answer
          ? { answer: carried<AutomationDeletedView>(answer), txid: answer.txid }
          : { refused: carried<AutomationDeletedView>(answer) },
      ),
  };

  const methods: HostMethodTable = {
    [GATEWAY_METHOD.AUTOMATIONS_CREATE]: declaredMethod(
      dependencies.pool,
      made,
      (params: WireRecord) =>
        Effect.map(
          readParams(
            automationCreateParamsSchema,
            params,
            "an automation names where it stands, a name, a trigger, and an action",
          ),
          (asked) => {
            const request = { ...asked, id: asked.id ?? kernel.createId() };
            const userId = dependencies.accountId();
            // Note that a create behind a closed gate, or for nobody, draws nothing, since it never reaches the service.
            return {
              request,
              row:
                gate() && userId !== undefined
                  ? askedRow(request, { userId, at: kernel.now() })
                  : undefined,
            };
          },
        ),
    ),
    [GATEWAY_METHOD.AUTOMATIONS_CHANGE]: declaredMethod(
      dependencies.pool,
      changed,
      (params: WireRecord) =>
        readParams(
          automationChangeParamsSchema,
          params,
          "a change names an automation and what changes",
        ),
    ),
    [GATEWAY_METHOD.AUTOMATIONS_DELETE]: declaredMethod(
      dependencies.pool,
      deleted,
      (params: WireRecord) =>
        readParams(automationIdParamsSchema, params, "a delete names an automation"),
    ),
    [GATEWAY_METHOD.AUTOMATIONS_RUN]: (params) =>
      Effect.gen(function* () {
        const run = yield* readParams(
          automationRunParamsSchema,
          params,
          "a run names an automation and a key",
        );
        const answer = yield* asked(client.runNow(run));
        // A run stands in its automation's held runs, in its workspace's held runs, and as the last run on a held list; with none of them held it answers at once.
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
    // Note that the windows' hold on a key is one fiber standing until let go, so a window holding it again holds nothing anew.
    [GATEWAY_METHOD.AUTOMATIONS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const held = yield* readParams(
          automationFollowSchema,
          params,
          "a hold names what it holds",
        );
        yield* FiberMap.run(
          holds[held.kind],
          held.id,
          Effect.scoped(Effect.andThen(slices[held.kind].hold(held.id), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.AUTOMATIONS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const held = yield* readParams(
          automationFollowSchema,
          params,
          "a hold names what it holds",
        );
        yield* FiberMap.remove(holds[held.kind], held.id);
        return {};
      }),
    [GATEWAY_METHOD.AUTOMATIONS_RETRY]: (params) =>
      Effect.gen(function* () {
        const held = yield* readParams(
          automationFollowSchema,
          params,
          "reading again names what it reads",
        );
        yield* slices[held.kind].retry(held.id);
        return {};
      }),
  };

  const kinds = Object.values(AUTOMATION_FOLLOW);
  // Note that the windows' holds stand through a sign-out, so a session signing in follows them anew (`open`).
  const reset = Effect.forEach(kinds, (kind) => slices[kind].end, { discard: true });
  const open = Effect.forEach(kinds, (kind) => slices[kind].open, { discard: true });

  return { methods, lifetime: Effect.void, open, reset };
}
