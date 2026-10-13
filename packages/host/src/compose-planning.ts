import { isDeepStrictEqual } from "node:util";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@sidecar/gateway";
import type {
  HostedPlanClient,
  PlanActivityFrame,
  PlanDraftFrame,
  PlanMarks,
} from "@sidecar/hosted";
import { DRAW_ON_BOARD_TOOL_NAME, LOOK_AT_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import { PLAN_ACTOR, type Plan } from "@sidecar/hosted/plan-wire";
import {
  IDLE_PLANNING_VIEW,
  PLAN_CALL_FAILURE,
  PLAN_WORK_STATE,
  PLANNING_READ,
  type PlanCodeShowing,
  type PlanningDocument,
  type PlanningEditAnswer,
  type PlanningFileAnswer,
  type PlanningPageAnswer,
  type PlanningRepositoriesAnswer,
  type PlanningRevisionAnswer,
  type PlanningRevisionsAnswer,
  type PlanningSetRepositoryAnswer,
  type PlanningSkillsAnswer,
  type PlanningStartAnswer,
  type PlanningTreeAnswer,
  type PlanningView,
  type PlanShownCode,
  type PlanWorkTurn,
  planningArchiveParamsSchema,
  planningBoardSaveParamsSchema,
  planningEditParamsSchema,
  planningFileParamsSchema,
  planningPageParamsSchema,
  planningPinParamsSchema,
  planningPinRepositoryParamsSchema,
  planningRenameParamsSchema,
  planningRevisionParamsSchema,
  planningRevisionsParamsSchema,
  planningSetRepositoryParamsSchema,
  planningSkillsParamsSchema,
  planningStartRequestSchema,
  planningTreeParamsSchema,
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
 * Nothing here writes a document but a restore the developer asks for: the
 * plan's notetaker and coding agents are its writers, on the service. What
 * this concern owes the panel is to show those writes as they happen. Every write happens during a planning call, and the notetaker's
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
 * given or taken away, are the service's too, asked through here, as are a
 * plan pinned or archived: the list holds the archived plans beside the
 * rest, each flagged, and which the window draws where is the window's. A
 * plan's history is read for the version history that asks and held nowhere
 * here; a revision restored is the one write this concern carries to the
 * service on the developer's word, and the view takes the plan it answers.
 * The pages agents wrote for the open plan are listed with its document, by
 * title and newest version alone; a page's HTML is answered to the frame
 * that draws it and held nowhere here.
 */

/**
 * How long after a call's end its transcript and work are read a second time. Note
 * that the first read can land before the service has written the call's
 * last words, because the service closes the device's socket first and only
 * then waits on the writes it already started, and says nothing once they
 * land; this is that wait's margin.
 */
const TRANSCRIPT_SETTLE = Duration.seconds(5);

/** A plan's pin and archive as the list carries them, each only where it stands. */
type PlanMarkStamps = Pick<Plan, "pinnedAt" | "archivedAt">;

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
  | "mark"
  | "repositoryPins"
  | "pinRepository"
  | "readBoard"
  | "saveBoard"
  | "readTranscript"
  | "readWork"
  | "readFile"
  | "readTree"
  | "readSkills"
  | "readRevisions"
  | "readRevision"
  | "readPages"
  | "readPageVersion"
  | "restore"
  | "repositories"
  | "setRepository"
  | "edit"
>;

export interface PlanningDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: PlanningClient;
  /**
   * Ends the planning call standing about `planId`, or whatever it is about
   * where none is named, and waits for it to end. A call about another plan
   * is left standing.
   */
  endPlanCall: (planId: string | undefined) => Effect.Effect<void>;
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

  /** The view with no activity, no board, no transcript, no code, no work, and no pages read or told, as a plan left behind leaves it. */
  function withoutActivity({
    activity: _activity,
    board: _board,
    transcript: _transcript,
    shownCode: _shownCode,
    work: _work,
    workEarlier: _workEarlier,
    pages: _pages,
    ...rest
  }: PlanningView): PlanningView {
    return rest;
  }

  /** The plans whose board a settled draw may have moved, read one at a time by the loop below. */
  const boardReads = yield* Queue.sliding<string>(1);

  /** The plans a call just ended about, whose transcript and work are read again by the loop below. */
  const callEndReads = yield* Queue.sliding<string>(1);

  /**
   * The plan whose call is telling its turns' work as they run, and the
   * turns that call told, which stand over the record's running copies; none
   * once that call ended, since nothing it told is ahead of the record any
   * more. A turn an earlier call told is not among them.
   */
  let telling: { readonly planId: string; readonly turnIds: Set<string> } | undefined;

  /**
   * The developer's newest save of an edit, and the plan it was of. A draft
   * the notetaker drew over a save older than it does not hold the edit, so
   * it is dropped rather than drawn: the edit would vanish until the
   * notetaker's next save, which takes it in under the plan's lock.
   */
  let developerSaved: { readonly planId: string; readonly at: number } | undefined;

  /** The document of `planId` as held now, if the held one is that plan's. */
  function heldPlanOf(planId: string): PlanningDocument["plan"] {
    const held = view.document.plan;
    return held?.id === planId ? held : undefined;
  }

  /** A plan's row of the list: everything but its document and what is written of it. */
  function summaryOf({
    document: _document,
    agentEdits: _agentEdits,
    lastEdit: _lastEdit,
    ...summary
  }: Plan): PlanningView["plans"][number] {
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

  // A failed read keeps the pins it last read, as a failed list read keeps the plans.
  const readRepositoryPins = Effect.gen(function* () {
    const pins = yield* Effect.provide(client.repositoryPins(), FetchHttpClient.layer);
    if (pins !== undefined) write({ repositoryPins: pins });
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

  /**
   * The plan a restore just replaced the content of, and the restore's save,
   * until the notetaker saves after it. Note that the drafts of its turn in
   * flight were written over the content the restore replaced, so a draft,
   * or a save from before the restore landing late, would draw that content
   * back over the restored one; the notetaker's next save is taken over the
   * restored content on the service, and is the first draw to trust again.
   */
  let restoredFence: { readonly planId: string; readonly at: number } | undefined;

  function showDraft(draft: PlanDraftFrame): void {
    const held = heldPlanOf(draft.planId);
    if (held === undefined || view.activePlanId !== draft.planId) return;
    if (restoredFence?.planId === draft.planId) {
      if (draft.savedAt === undefined || draft.savedAt <= restoredFence.at) return;
      restoredFence = undefined;
    }
    const drawnOver = draft.savedAt ?? draft.readAt;
    if (
      drawnOver !== undefined &&
      developerSaved?.planId === draft.planId &&
      drawnOver < developerSaved.at
    ) {
      return;
    }
    // A saved draft carries its save's instant and who last changed each
    // section as the service names them, so the copy held is the save's,
    // written by the notetaker on this call.
    const plan = {
      ...held,
      document: draft.document,
      ...(draft.savedAt === undefined
        ? undefined
        : {
            updatedAt: draft.savedAt,
            lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: draft.savedAt, duringCall: true },
          }),
      ...(draft.sectionEdits === undefined ? undefined : { sectionEdits: draft.sectionEdits }),
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
   * order the turns began. Note that a turn the open plan's call told stands
   * over the record's copy while that copy still runs and that call still
   * tells, because the call is ahead of the record there; once the call has
   * ended, a turn still running on record, parked on a worker, is the
   * record's, because the record goes on following the worker after the
   * call's last word.
   */
  function withPage(page: readonly PlanWorkTurn[]): PlanWorkTurn[] {
    const calling = telling?.planId === view.activePlanId ? telling?.turnIds : undefined;
    const told = new Map((view.work ?? []).map((turn) => [turn.turnId, turn]));
    const recorded = page.map((turn) => {
      const live = told.get(turn.turnId);
      const ahead = calling?.has(turn.turnId) === true && turn.state === PLAN_WORK_STATE.RUNNING;
      return ahead && live !== undefined ? live : turn;
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
   * Reads the active plan's pages, each by its newest version. A failed read
   * keeps the pages held, as a failed board read keeps the board.
   */
  function readPages(planId: string) {
    return Effect.gen(function* () {
      const pages = yield* Effect.provide(client.readPages(planId), FetchHttpClient.layer);
      if (pages === undefined || view.activePlanId !== planId) return;
      const { pages: _held, ...rest } = view;
      view = pages.length === 0 ? rest : { ...rest, pages };
      publish();
    });
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
    // The call's own copy is kept whatever plan is open, for the floating
    // call window; the panel's is the active plan's alone.
    if (view.activePlanId !== planId) {
      write({ callActivity: activity });
      return;
    }
    const was = view.activity?.planner;
    const drew = was?.action === DRAW_ON_BOARD_TOOL_NAME && activity.planner?.action !== was.action;
    const stopped = was !== undefined && activity.planner === undefined;
    const looking =
      activity.planner?.action === LOOK_AT_BOARD_TOOL_NAME &&
      was?.action !== LOOK_AT_BOARD_TOOL_NAME;
    write({ activity, callActivity: activity });
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
    if (telling?.planId !== planId) telling = { planId, turnIds: new Set() };
    telling.turnIds.add(turn.turnId);
    const held = view.work ?? [];
    // A turn told again stays where it first stood, so the tab never reorders what it drew.
    const turns = held.some((standing) => standing.turnId === turn.turnId)
      ? held.map((standing) => (standing.turnId === turn.turnId ? turn : standing))
      : [...held, turn];
    write({ work: turns });
  }

  function callEnded(planId: string): void {
    if (telling?.planId === planId) telling = undefined;
    const { callActivity: _ended, ...rest } = view;
    view = rest;
    publish();
    if (view.activePlanId !== planId) return;
    Queue.offerUnsafe(callEndReads, planId);
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

  /** The pin and the archive a plan answered carries, each only where it stands. */
  function marksOf(plan: Plan): PlanMarkStamps {
    return {
      ...(plan.pinnedAt === undefined ? undefined : { pinnedAt: plan.pinnedAt }),
      ...(plan.archivedAt === undefined ? undefined : { archivedAt: plan.archivedAt }),
    };
  }

  /**
   * Draws the pin and the archive `plan` was answered with on its row of the
   * list, and on the open document where it is the one held. Note that the
   * row keeps what the list said of the plan's coding agents, which only the
   * list answers, and the held document keeps everything else it holds,
   * because a draft drawn during a call may be ahead of the copy the service
   * answered.
   */
  function takeMarks(plan: Plan): void {
    const plans = view.plans.map((row) =>
      row.id !== plan.id
        ? row
        : {
            ...summaryOf(plan),
            ...(row.agents === undefined ? undefined : { agents: row.agents }),
          },
    );
    const held = heldPlanOf(plan.id);
    if (held === undefined) {
      write({ plans });
      return;
    }
    const { pinnedAt: _pinned, archivedAt: _archived, ...kept } = held;
    write({
      plans,
      document: { status: PLANNING_READ.READY, plan: { ...kept, ...marksOf(plan) } },
    });
  }

  /** Pins or archives one plan on the service, or undoes either, and draws what it answered. */
  function markPlan(planId: string, marks: PlanMarks) {
    return serial(
      Effect.gen(function* () {
        const marked = yield* Effect.provide(client.mark(planId, marks), FetchHttpClient.layer);
        if (marked === undefined) return { changed: false };
        takeMarks(marked);
        return { changed: true };
      }),
    );
  }

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.PLANNING_REFRESH]: () =>
      Effect.gen(function* () {
        if (!gate()) return {};
        yield* serial(
          Effect.gen(function* () {
            yield* readList;
            yield* readRepositoryPins;
            const planId = view.activePlanId;
            if (planId !== undefined) yield* readDocument(planId);
            if (planId !== undefined) yield* readBoard(planId);
            if (planId !== undefined) yield* readTranscript(planId);
            if (planId !== undefined) yield* readWork(planId);
            if (planId !== undefined) yield* readPages(planId);
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
        // Note that a call about the plan left behind goes on standing,
        // because the call outlives the plan on screen: moving it to this
        // plan is this plan's own Talk press.
        if (view.activePlanId !== planId) {
          view = {
            ...withoutActivity(view),
            activePlanId: planId,
            document: { status: PLANNING_READ.READING },
          };
          publish();
        }
        yield* serial(
          Effect.gen(function* () {
            yield* readDocument(planId);
            yield* readBoard(planId);
            yield* readTranscript(planId);
            yield* readWork(planId);
            yield* readPages(planId);
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
          "file" in answer ? { file: highlightFile(answer.file) } : answer,
        );
      }),
    // A folder's listing is answered to the tree that asked and held nowhere:
    // the tree keeps the folders it has opened.
    [GATEWAY_METHOD.PLANNING_TREE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningTreeParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("listing a folder names a plan and the folder's path");
        }
        if (!gate()) return carried<PlanningTreeAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        const { planId, ...folder } = read.success;
        const answer = yield* Effect.provide(
          client.readTree(planId, folder),
          FetchHttpClient.layer,
        );
        return carried<PlanningTreeAnswer>(answer ?? { failure: PLAN_CALL_FAILURE.UNANSWERED });
      }),
    // The repository's skills are answered to the window that asked and held
    // nowhere: a skill added on GitHub is chosen on the next read.
    [GATEWAY_METHOD.PLANNING_SKILLS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningSkillsParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("reading a repository's skills names the plan");
        }
        if (!gate()) {
          return carried<PlanningSkillsAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        }
        const answer = yield* Effect.provide(
          client.readSkills(read.success.planId),
          FetchHttpClient.layer,
        );
        return carried<PlanningSkillsAnswer>(answer ?? { failure: PLAN_CALL_FAILURE.UNANSWERED });
      }),
    // A page of the history, and a revision beside the one before it, are
    // answered to the version history that asked and held nowhere: it keeps
    // what it read, and reads again as the plan moves on.
    [GATEWAY_METHOD.PLANNING_REVISIONS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningRevisionsParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a plan's history names the plan, and where an older page is read from",
          );
        }
        if (!gate()) {
          return carried<PlanningRevisionsAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        }
        const { planId, before } = read.success;
        const page = yield* Effect.provide(
          client.readRevisions(planId, before),
          FetchHttpClient.layer,
        );
        return carried<PlanningRevisionsAnswer>(page ?? { failure: PLAN_CALL_FAILURE.UNANSWERED });
      }),
    [GATEWAY_METHOD.PLANNING_REVISION]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningRevisionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading a revision names a plan and its number");
        if (!gate()) {
          return carried<PlanningRevisionAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        }
        const revision = yield* Effect.provide(
          client.readRevision(read.success.planId, read.success.seq),
          FetchHttpClient.layer,
        );
        return carried<PlanningRevisionAnswer>(
          revision === undefined ? { failure: PLAN_CALL_FAILURE.UNANSWERED } : { revision },
        );
      }),
    // A page's version is answered to the frame that asked and held nowhere,
    // so its HTML never enters the view every window is told.
    [GATEWAY_METHOD.PLANNING_PAGE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningPageParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("reading a page names a plan, the page, and its version");
        }
        if (!gate()) return carried<PlanningPageAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        const { planId, pageId, version } = read.success;
        const page = yield* Effect.provide(
          client.readPageVersion(planId, pageId, version),
          FetchHttpClient.layer,
        );
        return carried<PlanningPageAnswer>(
          page === undefined ? { failure: PLAN_CALL_FAILURE.UNANSWERED } : { page },
        );
      }),
    // The service answers the plan as restored, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.PLANNING_RESTORE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningRevisionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("restoring a revision names a plan and its number");
        if (!gate()) return { restored: false };
        const { planId, seq } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const restored = yield* Effect.provide(
              client.restore(planId, seq),
              FetchHttpClient.layer,
            );
            if (restored === undefined) return { restored: false };
            restoredFence = { planId, at: restored.updatedAt };
            takeAnswered(restored);
            return { restored: true };
          }),
        );
      }),
    // Leaving the plan returns to the list, which was read when the tab
    // showed, and leaves its call standing, as opening another plan does.
    [GATEWAY_METHOD.PLANNING_CLOSE]: () =>
      Effect.gen(function* () {
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
            // A plan just started has had no call. A call about another plan
            // is left to the start's own Talk press, which moves it here.
            view = {
              ...withoutActivity(view),
              activePlanId: plan.id,
              document: { status: PLANNING_READ.READY, plan },
              transcript: { status: PLANNING_READ.READY, transcript: EMPTY_TRANSCRIPT },
            };
            publish();
            yield* readList;
            return carried<PlanningStartAnswer>({ planId: plan.id });
          }),
        );
      }),
    // Note that the plan's call ends before the plan is deleted, open or not,
    // because a call still standing would go on writing a document that is gone.
    [GATEWAY_METHOD.PLANNING_DELETE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningOpenParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("deleting a plan names one plan");
        if (!gate()) return { deleted: false };
        const { planId } = read.success;
        yield* endPlanCall(planId);
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
    [GATEWAY_METHOD.PLANNING_PIN]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningPinParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("pinning a plan names it and whether it is pinned");
        }
        if (!gate()) return { changed: false };
        return yield* markPlan(read.success.planId, { pinned: read.success.pinned });
      }),
    // The service answers the pins as they then stand, so the view takes its
    // word rather than the window's guess.
    [GATEWAY_METHOD.PLANNING_PIN_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningPinRepositoryParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("pinning a repository names it and whether it is pinned");
        }
        if (!gate()) return { changed: false };
        const { repository, pinned } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const pins = yield* Effect.provide(
              client.pinRepository(repository, pinned),
              FetchHttpClient.layer,
            );
            if (pins === undefined) return { changed: false };
            write({ repositoryPins: pins });
            return { changed: true };
          }),
        );
      }),
    // Note that an archived plan stays open where it is the open one: leaving
    // it is the window's to ask, as it is for any plan.
    [GATEWAY_METHOD.PLANNING_ARCHIVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningArchiveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("archiving a plan names it and whether it is archived");
        }
        if (!gate()) return { changed: false };
        return yield* markPlan(read.success.planId, { archived: read.success.archived });
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
    // The plan the service answered is drawn in place, so the edit stands on
    // the document at once and the notetaker's drafts drawn before it drop.
    [GATEWAY_METHOD.PLANNING_EDIT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningEditParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("an edit names a plan, and its document's base and value");
        }
        if (!gate()) return carried<PlanningEditAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        const { planId, edit } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const edited = yield* Effect.provide(client.edit(planId, edit), FetchHttpClient.layer);
            if (!edited.ok) return carried<PlanningEditAnswer>({ failure: edited.failure });
            const answer = edited.answer;
            if ("conflict" in answer)
              return carried<PlanningEditAnswer>({ conflict: answer.conflict });
            if ("refused" in answer)
              return carried<PlanningEditAnswer>({ failure: answer.refused });
            developerSaved = { planId, at: answer.plan.updatedAt };
            takeAnswered(answer.plan);
            return carried<PlanningEditAnswer>({ saved: true });
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
    // The board reads a settled draw asks for and the transcript and work
    // reads a call's end asks for; every other read of the plans is an ask's.
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
          Effect.flatMap(Queue.take(callEndReads), (planId) => {
            const read = Effect.suspend(() =>
              gate() && view.activePlanId === planId
                ? serial(Effect.andThen(readTranscript(planId), readWork(planId)))
                : Effect.void,
            );
            return Effect.andThen(read, Effect.andThen(Effect.sleep(TRANSCRIPT_SETTLE), read));
          }),
        ),
      );
    }),
  };
});
