import type { HostedAutomationClient } from "@repo/features";
import {
  AUTOMATION_RUNS_READ,
  AUTOMATION_WORKSPACE_RUNS_READ,
  AUTOMATIONS_READ,
  automationRunsGraceEdge,
  automationRunsOfLiveRows,
  automationWorkspaceRunsGraceEdge,
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
  type AutomationView,
} from "@repo/features/automation-view";
import { LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  declaredWrite,
  type EntityPool,
  type FieldChange,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import { Data, Effect, Result, type Scope } from "effect";
import { Base64Url, Hex } from "effect/encoding";
import * as HttpClient from "effect/http/HttpClient";
import { type AppHostReads, NO_KEYS_HELD } from "./app-state.js";
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
import { type AUTOMATION_ACTS, AUTOMATION_FOLLOWS } from "./contract/index.js";
import { type EntityStore, KEPT_READ } from "./entity-store.js";
import { type HostActTable, liveTold } from "./host-acts.js";
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
 * window draws, and told on it (`liveTold`). A sign-out lets every
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
  "create" | "change" | "remove" | "runNow" | "replaceWebhookSecret" | "liveRead"
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
  /** The signed-in account's lists kept on disk, which a workspace's automations are drawn from before its read first answers, and each answer is kept in; none where nothing keeps them. */
  entities?: () => EntityStore | undefined;
}

export interface AutomationsComposer extends Composer {
  /** The automations' plain asks and live follow, answered directly as the panel's port asks them. */
  readonly acts: HostActTable<typeof AUTOMATION_ACTS> & HostActTable<typeof AUTOMATION_FOLLOWS>;
  /** Every held read followed anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Every follow let go and no read laid, as a sign-out lets them go; the windows' holds stand. */
  readonly reset: Effect.Effect<void>;
}

/** One value for each kind of what the windows hold, by its kind. */
type ByKind<Value> = Readonly<Record<AutomationFollow["kind"], Value>>;

/** Each held read's standing wait for a write's transaction, by what it holds and then its id. */
type Waits = ByKind<Map<string, TxWait>>;

/** What the composer holds for the windows: each held read, the follows' waits, and the list collections standing. */
interface Held {
  readonly slices: ByKind<HeldSlice<string>>;
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
          // Note that the automations kept on disk are drawn as the service last answered them, until the read answers anew.
          const kept = dependencies.entities?.()?.storedIn(KEPT_READ.AUTOMATIONS, workspaceId);
          if (kept !== undefined) yield* list.answer(kept);
          // Note that a follow lets go only of its own list, since one started over may stand first.
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (lists.get(workspaceId) === list) lists.delete(workspaceId);
            }),
          );
          yield* followAutomationRead(AUTOMATIONS_READ.rows, {
            live: (poll, after) =>
              sealed(userId, (user) =>
                client.liveRead(
                  AUTOMATIONS_READ,
                  { workspaceId, userId: user },
                  poll ? { after } : undefined,
                ),
              ),
            take: (rows) =>
              Effect.andThen(
                list.answer(rows),
                Effect.suspend(
                  () =>
                    dependencies.entities?.()?.keepIn(KEPT_READ.AUTOMATIONS, workspaceId, rows) ??
                    Effect.void,
                ),
              ),
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
            followAutomationRead(AUTOMATION_RUNS_READ.rows, {
              live: (poll, after) =>
                sealed(userId, (user) =>
                  client.liveRead(
                    AUTOMATION_RUNS_READ,
                    { id: automationId, userId: user },
                    poll ? { after } : undefined,
                  ),
                ),
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
            followAutomationRead(AUTOMATION_WORKSPACE_RUNS_READ.rows, {
              live: (poll, after) =>
                sealed(userId, (user) =>
                  client.liveRead(
                    AUTOMATION_WORKSPACE_RUNS_READ,
                    { workspaceId, userId: user },
                    poll ? { after } : undefined,
                  ),
                ),
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
    const follow = AUTOMATION_FOLLOWS.AUTOMATIONS_FOLLOW;
    // Note that each held read is keyed by one id, its slice laid whole as it moves.
    const slices: Held["slices"] = yield* Effect.all({
      [AUTOMATION_FOLLOW.WORKSPACE]: heldSlice<typeof LIVE_READ.AUTOMATIONS, string>({
        empty: NO_KEYS_HELD,
        path: (workspaceId) => [workspaceId],
        gate,
        follow: follows[AUTOMATION_FOLLOW.WORKSPACE],
        tell: liveTold(kernel.emit, follow, LIVE_READ.AUTOMATIONS),
      }),
      [AUTOMATION_FOLLOW.RUNS]: heldSlice<typeof LIVE_READ.AUTOMATION_RUNS, string>({
        empty: NO_KEYS_HELD,
        path: (automationId) => [automationId],
        gate,
        follow: follows[AUTOMATION_FOLLOW.RUNS],
        tell: liveTold(kernel.emit, follow, LIVE_READ.AUTOMATION_RUNS),
      }),
      [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: heldSlice<
        typeof LIVE_READ.AUTOMATION_WORKSPACE_RUNS,
        string
      >({
        empty: NO_KEYS_HELD,
        path: (workspaceId) => [workspaceId],
        gate,
        follow: follows[AUTOMATION_FOLLOW.WORKSPACE_RUNS],
        tell: liveTold(kernel.emit, follow, LIVE_READ.AUTOMATION_WORKSPACE_RUNS),
      }),
    });
    return composed(dependencies, gate, asked, { slices, waits, lists });
  });
}

/** The composer's one table, built from its seams; nothing here starts anything but what a window holds. */
function composed(
  dependencies: AutomationsDependencies,
  gate: () => boolean,
  asked: Asked,
  { slices, waits, lists }: Held,
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
    AutomationView
  > = {
    kind: AUTOMATION,
    keys: ({ request, row }) => (row === undefined ? [] : [request.id]),
    // Note that a create that draws no row names no key, so its change is never drawn.
    change: ({ row }) => (row === undefined ? () => ({}) : { made: row }),
    send: ({ request }) =>
      Effect.map(asked(client.create(request)), (answer) =>
        "automation" in answer
          ? { answer, txid: answer.txid, taken: { made: answeredRow(answer.automation) } }
          : { refused: answer },
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
    AutomationView
  > = {
    kind: AUTOMATION,
    keys: (change) => [change.automationId],
    change: (change) => () => changedFields(change.change),
    send: (change) =>
      Effect.map(asked(client.change(change)), (answer) =>
        "automation" in answer
          ? { answer, txid: answer.txid, taken: () => writtenFields(answer.automation) }
          : { refused: answer },
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
    AutomationDeletedView
  > = {
    kind: AUTOMATION,
    keys: (named) => [named.automationId],
    change: () => () => ROW_GONE,
    send: (named) =>
      Effect.map(asked(client.remove(named)), (answer) =>
        "deleted" in answer ? { answer, txid: answer.txid } : { refused: answer },
      ),
  };

  /** The automations' plain asks, answered as the panel's port asks them (`AUTOMATION_ACTS`). */
  const acts: AutomationsComposer["acts"] = {
    AUTOMATIONS_CREATE: declaredWrite(dependencies.pool, made, {
      read: (asked: AutomationCreateParams) =>
        Effect.sync(() => {
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
        }),
    }),
    AUTOMATIONS_CHANGE: declaredWrite(dependencies.pool, changed),
    AUTOMATIONS_DELETE: declaredWrite(dependencies.pool, deleted),
    AUTOMATIONS_RUN: (run) =>
      Effect.gen(function* () {
        const answer = yield* asked(client.runNow(run));
        // A run stands in its automation's held runs, in its workspace's held runs, and as the last run on a held list; with none of them held it answers at once.
        if ("run" in answer) {
          yield* confirmed(answer.txid, waitsShowing(run.automationId, undefined, true));
        }
        return answer;
      }),
    // A webhook trigger's secret is minted again here, its hash sent to the service, and the secret answered once to the window that asked (root AGENTS.md's carve-out).
    AUTOMATIONS_NEW_WEBHOOK_SECRET: (named) =>
      Effect.gen(function* () {
        if (!gate()) return UNANSWERED;
        // Note that the secret is minted here and only its hash leaves for the service, so the
        // service never holds it, and the window that asked is the one place it is answered.
        const secret = mintedWebhookSecret();
        // A secret that cannot be hashed is never sent, and the call is answered as unanswered.
        const hashed = yield* Effect.result(webhookSecretHash(secret));
        if (Result.isFailure(hashed)) return UNANSWERED;
        const replaced = yield* asked(
          client.replaceWebhookSecret({
            automationId: named.automationId,
            webhookSecretHash: hashed.success,
          }),
        );
        if ("failure" in replaced) return replaced;
        yield* confirmed(
          replaced.txid,
          waitsShowing(replaced.automation.id, replaced.automation.workspaceId, false),
        );
        return { automation: replaced.automation, webhookSecret: secret };
      }),
    // What a key names is held for the windows while an Automations page draws it, its slice by its kind.
    AUTOMATIONS_FOLLOW: {
      hold: ({ kind, id }) => slices[kind].hold(id),
      retry: ({ kind, id }) => slices[kind].retry(id),
    },
  };

  const kinds = Object.values(AUTOMATION_FOLLOW);
  // Note that the windows' holds stand through a sign-out, so a session signing in follows them anew (`open`).
  const reset = Effect.forEach(kinds, (kind) => slices[kind].end, { discard: true });
  const open = Effect.forEach(kinds, (kind) => slices[kind].open, { discard: true });

  return { methods: {}, acts, lifetime: Effect.void, open, reset };
}
