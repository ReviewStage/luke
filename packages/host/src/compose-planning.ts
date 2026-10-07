import { isDeepStrictEqual } from "node:util";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@sidecar/gateway";
import {
  type HostedPlanClient,
  type PlanActivityFrame,
  type PlanDraftFrame,
  type SessionPointerFrame,
  VOICE_SERVICE_FRAME,
} from "@sidecar/hosted";
import { connectGitHubPageAddress } from "@sidecar/hosted/connect-github-page";
import {
  CODE_POINTER_TEXT_MAX_CHARS,
  type CodeRef,
  codeRefSchema,
} from "@sidecar/hosted/plan-wire";
import {
  CODE_SOURCE,
  type CodeSource,
  IDLE_PLANNING_VIEW,
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanCode,
  type PlanningDocument,
  type PlanningRepositoriesAnswer,
  type PlanningStartAnswer,
  type PlanningView,
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
import { planCode, planFiles } from "./plan-code.js";
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
 * when one starts, and never on a clock. The loops here are the open plan's
 * folder commands (`planning-commands.ts`), which the planning model asks
 * this Mac to run, and the code on screen during a call (`plan-code.ts`),
 * read from the plan's folder whichever side of the call named it.
 */

/** Opening or deleting a plan names it and nothing else. */
const planningOpenParamsSchema = Schema.Struct({ planId: Schema.NonEmptyString });

/** The developer's code on screen names the place, and the plan is the open one. */
const planningShowCodeParamsSchema = Schema.Struct({ ref: codeRefSchema });

/**
 * What the developer pointed at, as the call is told it: the place, and the
 * lines they selected as the file reads, cut to what a pointer carries; a
 * file opened whole, or one that drew nothing, carries no lines.
 */
function pointerOf(code: PlanCode): SessionPointerFrame {
  const { ref, lines, firstLine = 1 } = code;
  const base = { type: VOICE_SERVICE_FRAME.SESSION_POINTER, ref } as const;
  if (lines === undefined || ref.startLine === undefined || ref.endLine === undefined) return base;
  const text = lines
    .slice(ref.startLine - firstLine, ref.endLine - firstLine + 1)
    .map((line) => line.map((token) => token.text).join(""))
    .join("\n")
    .slice(0, CODE_POINTER_TEXT_MAX_CHARS);
  return { ...base, text };
}

/** One ask to put code on screen, for the plan it was named about. */
interface CodeAsk {
  readonly planId: string;
  readonly ref: CodeRef;
  readonly source: CodeSource;
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
  "list" | "open" | "create" | "delete" | "repositories" | "claimCommand" | "settleCommand"
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
  /** Tells the planning call standing, if any, what the developer pointed at on screen. */
  pointAt: (pointer: SessionPointerFrame) => void;
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
  /**
   * Puts code of the open plan's folder on screen, as either side of its
   * call named it: read and coloured here, the newest ask replacing any
   * still being read. An ask about any other plan is dropped.
   */
  showCode: (planId: string, ref: CodeRef, source: CodeSource) => void;
  /** The call about `planId` ended: the code it put on screen goes with it. */
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
  const { kernel, account, client, folders, endPlanCall, pointAt, connectGitHub } = dependencies;
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

  /** The view with no activity and no code, as a plan left behind leaves it. */
  function withoutActivity({
    activity: _activity,
    code: _code,
    ...rest
  }: PlanningView): PlanningView {
    codeGeneration += 1;
    return rest;
  }

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

  function showActivity({ type: _type, planId, ...activity }: PlanActivityFrame): void {
    if (view.activePlanId !== planId) return;
    write({ activity });
  }

  // Note that only the newest ask is kept, because code named while an older
  // file is still being read is what the call is looking at now.
  const codeAsks = yield* Queue.sliding<CodeAsk>(1);

  function showCode(planId: string, ref: CodeRef, source: CodeSource): void {
    if (view.activePlanId !== planId) return;
    Queue.offerUnsafe(codeAsks, { planId, ref, source });
  }

  function callEnded(planId: string): void {
    if (view.activePlanId !== planId || view.code === undefined) return;
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
      const code = yield* planCode(view.folders[ask.planId], ask.ref, ask.source);
      if (view.activePlanId !== ask.planId || codeGeneration !== generation) return;
      write({ code });
      // Note that the call hears what the developer pointed at only once it
      // is on their screen, so Luke is never told of lines they cannot see.
      if (ask.source === CODE_SOURCE.DEVELOPER && code.unreadable === undefined) {
        pointAt(pointerOf(code));
      }
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
    // The developer pointing at code on the open plan's call: a file opened,
    // or lines selected in the one on screen.
    [GATEWAY_METHOD.PLANNING_SHOW_CODE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningShowCodeParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("showing code names a file of the plan");
        const planId = view.activePlanId;
        if (planId !== undefined) showCode(planId, read.success.ref, CODE_SOURCE.DEVELOPER);
        return {};
      }),
    [GATEWAY_METHOD.PLANNING_LIST_FILES]: () =>
      Effect.gen(function* () {
        const planId = view.activePlanId;
        const files = yield* planFiles(planId === undefined ? undefined : view.folders[planId]);
        return { files: [...files] };
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
    // The open plan's folder commands and its code on screen; every read of
    // the plans is an ask's.
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
    }),
  };
});
