import { isDeepStrictEqual } from "node:util";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@sidecar/gateway";
import type { HostedPlanClient, PlanActivityFrame, PlanDraftFrame } from "@sidecar/hosted";
import { DRAW_ON_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import { connectGitHubPageAddress } from "@sidecar/hosted/connect-github-page";
import {
  IDLE_PLANNING_VIEW,
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanningDocument,
  type PlanningRepositoriesAnswer,
  type PlanningStartAnswer,
  type PlanningView,
  planningBoardSaveParamsSchema,
  planningSetFolderParamsSchema,
  planningStartRequestSchema,
} from "@sidecar/hosted/planning-view";
import { unparsedWire } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Option, Queue, Result, Schema, type Scope, Semaphore } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { type JsonStateFile, jsonStateFile } from "./json-state-file.js";
import { servePlanningCommands } from "./planning-commands.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-planning.ts -- the panel's named plans, read from the service: the list, the one active plan, and its document, drawn as the notetaker writes it during a call.
 *
 * Nothing here writes a document: the plan's notetaker is the one writer, on
 * the service. What this concern owes the panel is to show that write as it
 * happens. Every write happens during a planning call, and the notetaker's
 * drafts arrive on that call's own socket and are drawn in place: the list
 * and the open plan are read when the Plans tab shows, when a plan opens, and
 * when one starts, and never on a clock. The open plan's whiteboard is read
 * with its document, and again whenever the call's activity says a draw by
 * the planning model just settled or the planning model stopped working, since
 * a draw happens only inside its turn; the panel saves the board's scene
 * through here and the view takes the board as the service answered it. The
 * loops here are the open plan's folder commands (`planning-commands.ts`),
 * which the planning model asks this Mac to run, and those board reads.
 */

/** Opening or deleting a plan names it and nothing else. */
const planningOpenParamsSchema = Schema.Struct({ planId: Schema.NonEmptyString });

/** The folder of this Mac each plan reads, by plan id, as this Mac alone records it. */
export type PlanFolders = Readonly<Record<string, string>>;

const PLAN_FOLDERS_FILE = "plan-folders.json";

const planFoldersRecordSchema = Schema.Struct({
  folders: Schema.Record(Schema.String, Schema.String),
});

/** The record of each plan's folder, kept in the state root beside this Mac's other records. */
export function planFoldersFile(
  directory: () => string,
  report?: (message: string) => void,
): JsonStateFile<PlanFolders> {
  const decode = Schema.decodeUnknownOption(planFoldersRecordSchema);
  return jsonStateFile<PlanFolders>({
    directory,
    fileName: PLAN_FOLDERS_FILE,
    read: (record) => Option.getOrUndefined(Option.map(decode(record), (read) => read.folders)),
    write: (folders) => ({ folders }),
    ...(report !== undefined ? { report } : undefined),
  });
}

/** The service's side of the plans, as this concern asks it. */
export type PlanningClient = Pick<
  HostedPlanClient,
  | "list"
  | "open"
  | "create"
  | "delete"
  | "repositories"
  | "claimCommand"
  | "settleCommand"
  | "readBoard"
  | "saveBoard"
>;

export interface PlanningDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: PlanningClient;
  /** The folder of this Mac each plan reads (`planFoldersFile`); the service never holds one. */
  folders: JsonStateFile<PlanFolders>;
  /**
   * Ends the planning call standing about any plan but `keep`, and waits for
   * it to end; a desk session and the call about `keep` are left standing.
   */
  endPlanCall: (keep: string | undefined) => Effect.Effect<void>;
  /**
   * What opening the Connect GitHub page needs: the service it is on, the
   * account this Mac is signed in as, which the page links GitHub for and no
   * other, and the browser to open it in. The link itself happens there,
   * under the browser's own Luke session; this process never holds GitHub's
   * token.
   */
  connectGitHub: {
    serviceBaseUrl: string;
    accountId: () => Effect.Effect<string | undefined>;
    openExternal: (url: string) => Effect.Effect<void>;
  };
}

export interface PlanningComposer extends Composer {
  /** The view as this Mac holds it now. */
  snapshot: () => PlanningView;
  /** The one active plan, which a voice session binds to; nothing while the panel has none open. */
  activePlanId: () => string | undefined;
  /** Drops everything held, for a sign-out, and tells every client the panel has nothing. */
  reset: Effect.Effect<void>;
  /**
   * Shows a draft of the open plan the service's notetaker sent while a
   * planning call writes it, in place of the document held; a draft of any
   * other plan, or with no document of that plan held, is dropped.
   */
  showDraft: (draft: PlanDraftFrame) => void;
  /**
   * Shows what each part of Luke is doing on the call about the open plan,
   * as the service last said it; a word about any other plan is dropped.
   * Leaving or switching plans clears it, and the call's end says nothing
   * doing.
   */
  showActivity: (activity: PlanActivityFrame) => void;
}

/**
 * The panel's plans as one concern. The view is told to every client whole
 * whenever it moves, and exactly one plan is active at a time: opening or
 * starting one replaces whichever was, and a read still out for the replaced
 * plan is dropped when it lands. Only one plan is ever the spoken
 * conversation, so opening another plan, starting one, leaving the open plan,
 * or a sign-out ends the call about the plan that was open before anything
 * else moves. The Plans tab showing reads the list and the open plan again,
 * while the open plan and its call stand through the tab hiding. Behind a
 * closed account gate, or on a run that sends nothing, nothing is read.
 */
export const composePlanning = /* @__PURE__ */ Effect.fn("host/composePlanning")(function* (
  dependencies: PlanningDependencies,
): Effect.fn.Return<PlanningComposer, never, Scope.Scope> {
  const { kernel, account, client, folders, endPlanCall, connectGitHub } = dependencies;
  const idleView = (): PlanningView => ({ ...IDLE_PLANNING_VIEW, folders: folders.read() ?? {} });

  /** Records `folderPath` as the plan's folder on this Mac, and draws it. */
  function recordFolder(planId: string, folderPath: string): void {
    const recorded = folders.update((current) => ({ ...current, [planId]: folderPath }));
    write({ folders: recorded });
  }
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /**
   * One read of the service at a time, whichever ask made it. Note that the
   * answers are applied in the order the reads were made, because a list
   * that left before a plan started, or a document read that left before a
   * newer one, would otherwise land last and roll the view back.
   */
  const serial = (yield* Semaphore.make(1)).withPermits(1);

  let view: PlanningView = idleView();
  let published: PlanningView = view;

  function publish(): void {
    if (isDeepStrictEqual(view, published)) return;
    published = view;
    kernel.emit(GATEWAY_EVENT.PLANNING_CHANGED, carried(view));
  }

  function write(next: Partial<PlanningView>): void {
    view = { ...view, ...next };
    publish();
  }

  /** The view with no activity and no board, as a plan left behind leaves it. */
  function withoutActivity({
    activity: _activity,
    board: _board,
    ...rest
  }: PlanningView): PlanningView {
    return rest;
  }

  /** The plans whose board a settled draw may have moved, read one at a time by the loop below. */
  const boardReads = yield* Queue.sliding<string>(1);

  /** The document of `planId` as held now, if the held one is that plan's. */
  function heldPlanOf(planId: string): PlanningDocument["plan"] {
    const held = view.document.plan;
    return held?.id === planId ? held : undefined;
  }

  const readList = Effect.gen(function* () {
    const listed = yield* Effect.provide(client.list(), FetchHttpClient.layer);
    // A failed read keeps the list it last read: the panel says the read
    // failed beside the plans it already drew rather than emptying them.
    write(
      listed.ok
        ? { plans: listed.answer, listStatus: PLANNING_READ.READY }
        : { listStatus: PLANNING_READ.FAILED },
    );
  });

  /**
   * Reads the active plan's document. A copy of the same plan already held
   * stays drawn while the read is out, and stays drawn through a read that
   * failed, so a save redraws in place and a moment offline blanks nothing;
   * with no copy held, the failure is what the panel draws.
   */
  function readDocument(planId: string) {
    return Effect.gen(function* () {
      const held = heldPlanOf(planId);
      if (held === undefined) write({ document: { status: PLANNING_READ.READING } });
      const opened = yield* Effect.provide(client.open(planId), FetchHttpClient.layer);
      // Another plan opened while this read was out: its answer is not the panel's any more.
      if (view.activePlanId !== planId) return;
      if (opened.ok) {
        write({ document: { status: PLANNING_READ.READY, plan: opened.answer } });
        return;
      }
      if (opened.failure === PLAN_CALL_FAILURE.NOT_FOUND) {
        write({ document: { status: PLANNING_READ.MISSING } });
        return;
      }
      write({
        document:
          held === undefined
            ? { status: PLANNING_READ.FAILED }
            : { status: PLANNING_READ.READY, plan: held },
      });
    });
  }

  /** Reads the active plan's board; a failed read keeps the board drawn. */
  function readBoard(planId: string) {
    return Effect.gen(function* () {
      const board = yield* Effect.provide(client.readBoard(planId), FetchHttpClient.layer);
      if (board === undefined || view.activePlanId !== planId) return;
      write({ board });
    });
  }

  function showDraft(draft: PlanDraftFrame): void {
    const held = heldPlanOf(draft.planId);
    if (held === undefined || view.activePlanId !== draft.planId) return;
    // A saved draft carries its save's instant, so the copy held is the save's.
    const plan = {
      ...held,
      document: draft.document,
      ...(draft.savedAt === undefined ? undefined : { updatedAt: draft.savedAt }),
    };
    write({ document: { status: PLANNING_READ.READY, plan } });
  }

  /**
   * Shows the call's activity, and asks for the board again where it says a
   * draw just settled: the planning model's pending call was a draw and is
   * not any more, or the planning model stopped working, which also covers a
   * draw that settled between two words about it.
   */
  function showActivity({ type: _type, planId, ...activity }: PlanActivityFrame): void {
    if (view.activePlanId !== planId) return;
    const was = view.activity?.planner;
    const drew = was?.action === DRAW_ON_BOARD_TOOL_NAME && activity.planner?.action !== was.action;
    const stopped = was !== undefined && activity.planner === undefined;
    write({ activity });
    if (drew || stopped) Queue.offerUnsafe(boardReads, planId);
  }

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.PLANNING_REFRESH]: () =>
      Effect.gen(function* () {
        if (!gate()) return {};
        yield* serial(
          Effect.gen(function* () {
            yield* readList;
            const planId = view.activePlanId;
            if (planId !== undefined) yield* readDocument(planId);
            if (planId !== undefined) yield* readBoard(planId);
          }),
        );
        return {};
      }),
    [GATEWAY_METHOD.PLANNING_OPEN]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningOpenParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("opening a plan names one plan");
        if (!gate()) return { opened: false };
        const { planId } = read.success;
        // Note that the plan becomes the active one before the old plan's
        // call is asked to end, because that end waits on the call closing:
        // a microphone press or an offer landing inside the wait must bind
        // to the plan the panel now shows, never the one it is leaving.
        if (view.activePlanId !== planId) {
          view = {
            ...withoutActivity(view),
            activePlanId: planId,
            document: { status: PLANNING_READ.READING },
          };
          publish();
        }
        yield* endPlanCall(planId);
        yield* serial(
          Effect.gen(function* () {
            yield* readDocument(planId);
            yield* readBoard(planId);
            // Opening moved the plan to the head of the list.
            yield* readList;
          }),
        );
        return { opened: true };
      }),
    // Leaving the plan returns to the list, which was read when the tab showed.
    [GATEWAY_METHOD.PLANNING_CLOSE]: () =>
      Effect.gen(function* () {
        yield* endPlanCall(undefined);
        yield* serial(
          Effect.sync(() => {
            const { activePlanId: _closed, ...rest } = withoutActivity(view);
            view = { ...rest, document: { status: PLANNING_READ.IDLE } };
            publish();
          }),
        );
        return {};
      }),
    [GATEWAY_METHOD.PLANNING_START]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningStartRequestSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("starting a plan names it and its folder");
        }
        if (!gate()) return carried<PlanningStartAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        const request = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const started = yield* Effect.provide(
              client.create({ name: request.name }),
              FetchHttpClient.layer,
            );
            if (!started.ok) return carried<PlanningStartAnswer>({ failure: started.failure });
            const plan = started.answer;
            recordFolder(plan.id, request.folderPath);
            // Active before the old call's end is waited on, as for opening.
            view = {
              ...withoutActivity(view),
              activePlanId: plan.id,
              document: { status: PLANNING_READ.READY, plan },
            };
            publish();
            yield* endPlanCall(plan.id);
            yield* readList;
            return carried<PlanningStartAnswer>({ planId: plan.id });
          }),
        );
      }),
    // Note that the open plan's call ends before the plan is deleted, because
    // a call still standing would go on writing a document that is gone.
    [GATEWAY_METHOD.PLANNING_DELETE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningOpenParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("deleting a plan names one plan");
        if (!gate()) return { deleted: false };
        const { planId } = read.success;
        if (view.activePlanId === planId) yield* endPlanCall(undefined);
        return yield* serial(
          Effect.gen(function* () {
            const deleted = yield* Effect.provide(client.delete(planId), FetchHttpClient.layer);
            if (!deleted) return { deleted: false };
            const kept = folders.update(({ [planId]: _deleted, ...rest } = {}) => rest);
            const plans = view.plans.filter((plan) => plan.id !== planId);
            if (view.activePlanId === planId) {
              const { activePlanId: _deleted, ...rest } = withoutActivity(view);
              view = { ...rest, document: { status: PLANNING_READ.IDLE } };
            }
            write({ plans, folders: kept });
            yield* readList;
            return { deleted: true };
          }),
        );
      }),
    [GATEWAY_METHOD.PLANNING_SET_FOLDER]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningSetFolderParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("choosing a folder names a plan and a folder");
        recordFolder(read.success.planId, read.success.folderPath);
        return {};
      }),
    [GATEWAY_METHOD.PLANNING_REPOSITORIES]: () =>
      Effect.gen(function* () {
        if (!gate()) {
          return carried<PlanningRepositoriesAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        }
        const listed = yield* Effect.provide(client.repositories(), FetchHttpClient.layer);
        return carried<PlanningRepositoriesAnswer>(
          listed.ok ? listed.answer : { failure: listed.failure },
        );
      }),
    // A save of another plan than the open one is dropped: its board is not drawn.
    [GATEWAY_METHOD.PLANNING_BOARD_SAVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningBoardSaveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("saving a board names a plan and its scene");
        const { planId, elements, appliedDrawing } = read.success;
        if (!gate() || view.activePlanId !== planId) return { saved: false };
        return yield* serial(
          Effect.gen(function* () {
            const board = yield* Effect.provide(
              client.saveBoard(planId, elements, appliedDrawing),
              FetchHttpClient.layer,
            );
            if (board === undefined) return { saved: false };
            if (view.activePlanId === planId) write({ board });
            return { saved: true };
          }),
        );
      }),
    // Opened for a signed-in account only; the panel reads the repositories
    // again once the developer is back, so nothing here waits on the link.
    [GATEWAY_METHOD.PLANNING_CONNECT_GITHUB]: () =>
      Effect.gen(function* () {
        if (!gate()) return { opened: false };
        const accountId = yield* connectGitHub.accountId();
        yield* connectGitHub.openExternal(
          connectGitHubPageAddress(connectGitHub.serviceBaseUrl, accountId),
        );
        return { opened: true };
      }),
  };

  return {
    methods,
    snapshot: () => view,
    activePlanId: () => view.activePlanId,
    showDraft,
    showActivity,
    reset: Effect.gen(function* () {
      yield* endPlanCall(undefined);
      yield* serial(
        Effect.sync(() => {
          view = idleView();
          publish();
        }),
      );
    }),
    // The open plan's folder commands, and the board reads a settled draw
    // asks for; every other read of the plans is an ask's.
    lifetime: Effect.gen(function* () {
      yield* servePlanningCommands({
        client,
        openPlan: () => {
          const planId = view.activePlanId;
          if (!gate() || planId === undefined) return undefined;
          return { planId, folder: view.folders[planId] };
        },
      });
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(boardReads), (planId) =>
            gate() ? serial(readBoard(planId)) : Effect.void,
          ),
        ),
      );
    }),
  };
});
