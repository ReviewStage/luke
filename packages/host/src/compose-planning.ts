import { isDeepStrictEqual } from "node:util";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@sidecar/gateway";
import type { HostedPlanClient, PlanActivityFrame, PlanDraftFrame } from "@sidecar/hosted";
import { DRAW_ON_BOARD_TOOL_NAME, LOOK_AT_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import type { Plan } from "@sidecar/hosted/plan-wire";
import {
  IDLE_PLANNING_VIEW,
  PLAN_CALL_FAILURE,
  PLAN_WORK_STATE,
  PLANNING_READ,
  type PlanCodeShowing,
  type PlanningDocument,
  type PlanningFileAnswer,
  type PlanningRepositoriesAnswer,
  type PlanningSetRepositoryAnswer,
  type PlanningStartAnswer,
  type PlanningView,
  type PlanShownCode,
  type PlanWorkTurn,
  planningBoardSaveParamsSchema,
  planningFileParamsSchema,
  planningRenameParamsSchema,
  planningSetRepositoryParamsSchema,
  planningStartRequestSchema,
} from "@sidecar/hosted/planning-view";
import { EMPTY_TRANSCRIPT } from "@sidecar/hosted/transcript-wire";
import { unparsedWire } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Duration, Effect, Queue, Result, Schema, type Scope, Semaphore } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { codeExcerpt, highlightCode, highlightFile } from "./plan-code.js";
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
 * The loops here are those board and transcript reads. The code Luke puts
 * on screen during a call arrives on the call's socket with its lines, read
 * by the service from the plan's repository, and is coloured here
 * (`plan-code.ts`) and drawn in place; nothing of the repository is read on
 * this Mac. What the planning model wrote and ran on the plan's calls, and
 * every code shown on them, are read from the service with the document, so
 * a plan opened after a restart or a switch shows them; its older work is
 * read a page at a time as the Work tab asks, and each turn a call tells and
 * each code it shows lands over those reads and stays past the call's end. The repositories the account reaches, and a plan's repository
 * given or taken away, are the service's too, asked through here.
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

/** The service's side of the plans, as this concern asks it. */
export type PlanningClient = Pick<
  HostedPlanClient,
  | "list"
  | "open"
  | "create"
  | "delete"
  | "rename"
  | "readBoard"
  | "saveBoard"
  | "readTranscript"
  | "readWork"
  | "readFile"
  | "repositories"
  | "setRepository"
>;

export interface PlanningDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: PlanningClient;
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
   * Puts code on screen as Luke named it on the open plan's call, with the
   * lines the service read from the plan's repository: coloured here and
   * drawn after every code shown before it, where it stays past the call's
   * end. Code about any other plan, or of a call already held, is dropped.
   */
  showCode: (planId: string, shown: PlanShownCode) => void;
  /**
   * Shows a planning turn's work on the call about the open plan, in place
   * of the same turn as last told, the newest turns kept; work about any
   * other plan is dropped. Leaving or switching plans clears it, and the
   * call's end keeps it.
   */
  showWork: (planId: string, turn: PlanWorkTurn) => void;
  /** The call about `planId` ended: its words are read back from the record. */
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
  const { kernel, account, client, endPlanCall } = dependencies;
  const idleView = (): PlanningView => IDLE_PLANNING_VIEW;
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

  /** The view with no activity, no board, no transcript, no code, and no work read or told, as a plan left behind leaves it. */
  function withoutActivity({
    activity: _activity,
    board: _board,
    transcript: _transcript,
    shownCode: _shownCode,
    work: _work,
    workEarlier: _workEarlier,
    ...rest
  }: PlanningView): PlanningView {
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

  /** A plan's row of the list: everything but its document. */
  function summaryOf({ document: _document, ...summary }: Plan): PlanningView["plans"][number] {
    return summary;
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

  /** Takes the active plan's work as it now stands, and where its next older page is read from, none where no older turn stands. */
  function writeWork(next: Pick<PlanningView, "work" | "workEarlier" | "shownCode">): void {
    const { workEarlier: _was, ...rest } = view;
    view = { ...rest, ...next };
    publish();
  }

  /**
   * The held turns with a page the service answered laid among them, in the
   * order the turns began. Note that a turn a call told since the plan
   * opened stands over the record's copy while that copy still runs,
   * because the call is ahead of the record there.
   */
  function withPage(page: readonly PlanWorkTurn[]): PlanWorkTurn[] {
    const told = new Map((view.work ?? []).map((turn) => [turn.turnId, turn]));
    const recorded = page.map((turn) => {
      const live = told.get(turn.turnId);
      return live !== undefined && turn.state === PLAN_WORK_STATE.RUNNING ? live : turn;
    });
    const read = new Set(page.map((turn) => turn.turnId));
    const unread = (view.work ?? []).filter((turn) => !read.has(turn.turnId));
    return [...recorded, ...unread].sort((a, b) => a.startedAt - b.startedAt);
  }

  /** A code shown as the Code tab's card draws it: the lines around those pointed at, coloured. */
  function showingOf({ code, ...shown }: PlanShownCode): PlanCodeShowing {
    return { ...shown, code: highlightCode(codeExcerpt(code)) };
  }

  /**
   * The code the record holds, oldest first, then each a call showed that
   * the record does not hold yet. Note that a showing already held is kept
   * rather than coloured again, because the plan's work is read again on
   * every refresh and colouring the windows is what costs.
   */
  function withShownCode(recorded: readonly PlanShownCode[]): PlanCodeShowing[] {
    const held = view.shownCode ?? [];
    const byCall = new Map(held.map((showing) => [showing.callId, showing]));
    const read = recorded.map((shown) => byCall.get(shown.callId) ?? showingOf(shown));
    const recordedCalls = new Set(recorded.map((shown) => shown.callId));
    return [...read, ...held.filter((showing) => !recordedCalls.has(showing.callId))];
  }

  /**
   * Reads the newest page of the active plan's work, and every code shown
   * on it, as the service keeps them. Older pages already read stay, with
   * the place the next one is read from; a plan read for the first time
   * takes the service's. Code a call put on screen that the record does not
   * hold yet stays after the record's. A failed read keeps whatever is held.
   */
  function readWork(planId: string) {
    return Effect.gen(function* () {
      const stored = yield* Effect.provide(client.readWork(planId), FetchHttpClient.layer);
      if (stored === undefined || view.activePlanId !== planId) return;
      const work = withPage(stored.turns);
      const oldest = work[0]?.turnId;
      const olderHeld =
        oldest !== undefined && !stored.turns.some((turn) => turn.turnId === oldest);
      const workEarlier = olderHeld ? view.workEarlier : stored.earlier;
      const shownCode = withShownCode(stored.code ?? []);
      writeWork({
        ...(work.length === 0 ? undefined : { work }),
        ...(workEarlier === undefined ? undefined : { workEarlier }),
        ...(shownCode.length === 0 ? undefined : { shownCode }),
      });
    });
  }

  /** Reads the page of the active plan's work before the oldest turn held, where one stands; a failed read keeps what is held. */
  function readEarlierWork(planId: string) {
    return Effect.gen(function* () {
      const before = view.workEarlier;
      if (before === undefined) return;
      const stored = yield* Effect.provide(client.readWork(planId, before), FetchHttpClient.layer);
      if (stored === undefined || view.activePlanId !== planId) return;
      writeWork({
        work: withPage(stored.turns),
        ...(stored.earlier === undefined ? undefined : { workEarlier: stored.earlier }),
      });
    });
  }

  /**
   * Shows the call's activity, and asks for the board again where it says a
   * draw just settled: the planning model's pending call was a draw and is
   * not any more, or the planning model stopped working, which also covers a
   * draw that settled between two words about it. A look that just became
   * the pending call asks too, because a draw made in the same step never
   * shows as pending, and the look waits on the board holding it.
   */
  function showActivity({ type: _type, planId, ...activity }: PlanActivityFrame): void {
    if (view.activePlanId !== planId) return;
    const was = view.activity?.planner;
    const drew = was?.action === DRAW_ON_BOARD_TOOL_NAME && activity.planner?.action !== was.action;
    const stopped = was !== undefined && activity.planner === undefined;
    const looking =
      activity.planner?.action === LOOK_AT_BOARD_TOOL_NAME &&
      was?.action !== LOOK_AT_BOARD_TOOL_NAME;
    write({ activity });
    if (drew || stopped || looking) Queue.offerUnsafe(boardReads, planId);
  }

  function showCode(planId: string, shown: PlanShownCode): void {
    if (view.activePlanId !== planId) return;
    const held = view.shownCode ?? [];
    // A call's code told again is the showing already drawn.
    if (held.some((showing) => showing.callId === shown.callId)) return;
    write({ shownCode: [...held, showingOf(shown)] });
  }

  function showWork(planId: string, turn: PlanWorkTurn): void {
    if (view.activePlanId !== planId) return;
    const held = view.work ?? [];
    // A turn told again stays where it first stood, so the tab never reorders what it drew.
    const turns = held.some((standing) => standing.turnId === turn.turnId)
      ? held.map((standing) => (standing.turnId === turn.turnId ? turn : standing))
      : [...held, turn];
    write({ work: turns });
  }

  function callEnded(planId: string): void {
    if (view.activePlanId !== planId) return;
    Queue.offerUnsafe(transcriptReads, planId);
  }

  /** Draws `plan` as the service answered it, in the list's row and in the open document where it is the one held. */
  function takeAnswered(plan: Plan): void {
    const plans = view.plans.map((row) =>
      row.id === plan.id ? { ...row, ...summaryOf(plan) } : row,
    );
    const held = heldPlanOf(plan.id);
    write(
      held === undefined
        ? { plans }
        : { plans, document: { status: PLANNING_READ.READY, plan: { ...held, ...plan } } },
    );
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
            if (planId !== undefined) yield* readTranscript(planId);
            if (planId !== undefined) yield* readWork(planId);
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
            yield* readWork(planId);
          }),
        );
        return { opened: true };
      }),
    [GATEWAY_METHOD.PLANNING_WORK_EARLIER]: () =>
      Effect.gen(function* () {
        const planId = view.activePlanId;
        if (!gate() || planId === undefined) return {};
        yield* serial(readEarlierWork(planId));
        return {};
      }),
    // A file's window is answered to the File tab that asked, coloured here,
    // and held nowhere: the tab keeps the windows it has scrolled through.
    [GATEWAY_METHOD.PLANNING_FILE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningFileParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("reading a file names a plan, a path, and a window of its lines");
        }
        if (!gate()) return carried<PlanningFileAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        const { planId, ...window } = read.success;
        const answer = yield* Effect.provide(
          client.readFile(planId, window),
          FetchHttpClient.layer,
        );
        if (answer === undefined) {
          return carried<PlanningFileAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        }
        return carried<PlanningFileAnswer>(
          "file" in answer ? { file: highlightFile(answer.file) } : { refusal: answer.refusal },
        );
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
          return yield* invalid("starting a plan names it, and its repository where it has one");
        }
        if (!gate()) return carried<PlanningStartAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        const request = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const started = yield* Effect.provide(client.create(request), FetchHttpClient.layer);
            if (!started.ok) return carried<PlanningStartAnswer>({ failure: started.failure });
            const plan = started.answer;
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
            const plans = view.plans.filter((plan) => plan.id !== planId);
            if (view.activePlanId === planId) {
              const { activePlanId: _deleted, ...rest } = withoutActivity(view);
              view = { ...rest, document: { status: PLANNING_READ.IDLE } };
            }
            write({ plans });
            yield* readList;
            return { deleted: true };
          }),
        );
      }),
    // The service answers the plan as renamed, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.PLANNING_RENAME]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningRenameParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("renaming a plan names it and its name");
        if (!gate()) return { renamed: false };
        const { planId, name } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const renamed = yield* Effect.provide(
              client.rename(planId, { name }),
              FetchHttpClient.layer,
            );
            if (renamed === undefined) return { renamed: false };
            const plans = view.plans.map((plan) =>
              plan.id === planId ? { ...plan, name: renamed.name } : plan,
            );
            const held = heldPlanOf(planId);
            write(
              held === undefined
                ? { plans }
                : {
                    plans,
                    document: {
                      status: PLANNING_READ.READY,
                      plan: { ...held, name: renamed.name, document: renamed.document },
                    },
                  },
            );
            return { renamed: true };
          }),
        );
      }),
    // The list is the service's answer whole, read now and held nowhere: the
    // panel asks again whenever its chip opens, so an App installed meanwhile
    // shows on the next opening.
    [GATEWAY_METHOD.PLANNING_REPOSITORIES]: () =>
      Effect.gen(function* () {
        if (!gate()) {
          return carried<PlanningRepositoriesAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        }
        const listed = yield* Effect.provide(client.repositories(), FetchHttpClient.layer);
        return carried<PlanningRepositoriesAnswer>(
          listed.ok ? { repositories: listed.answer } : { failure: listed.failure },
        );
      }),
    // The service answers the plan as changed, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.PLANNING_SET_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningSetRepositoryParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("giving a plan its repository names the plan and the repository");
        }
        if (!gate()) {
          return carried<PlanningSetRepositoryAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        }
        const { planId, repository } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const changed = yield* Effect.provide(
              client.setRepository(planId, repository),
              FetchHttpClient.layer,
            );
            if (!changed.ok)
              return carried<PlanningSetRepositoryAnswer>({ failure: changed.failure });
            takeAnswered(changed.answer);
            return carried<PlanningSetRepositoryAnswer>({ repository: changed.answer.repository });
          }),
        );
      }),
    // A save of another plan than the open one is dropped: its board is not drawn.
    [GATEWAY_METHOD.PLANNING_BOARD_SAVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningBoardSaveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("saving a board names a plan and its scene");
        const { planId, elements, appliedDrawing, image } = read.success;
        if (!gate() || view.activePlanId !== planId) return { saved: false };
        return yield* serial(
          Effect.gen(function* () {
            const board = yield* Effect.provide(
              client.saveBoard(planId, elements, appliedDrawing, image),
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
    showWork,
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
    // The board reads a settled draw asks for and the transcript reads a
    // call's end asks for; every other read of the plans is an ask's.
    lifetime: Effect.gen(function* () {
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
