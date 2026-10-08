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
import type { CodeRef } from "@sidecar/hosted/plan-wire";
import {
  IDLE_PLANNING_VIEW,
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanningDocument,
  type PlanningStartAnswer,
  type PlanningView,
  planningBoardSaveParamsSchema,
  planningSetFolderParamsSchema,
  planningStartRequestSchema,
} from "@sidecar/hosted/planning-view";
import { EMPTY_TRANSCRIPT } from "@sidecar/hosted/transcript-wire";
import { unparsedWire } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Duration, Effect, Option, Queue, Result, Schema, type Scope, Semaphore } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { type JsonStateFile, jsonStateFile } from "./json-state-file.js";
import { planCode } from "./plan-code.js";
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
 * through here and the view takes the board as the service answered it. What
 * was said on the open plan's calls is read with its document, and again
 * whenever a call about it ends, once at the end and once more when the
 * call's last words have had time to reach the record; while a call stands,
 * its words are the voice window's to report.
 * The loops here are the open plan's folder commands
 * (`planning-commands.ts`), which the planning model asks this Mac to run,
 * those board and transcript reads, and the code Luke puts on screen during
 * a call (`plan-code.ts`), read from the plan's folder.
 */

/**
 * How long after a call's end its transcript is read a second time. Note
 * that the first read can land before the service has written the call's
 * last words, because the service closes the device's socket first and only
 * then waits on the writes it already started, and says nothing once they
 * land; this is that wait's margin.
 */
const TRANSCRIPT_SETTLE = Duration.seconds(5);

/** Opening or deleting a plan names it and nothing else. */
const planningOpenParamsSchema = Schema.Struct({ planId: Schema.NonEmptyString });

/** One ask to put code on screen, for the plan it was named about. */
interface CodeAsk {
  readonly planId: string;
  readonly ref: CodeRef;
}

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
  | "claimCommand"
  | "settleCommand"
  | "readBoard"
  | "saveBoard"
  | "readTranscript"
>;

export interface PlanningDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: PlanningClient;
  /** The folder of this Mac each plan reads (`planFoldersFile`); the service never holds one. */
  folders: JsonStateFile<PlanFolders>;
  /**
   * Ends the planning call standing about any plan but `keep`, and waits for
   * it to end; the call about `keep` is left standing.
   */
  endPlanCall: (keep: string | undefined) => Effect.Effect<void>;
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
  /**
   * Puts code of the open plan's folder on screen, as Luke named it on its
   * call: read and coloured here, the newest ask replacing any still being
   * read. An ask about any other plan is dropped.
   */
  showCode: (planId: string, ref: CodeRef) => void;
  /** The call about `planId` ended: the code it put on screen goes with it, and its words are read back from the record. */
  callEnded: (planId: string) => void;
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
  const { kernel, account, client, folders, endPlanCall } = dependencies;
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

  /**
   * Bumped whenever the code on screen is cleared, so a read still out when
   * the call ended or the plan was left lands on nothing.
   */
  let codeGeneration = 0;

  /** The view with no activity, no board, no transcript, and no code, as a plan left behind leaves it. */
  function withoutActivity({
    activity: _activity,
    board: _board,
    transcript: _transcript,
    code: _code,
    ...rest
  }: PlanningView): PlanningView {
    codeGeneration += 1;
    return rest;
  }

  /** The plans whose board a settled draw may have moved, read one at a time by the loop below. */
  const boardReads = yield* Queue.sliding<string>(1);

  /** The plans a call just ended about, whose transcript is read again by the loop below. */
  const transcriptReads = yield* Queue.sliding<string>(1);

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

  /**
   * Reads what was said on the active plan's calls. A transcript already
   * held stays drawn while the read is out and through a read that failed,
   * as the document does; with none held, the failure is what the panel
   * draws.
   */
  function readTranscript(planId: string) {
    return Effect.gen(function* () {
      const held = view.transcript?.transcript;
      if (held === undefined) write({ transcript: { status: PLANNING_READ.READING } });
      const transcript = yield* Effect.provide(
        client.readTranscript(planId),
        FetchHttpClient.layer,
      );
      if (view.activePlanId !== planId) return;
      if (transcript !== undefined) {
        write({ transcript: { status: PLANNING_READ.READY, transcript } });
        return;
      }
      write({
        transcript:
          held === undefined
            ? { status: PLANNING_READ.FAILED }
            : { status: PLANNING_READ.READY, transcript: held },
      });
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

  // Note that only the newest ask is kept, because code named while an older
  // file is still being read is what the call is looking at now.
  const codeAsks = yield* Queue.sliding<CodeAsk>(1);

  function showCode(planId: string, ref: CodeRef): void {
    if (view.activePlanId !== planId) return;
    Queue.offerUnsafe(codeAsks, { planId, ref });
  }

  function callEnded(planId: string): void {
    if (view.activePlanId !== planId) return;
    Queue.offerUnsafe(transcriptReads, planId);
    if (view.code === undefined) return;
    codeGeneration += 1;
    const { code: _code, ...rest } = view;
    view = rest;
    publish();
  }

  /** Reads each ask's code from the plan's folder and draws it, unless the call moved on meanwhile. */
  const serveCode = Effect.forever(
    Effect.gen(function* () {
      const ask = yield* Queue.take(codeAsks);
      const generation = codeGeneration;
      const code = yield* planCode(view.folders[ask.planId], ask.ref);
      if (view.activePlanId !== ask.planId || codeGeneration !== generation) return;
      write({ code });
    }),
  );

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
            if (planId !== undefined) yield* readTranscript(planId);
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
            yield* readTranscript(planId);
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
            // Active before the old call's end is waited on, as for opening;
            // a plan just started has had no call.
            view = {
              ...withoutActivity(view),
              activePlanId: plan.id,
              document: { status: PLANNING_READ.READY, plan },
              transcript: { status: PLANNING_READ.READY, transcript: EMPTY_TRANSCRIPT },
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
  };

  return {
    methods,
    snapshot: () => view,
    activePlanId: () => view.activePlanId,
    showDraft,
    showActivity,
    showCode,
    callEnded,
    reset: Effect.gen(function* () {
      yield* endPlanCall(undefined);
      yield* serial(
        Effect.sync(() => {
          view = idleView();
          publish();
        }),
      );
    }),
    // The open plan's folder commands, the board reads a settled draw asks
    // for, the transcript reads a call's end asks for, and its code on
    // screen; every other read of the plans is an ask's.
    lifetime: Effect.gen(function* () {
      yield* Effect.forkScoped(serveCode);
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
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(transcriptReads), (planId) => {
            const read = Effect.suspend(() =>
              gate() && view.activePlanId === planId ? serial(readTranscript(planId)) : Effect.void,
            );
            return Effect.andThen(read, Effect.andThen(Effect.sleep(TRANSCRIPT_SETTLE), read));
          }),
        ),
      );
    }),
  };
});
