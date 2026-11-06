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
import { type EntityStore, KEPT_READ } from "./entity-store.js";
import type { HostMethodTable } from "./gateway-door.js";
import type { HostKernel } from "./host-kernel.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import { confirmWrite, type TxWait } from "./live-follow.js";
import type { RunMode } from "./run-mode.js";

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
  accountId: () => string | undefined;
  client: AutomationsClient;
  pool: EntityPool;
  entities?: () => EntityStore | undefined;
}

export interface AutomationsComposer extends Composer {
  readonly open: Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
}

type ByKind<Value> = Readonly<Record<AutomationFollow["kind"], Value>>;

type Waits = ByKind<Map<string, TxWait>>;

interface Held {
  readonly slices: ByKind<HeldSlice<string>>;
  readonly holds: ByKind<FiberMap.FiberMap<string>>;
  readonly waits: Waits;
  readonly lists: Map<string, AutomationListCollections>;
}

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

type Asked = <Answer>(
  call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
) => Effect.Effect<Answer | typeof UNANSWERED>;

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

const WEBHOOK_SECRET_BYTES = 32;

function mintedWebhookSecret(): string {
  return Base64Url.encode(crypto.getRandomValues(new Uint8Array(WEBHOOK_SECRET_BYTES)));
}

function webhookSecretHash(secret: string): Effect.Effect<string, WebhookSecretHashFailed> {
  return Effect.map(
    Effect.tryPromise({
      try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
      catch: (cause) => new WebhookSecretHashFailed({ cause }),
    }),
    (digest) => Hex.encode(new Uint8Array(digest)),
  );
}

class WebhookSecretHashFailed extends Data.TaggedError("WebhookSecretHashFailed")<{
  readonly cause: unknown;
}> {}

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

function automationFollows(
  dependencies: AutomationsDependencies,
  asked: Asked,
  waits: Waits,
  lists: Held["lists"],
): AutomationFollows {
  const { kernel, client } = dependencies;
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
          const kept = dependencies.entities?.()?.storedIn(KEPT_READ.AUTOMATIONS, workspaceId);
          if (kept !== undefined) yield* list.answer(kept);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (lists.get(workspaceId) === list) lists.delete(workspaceId);
            }),
          );
          yield* followAutomationRead(automationsLiveRowsSchema, {
            live: (poll, after) =>
              sealed(userId, (user) => client.listLive(workspaceId, user, poll, after)),
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

function composed(
  dependencies: AutomationsDependencies,
  gate: () => boolean,
  asked: Asked,
  { slices, holds, waits, lists }: Held,
): AutomationsComposer {
  const { kernel, client } = dependencies;

  const listShowing = (automationId: string) => {
    for (const [workspaceId, list] of lists) {
      if (list.holds(automationId)) return { workspaceId, list };
    }
    return undefined;
  };

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

  const waitsShowing = (automationId: string, workspaceId: string | undefined, ran: boolean) => {
    const listed = workspaceId ?? listShowing(automationId)?.workspaceId;
    return [
      listed === undefined ? undefined : waits[AUTOMATION_FOLLOW.WORKSPACE].get(listed),
      ran ? waits[AUTOMATION_FOLLOW.RUNS].get(automationId) : undefined,
      ran && listed !== undefined ? waits[AUTOMATION_FOLLOW.WORKSPACE_RUNS].get(listed) : undefined,
    ];
  };

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
        const secret = mintedWebhookSecret();
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
  const reset = Effect.forEach(kinds, (kind) => slices[kind].end, { discard: true });
  const open = Effect.forEach(kinds, (kind) => slices[kind].open, { discard: true });

  return { methods, lifetime: Effect.void, open, reset };
}
