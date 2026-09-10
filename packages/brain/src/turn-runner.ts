import {
  type ChildPolicyContext,
  type EffectiveToolPolicy,
  queueSummaryText,
} from "@sidecar/runtime";
import {
  type AgentRuntime,
  CONTEXT_INPUT_KIND,
  type ContextMark,
  type ReasoningEffort,
  RUN_END_REASON,
  RUN_ORIGIN,
  RUNTIME_EVENT,
  type RuntimeEvent,
  type RuntimeRun,
  type RuntimeRunEnd,
} from "@sidecar/runtime/vocabulary";
import {
  joinReplyMessages,
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  type SessionIdentity,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { BRAIN_DEFAULTS } from "./defaults.js";
import {
  CONTEXT_OPENING,
  claimOpenedContext,
  type Generation,
  retireContext,
} from "./generation.js";
import {
  activityNoticesInputText,
  askInputText,
  primedNotesInputText,
  standingContextText,
  subagentTaskInputText,
} from "./input-items.js";
import { UNKNOWN_ACTION_RESULT } from "./journal.js";
import type { RunEnd } from "./ledger.js";
import { inboxEvents } from "./observation-inbox.js";
import type { BrainActionExecution, BrainActionPerformer, BrainRoster } from "./performer.js";
import { sameIdentity } from "./records.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  type BrainRequestRecord,
} from "./requests.js";
import { incompleteDetail, TOOL_RESULT_STATUS } from "./runtime.js";
import type { AgentSeam } from "./seam.js";
import { settledUnlessAborted } from "./settled.js";
import { SteeredDeliveries } from "./steered-deliveries.js";
import {
  type BrainChildAccess,
  type BrainMemoryAccess,
  type BrainWorkspaceAccess,
  createTurnToolExecutor,
  journaledEffect,
} from "./tool-executor.js";
import { brainToolCatalog, brainToolSchemas, resolveTurnToolPolicy } from "./tools.js";
import type { BrainToolCallTrace, BrainTurnTraceRecord } from "./trace.js";
import { attachTranscriptDeltas, readWholeTranscript } from "./transcript-reads.js";
import {
  BRAIN_TURN_KIND,
  BRAIN_TURN_TRIGGER,
  type BrainTurnDescription,
  type BrainTurnPreparation,
  type BrainTurnTrigger,
  REPORTED_OUTCOMES,
  type RunControl,
  runOriginOf,
  TURN_OUTCOME,
  type TurnContext,
  type TurnPlan,
  type TurnResult,
  turnRevoked,
} from "./turn.js";
import {
  BRAIN_WAKE_KIND,
  type BrainDelivery,
  type BrainTurnNotice,
  type BrainTurnReport,
  type BrainWakeEvent,
} from "./wake-events.js";

/**
 * What a run's end is read from: the flags its own execution set and the
 * generation it ran in. A rider's end is the primary's flags with its own
 * record, so nothing has to fabricate a control to reuse the reading.
 */
type RunEndFlags = Pick<
  RunControl,
  "generation" | "cancelled" | "timedOut" | "checkpointFailed" | "compactionFailed"
>;

/** What a turn came to and the run it ran under, read by the settlement that follows every exit. */
interface OpenedTurn {
  result: TurnResult;
  run: RunControl | undefined;
}

/** How a run ended, as its record takes it: the status and what rides beside it. */
interface RunOutcome {
  status: BrainRequestRecord["status"];
  end: RunEnd;
}

/** The execution under way: for an ask to steer into or interrupt, and for a steered delivery to be answered through its plan's deliveries. */
export interface ActiveExecution {
  run: RunControl;
  started: RuntimeRun;
  plan: TurnPlan;
  /** The asks riding inside the run, settled with its end. */
  riders: RunControl[];
}

/** What one turn gathers as it runs, for its trace and its deliveries. */
interface TurnGathering {
  toolCalls: BrainToolCallTrace[];
  deliveries: BrainDelivery[];
  iterations: number;
  compacted: boolean;
  inputTokens?: number;
  /** Each answer's words in order, the empty ones included, so the reply is composed from all of them. */
  said: string[];
  outputText: string;
  /** The final answer's shortfall, when it stopped short with words still delivered. */
  incomplete?: string;
  error?: string;
}

/**
 * One ask as its turn reads it: the run that records it and the words the
 * model is shown for it, its question or, once the overflow folded it, the
 * one summary line the queue cut it to.
 */
export interface AskInput {
  readonly run: RunControl;
  readonly text: string;
  readonly folded: boolean;
}

/** A run's live controls as every run starts: nothing revoked, nothing failed, nothing yet done. */
export function newRunControl(
  runId: string,
  generation: Generation,
  recorded: boolean,
): RunControl {
  return {
    runId,
    generation,
    recorded,
    abort: new AbortController(),
    cancelled: false,
    timedOut: false,
    checkpointFailed: false,
    performedActions: 0,
    unknownActions: 0,
  };
}

/** The question one turn opens with for the asks that opened it: the overflow's summary first, then each ask's words. */
export function askQuestion(opened: readonly AskInput[]): string {
  const summaryLines = opened.filter((input) => input.folded).map((input) => input.text);
  const summary = queueSummaryText({
    entries: [],
    summaryLines,
    summarizedCount: summaryLines.length,
  });
  return [
    ...(summary === undefined ? [] : [summary]),
    ...opened.filter((input) => !input.folded).map((input) => input.text),
  ].join("\n\n");
}

export interface TurnRunnerOptions {
  seam: AgentSeam;
  runtime: AgentRuntime;
  actions: BrainActionPerformer;
  roster: () => BrainRoster;
  standingContext: () => string;
  prepareTurn: (turn: BrainTurnDescription) => BrainTurnPreparation | Promise<BrainTurnPreparation>;
  readTranscriptSince: (
    identity: SessionIdentity,
    cursor: string | undefined,
  ) => Promise<ProviderTranscriptSinceResult>;
  readTranscript: (identity: SessionIdentity) => Promise<ProviderTranscriptResult>;
  deliver: (delivery: BrainDelivery) => void | Promise<void>;
  notice?: (report: BrainTurnReport) => void;
  trace?: (record: BrainTurnTraceRecord) => void;
  openingNotes?: BrainOpeningNotes;
  workspace?: BrainWorkspaceAccess;
  children?: BrainChildAccess;
  memory?: BrainMemoryAccess;
  primeFreshContext?: () => Promise<string | undefined>;
  inheritedContext?: readonly WireRecord[];
  child?: ChildPolicyContext;
  createRunId: () => string;
  maximumOutputTokens: number;
  reasoningEffort?: ReasoningEffort;
  promptCacheKey?: string;
  executionDeadlineMs: number;
  /** The one compaction path, owned by the maintenance that also holds the flush counters. */
  compactIfNeeded: (
    turnContext: Omit<TurnContext, "run"> & { run?: RunControl },
    prompt: string,
    countedTokens?: number,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Queues the optional compaction a settled turn leaves behind. */
  scheduleMaintenance: (turnContext: TurnContext, countedTokens: number | undefined) => void;
  /** The ask ledger's seams: what a waiting ask may do, and who hears a record change. */
  opensAsk: (run: RunControl) => Promise<boolean>;
  forgetRun: (runId: string) => void;
  notifyRecords: () => void;
  flushAskQueue: () => void;
}

/**
 * Words the host owes this conversation's next turn — the compact notices of
 * what sibling conversations did — taken when a turn opens and handed back
 * when that turn fails, so nothing is consumed by a turn that never ran.
 */
export interface BrainOpeningNotes {
  take(): readonly BrainTurnNotice[];
  restore(notes: readonly BrainTurnNotice[]): void;
}

/**
 * One turn, from the door to the settlement: the generation's context
 * claimed, the policy resolved once, the opening words composed, the runtime
 * driven, every answered effect checkpointed before the model is asked again,
 * and the rollback that follows a failure. It reaches a model only through
 * the runtime it was handed, and nothing here reads inside a provider's item.
 */
export class TurnRunner {
  readonly #options: TurnRunnerOptions;
  readonly #seam: AgentSeam;
  #turnInFlight = false;
  /** The execution under way, for an ask to steer into or interrupt, and the asks riding inside it. */
  #active: ActiveExecution | undefined;

  constructor(options: TurnRunnerOptions) {
    this.#options = options;
    this.#seam = options.seam;
  }

  /** Whether a turn or the maintenance holds the context; a look waits for it. */
  inFlight(): boolean {
    return this.#turnInFlight;
  }

  /** The execution under way, for an ask to steer into and a completion to be delivered through. */
  active(): ActiveExecution | undefined {
    return this.#active;
  }

  /** Maintenance holds the context the way a turn does, and says so here. */
  holdInFlight(held: boolean): void {
    this.#turnInFlight = held;
  }

  /**
   * Opens one turn for the asks a drain handed over. The first of them that
   * can still open stands as the turn's run and the rest ride inside it; an
   * ask already revoked, or one whose start the store refuses, settles here
   * and leaves the turn to the next, so asks behind a run that never opened
   * are not lost. The question the model reads is composed here from the
   * asks that opened, and from no other: the overflow's summary from the
   * folded ones, then each ask's own words.
   */
  async runAsk(inputs: readonly AskInput[]): Promise<void> {
    const waiting = [...inputs];
    while (waiting.length > 0) {
      const primary = waiting.shift();
      if (!primary || !(await this.#options.opensAsk(primary.run))) continue;
      const run = primary.run;
      const generation = run.generation;
      // The start is durable before any work opens: a run the file does not
      // show running is one a relaunch would find queued while its actions had
      // begun, and a cancel would settle on the queued path under a dispatched
      // effect. A start the store refuses ends the run as the persistence
      // failure it is, with nothing called; a revocation that landed while the
      // start was being written ends it on its own terms, likewise unopened.
      const started = await this.#seam.ledger.commit(generation, run.runId, {
        status: BRAIN_REQUEST_STATUS.RUNNING,
        startedAt: this.#seam.now(),
      });
      this.#options.notifyRecords();
      if (!started || this.#seam.runRevoked(run)) {
        this.#options.forgetRun(run.runId);
        if (this.#seam.runRevoked(run)) {
          await this.#seam.ledger.settleRun(
            generation,
            run.runId,
            run.cancelled ? BRAIN_REQUEST_STATUS.CANCELLED : BRAIN_REQUEST_STATUS.INTERRUPTED,
            {},
          );
        } else {
          await this.#seam.ledger.settleRun(
            generation,
            run.runId,
            BRAIN_REQUEST_STATUS.FAILED,
            { failure: BRAIN_REQUEST_FAILURE.PERSISTENCE },
            run,
          );
        }
        continue;
      }
      const riders: RunControl[] = [];
      const opened: AskInput[] = [primary];
      for (const rider of waiting.splice(0)) {
        if (!(await this.#options.opensAsk(rider.run))) continue;
        riders.push(rider.run);
        opened.push(rider);
        await this.#seam.ledger.commit(rider.run.generation, rider.run.runId, {
          status: BRAIN_REQUEST_STATUS.RUNNING,
          startedAt: this.#seam.now(),
        });
      }
      if (riders.length > 0) this.#options.notifyRecords();
      const question = askQuestion(opened);
      run.deadline = this.#seam.schedule(() => {
        run.timedOut = true;
        run.abort.abort();
      }, this.#options.executionDeadlineMs);
      // A child's task runs under its own trigger: the words open as the
      // delegated task rather than the developer's ask, and the final text is
      // the result its requester is handed rather than speech.
      const childTask = generation.requests.get(run.runId)?.origin === BRAIN_REQUEST_ORIGIN.CHILD;
      let result: TurnResult;
      try {
        const opened = {
          generation,
          deliveries: new SteeredDeliveries(),
          events: inboxEvents(generation.inbox),
          run,
        };
        result = await this.turn(
          childTask
            ? {
                ...opened,
                trigger: BRAIN_TURN_TRIGGER.CHILD_TASK,
                open: (_attached, now) => [subagentTaskInputText(question, now)],
              }
            : {
                ...opened,
                trigger: BRAIN_TURN_TRIGGER.ASK,
                open: (attached, now) => [askInputText(question, attached, now)],
              },
          riders,
        );
      } catch {
        result = { outcome: TURN_OUTCOME.FAILED };
      }
      if (run.deadline !== undefined) this.#seam.cancel(run.deadline);
      this.#options.forgetRun(run.runId);
      const { status, end } = runOutcomeOf(run, result, this.#seam.stopped());
      await this.#seam.ledger.settleRun(generation, run.runId, status, end, run);
      return;
    }
  }

  /**
   * Settles the asks that rode inside another turn — steered into it, or
   * drained with it — with that turn's own end: the reply the turn reached is
   * their reply, and its failure is theirs, a final write that failed
   * included. Each keeps its own record and its own acceptance; only the
   * execution was shared.
   */
  async #settleRiders(
    riders: readonly RunControl[],
    primary: RunControl,
    result: TurnResult,
  ): Promise<void> {
    for (const rider of riders) {
      this.#options.forgetRun(rider.runId);
      const { status, end } = runOutcomeOf(primary, result, this.#seam.stopped());
      await this.#seam.ledger.settleRun(primary.generation, rider.runId, status, end);
    }
  }

  /**
   * One turn, settled whole: however it ends — at the door, by a thrown
   * hook, or by the model — the asks riding in it end with it, the asks that
   * waited behind it open, and an observation turn leaves its notice.
   */
  async turn(plan: TurnPlan, riders: RunControl[] = []): Promise<TurnResult> {
    let outcome: OpenedTurn;
    try {
      outcome = await this.#openTurn(plan, riders);
    } catch {
      outcome = { result: { outcome: TURN_OUTCOME.FAILED }, run: plan.run };
    }
    const { result, run } = outcome;
    // Riders ride an ask's turn alone, and an ask always brings its run.
    if (plan.run) await this.#settleRiders(riders, plan.run, result);
    // Asks that arrived while this turn ran open now rather than waiting out
    // the queue's debounce: what they were waiting for has ended.
    this.#options.flushAskQueue();
    if (
      run &&
      runOriginOf(plan.trigger) !== RUN_ORIGIN.USER &&
      REPORTED_OUTCOMES.has(result.outcome)
    ) {
      this.#options.notice?.({
        trigger: plan.trigger,
        identities: uniqueIdentities(plan.events),
        briefings: result.outcome === TURN_OUTCOME.DONE ? result.briefings : [],
        performedActions: run.performedActions,
        at: this.#seam.now(),
      });
    }
    return result;
  }

  /** The turn itself, answering its result and the run it ran under; the door's refusals answer the plan's own. */
  async #openTurn(plan: TurnPlan, riders: RunControl[]): Promise<OpenedTurn> {
    await this.#seam.ready();
    // The generation's death is checked at the door of every turn, so a
    // memory that outlived its fortnight while the app sat idle is not read
    // one more time on the way out.
    this.#seam.expireIfDue();
    const generation = plan.generation;
    // Work queued in a generation since replaced opens nothing: its briefings
    // and its wakes described a memory that no longer exists.
    if (generation !== this.#seam.generation() || generation.abort.signal.aborted) {
      return { result: { outcome: TURN_OUTCOME.REVOKED }, run: plan.run };
    }
    const opened = await generation.opened;
    if (generation !== this.#seam.generation() || generation.abort.signal.aborted) {
      return { result: { outcome: TURN_OUTCOME.REVOKED }, run: plan.run };
    }
    if (opened.kind === CONTEXT_OPENING.INCOMPATIBLE) {
      // The memory is kept as it is and nothing is read or written over it.
      this.#seam.reportIncompatible(generation, opened.reason);
      return { result: { outcome: TURN_OUTCOME.INCOMPATIBLE }, run: plan.run };
    }
    const context = opened.context;
    // An observation turn runs under an unrecorded run of its own, so an action
    // it takes is journaled, checkpointed, and revoked exactly as an ask's.
    // Its id comes from the same minter as an ask's, never a counter: a
    // counter starts over with every agent, and a journal row a crashed turn
    // left under the same id would be answered as this turn's own action.
    const run =
      plan.run ??
      newRunControl(`${plan.trigger}:${this.#options.createRunId()}`, generation, false);
    // An observation turn holds the queue as an ask does, so it ends at the
    // same deadline: a model that never answers cannot stall every turn
    // behind it.
    if (!plan.run) {
      run.deadline = this.#seam.schedule(() => {
        run.timedOut = true;
        run.abort.abort();
      }, this.#options.executionDeadlineMs);
    }
    const consumes = plan.events.flatMap((event) => (event.entryId ? [event.entryId] : []));
    const turnContext: TurnContext = {
      generation,
      context,
      run,
      signal: AbortSignal.any([generation.abort.signal, run.abort.signal]),
      ...(consumes.length > 0 ? { consumes } : undefined),
    };
    this.#turnInFlight = true;
    let ended = false;
    const execution: BrainActionExecution = {
      runId: run.runId,
      origin: runOriginOf(plan.trigger),
      isRevoked: () => ended || this.#revoked(turnContext),
      signal: turnContext.signal,
    };
    try {
      return { result: await this.#runTurn(plan, turnContext, execution, riders), run };
    } finally {
      ended = true;
      if (!plan.run && run.deadline !== undefined) this.#seam.cancel(run.deadline);
      this.#turnInFlight = false;
      // Steered words no checkpoint of the turn carried are owed still.
      plan.deliveries.turnEnded();
      this.#active = undefined;
    }
  }

  async #runTurn(
    plan: TurnPlan,
    turnContext: TurnContext,
    execution: BrainActionExecution,
    riders: RunControl[],
  ): Promise<TurnResult> {
    const { generation, context, run } = turnContext;
    const startedAt = this.#seam.now();
    let contextMark: ContextMark = context.mark();
    let cursorMark = generation.cursors.persisted();
    const gathering: TurnGathering = {
      toolCalls: [],
      deliveries: [],
      iterations: 0,
      compacted: false,
      said: [],
      outputText: "",
    };
    let preparation: BrainTurnPreparation | undefined;
    let policy: EffectiveToolPolicy | undefined;
    let notes: readonly BrainTurnNotice[] = [];
    const revocation = (): TurnResult => {
      gathering.error = run.timedOut ? "execution deadline passed" : "turn revoked";
      return { outcome: TURN_OUTCOME.REVOKED };
    };
    if (this.#revoked(turnContext)) return revocation();

    // The consumed cursor moves to where each entry's capture read, in
    // memory now and on disk with the checkpoint; a turn that fails rolls it
    // back with the context, and the entries stand for the next one.
    for (const entry of generation.inbox) {
      if (entry.cursor !== undefined && turnContext.consumes?.includes(entry.id)) {
        generation.cursors.setCursor(
          { providerId: entry.providerId, providerSessionId: entry.providerSessionId },
          entry.cursor,
        );
      }
    }
    const attachedDeltas = await attachTranscriptDeltas(plan.events, {
      cursors: generation.cursors,
      read: (identity, cursor) => this.#options.readTranscriptSince(identity, cursor),
      signal: turnContext.signal,
      maximumChars: BRAIN_DEFAULTS.DELTA_PER_SESSION_CHARS,
      revoked: () => this.#revoked(turnContext),
    });
    const transcriptBytes = attachedDeltas.transcriptBytes;
    let failure: TurnResult | undefined;
    if (this.#revoked(turnContext)) {
      // Nothing the reads gained opens an inference the developer or the
      // host has already withdrawn; the cursors go back with the context.
      failure = revocation();
    } else {
      // A scheduled look carries the whole roster in its own words, so a
      // session whose transcript gained nothing is left out of the events
      // rather than repeated as an empty delta.
      const events =
        plan.trigger === BRAIN_TURN_TRIGGER.ROSTER
          ? attachedDeltas.events.filter(
              (event) =>
                event.kind !== BRAIN_WAKE_KIND.ROSTER || Boolean(event.transcriptDelta?.text),
            )
          : attachedDeltas.events;
      // Every turn advances its rollback point: each answered effect is
      // checkpointed and the mark moves past it, so a later failure returns
      // the context to the last paired state and never to before an action that
      // already happened. A turn that fails before its first effect still
      // rolls back whole, and the deltas it read are read again.
      const advanceMark = async () => {
        if (await this.#seam.ledger.checkpoint(turnContext)) plan.deliveries.persisted();
        else run.checkpointFailed = true;
        contextMark = context.mark();
        cursorMark = generation.cursors.persisted();
      };
      try {
        preparation = await this.#options.prepareTurn({
          kind: BRAIN_TURN_KIND.TURN,
          trigger: plan.trigger,
        });
        policy = this.#resolvePolicy(preparation, plan.trigger);
        const prepared = this.#revoked(turnContext)
          ? { ok: true as const }
          : await this.#options.compactIfNeeded(turnContext, preparation.prompt);
        if (this.#revoked(turnContext)) {
          failure = revocation();
        } else if (!prepared.ok) {
          // The request would not fit and the context could not be folded:
          // the run fails recoverably, and what stands is exactly what stood.
          run.compactionFailed = true;
          gathering.error = `compaction required: ${prepared.reason}`;
          failure = { outcome: TURN_OUTCOME.FAILED };
        } else {
          // The admission's compaction, if any, is the new rollback point: a
          // turn that then fails returns to the folded context, not before it.
          // The cursors keep their mark from before the deltas were read, so
          // a failed turn still reads them again.
          contextMark = context.mark();
          const primed = await this.#primeIfFresh(turnContext);
          notes = this.#options.openingNotes?.take() ?? [];
          const end = await this.#execute(turnContext, execution, gathering, {
            prompt: preparation.prompt,
            policy,
            plan,
            riders,
            opening: [
              ...primed,
              ...(notes.length > 0 ? [activityNoticesInputText(notes, startedAt)] : []),
              ...plan.open(events, startedAt),
            ],
            advanceMark,
          });
          failure = this.#turnResultFrom(end, turnContext, gathering);
        }
      } catch (runtimeError) {
        // A runtime that threw instead of ending: the turn fails like one
        // whose model failed, and rolls back to the last paired state.
        gathering.error = runtimeError instanceof Error ? runtimeError.name : "unknown error";
        failure = this.#revoked(turnContext) ? revocation() : { outcome: TURN_OUTCOME.FAILED };
      }
    }

    // An unrecorded run's journal has done its work once the turn's actions have
    // settled: their results stand in the context, and no record waits for
    // their count. It goes before the final checkpoint so the store never
    // accumulates the journals of every observation turn.
    if (!run.recorded) generation.journal.dropRuns([run.runId]);
    if (failure) {
      await this.#restoreContext(turnContext, contextMark);
      generation.cursors.rollback(cursorMark);
      if (notes.length > 0) this.#options.openingNotes?.restore(notes);
      this.#seam.report(`Brain ${plan.trigger} turn did not complete: ${gathering.error}`);
    } else {
      generation.cursors.retain(this.#options.roster().identities);
      generation.captureCursors.retain(this.#options.roster().identities);
      const written = await this.#seam.ledger.checkpoint(turnContext);
      if (!written) run.checkpointFailed = true;
      if (written) {
        plan.deliveries.persisted();
        await context.afterTurn({ signal: turnContext.signal });
      }
      // A briefing leaves only from a turn that still stands: the stop or the
      // replacement that landed during the write — or during an earlier
      // briefing — withdraws every one not yet handed over, and a checkpoint
      // the store refused is one such withdrawal made visible.
      for (const delivery of gathering.deliveries) {
        if (this.#revoked(turnContext) || !written) {
          gathering.error = "turn revoked before delivery";
          break;
        }
        try {
          await this.#options.deliver(delivery);
        } catch (deliverError) {
          this.#seam.report(
            `Brain briefing could not be delivered: ${deliverError instanceof Error ? deliverError.name : "unknown error"}`,
          );
        }
      }
      // Housekeeping waits for the reply to be persisted and its deliveries
      // to settle, then decides against the window the turn's own count says.
      if (written && !this.#revoked(turnContext)) {
        this.#options.scheduleMaintenance(turnContext, gathering.inputTokens);
      }
    }

    const { id: runtime, model } = this.#options.runtime.descriptor;
    this.#options.trace?.({
      trigger: plan.trigger,
      origin: runOriginOf(plan.trigger),
      runtime,
      tools: policy?.allowed.map((tool) => tool.schema.name) ?? [],
      promptChars: preparation?.prompt.length ?? 0,
      ...(gathering.inputTokens !== undefined ? { inputTokens: gathering.inputTokens } : undefined),
      transcriptBytes,
      toolCalls: gathering.toolCalls,
      ...(gathering.outputText ? { outputText: gathering.outputText } : undefined),
      ...(gathering.incomplete ? { incomplete: gathering.incomplete } : undefined),
      deliveries: gathering.deliveries.map((delivery) => ({
        briefingChars: delivery.briefing.length,
      })),
      ...(model ? { model } : undefined),
      elapsedMs: this.#seam.now() - startedAt,
      iterations: gathering.iterations,
      compacted: gathering.compacted,
      ...(gathering.error ? { error: gathering.error } : undefined),
    });

    return (
      failure ?? {
        outcome: TURN_OUTCOME.DONE,
        text: gathering.outputText,
        briefings: gathering.deliveries.map((delivery) => delivery.briefing),
      }
    );
  }

  /**
   * Stands the generation's context back at the mark the turn last committed
   * past — the start of the turn for an observation, the last checkpointed
   * tool result for a run — on a fresh engine, because a late hook of the
   * old engine may still apply to it. A reopen the runtime refuses leaves the
   * generation standing without a context, its stored checkpoint untouched.
   */
  async #restoreContext(turnContext: TurnContext, mark: ContextMark): Promise<void> {
    const { generation, context } = turnContext;
    const reopened = await claimOpenedContext(
      this.#options.runtime.openContext(
        { format: context.checkpointFormat, items: mark.items },
        JSON.stringify(UNKNOWN_ACTION_RESULT),
        { signal: generation.abort.signal },
      ),
      generation.abort.signal,
      "the runtime could not reopen its own checkpoint",
      this.#seam.now,
    );
    if (reopened.aborted) return;
    const standing = await generation.opened;
    const stillUsed = standing.kind === CONTEXT_OPENING.LOADED && standing.context === context;
    if (generation !== this.#seam.generation() || !stillUsed) {
      if (reopened.value.kind === CONTEXT_OPENING.LOADED) retireContext(reopened.value.context);
      return;
    }
    // The engine the turn used is not re-admitted either way: it may hold
    // what a late hook applied. A refused reopen leaves the generation
    // standing without a context, every turn over it refused as incompatible.
    generation.opened = Promise.resolve(reopened.value);
    retireContext(context);
    if (reopened.value.kind === CONTEXT_OPENING.INCOMPATIBLE) {
      this.#seam.reportIncompatible(generation, reopened.value.reason);
    }
  }

  /**
   * The one-shot priming of a conversation that just started fresh: a
   * context with nothing in it yet is handed the host's primer — the recent
   * daily notes — as the first words of its first turn, behind a marker that
   * says it is data. An ordinary turn over a context with items reads none.
   */
  async #primeIfFresh(turnContext: TurnContext): Promise<readonly string[]> {
    const context = turnContext.context;
    if (context.checkpoint().items.length > 0) return [];
    const inherited = this.#options.inheritedContext;
    if (inherited && inherited.length > 0) {
      // A forked child: the requester's context is the child's opening
      // history, adopted whole and recorded as a fork boundary, and the task
      // then follows it as the first words of the child's own.
      await settledUnlessAborted(
        Promise.resolve(context.adoptFork(inherited, { signal: turnContext.signal })),
        turnContext.signal,
      );
      return [];
    }
    const primer = this.#options.primeFreshContext;
    if (!primer) return [];
    const settled = await settledUnlessAborted(primer(), turnContext.signal);
    if (settled.aborted || !settled.value) return [];
    return [primedNotesInputText(settled.value)];
  }

  /**
   * The one resolution of a turn's tools: the host's configured layers over
   * the catalog it named, then the turn's own layer. The same policy fixes
   * the schemas the model is offered and the gate every dispatch meets.
   */
  #resolvePolicy(
    preparation: BrainTurnPreparation,
    trigger: BrainTurnTrigger,
  ): EffectiveToolPolicy {
    return resolveTurnToolPolicy(
      preparation.catalog ?? brainToolCatalog(),
      preparation.layers,
      trigger,
      this.#options.child,
    );
  }

  /**
   * One execution on the runtime: the opening words, the toolset the
   * effective policy fixes, the standing context rebuilt for every
   * inference, and a listener that keeps what the run gathers and
   * checkpoints each answered effect before the runtime asks the model again.
   */
  #execute(
    turnContext: TurnContext,
    execution: BrainActionExecution,
    gathering: TurnGathering,
    turn: {
      prompt: string;
      policy: EffectiveToolPolicy;
      plan: TurnPlan;
      riders: RunControl[];
      opening: readonly string[];
      advanceMark: () => Promise<void>;
    },
  ): Promise<RuntimeRunEnd> {
    const { context, run } = turnContext;
    const runId = run.runId;
    const tools = createTurnToolExecutor(
      {
        roster: this.#options.roster,
        actions: this.#options.actions,
        workspace: this.#options.workspace,
        children: this.#options.children,
        memory: this.#options.memory,
        readWhole: (identity, readContext) =>
          readWholeTranscript(identity, {
            read: (session) => this.#options.readTranscript(session),
            signal: readContext.signal,
            maximumChars: BRAIN_DEFAULTS.FULL_TRANSCRIPT_CHARS,
          }),
        checkpoint: (checkpointContext) => this.#seam.ledger.checkpoint(checkpointContext),
        runRevoked: (checked) => this.#seam.runRevoked(checked),
        now: this.#seam.now,
      },
      {
        policy: turn.policy,
        context: turnContext,
        execution,
        onBriefing: (delivery) => gathering.deliveries.push(delivery),
      },
    );
    const onEvent = async (event: RuntimeEvent) => {
      switch (event.kind) {
        case RUNTIME_EVENT.ANSWERED:
          if (event.toolCalls > 0) gathering.iterations += 1;
          return;
        case RUNTIME_EVENT.TEXT:
          gathering.said.push(event.text);
          gathering.outputText = joinReplyMessages(gathering.said);
          return;
        case RUNTIME_EVENT.USAGE:
          if (event.usage.inputTokens !== undefined) {
            gathering.inputTokens = event.usage.inputTokens;
          }
          return;
        case RUNTIME_EVENT.COMPACTED:
          gathering.compacted = true;
          turnContext.generation.compactionCount += 1;
          return;
        case RUNTIME_EVENT.STEERED:
          turn.plan.deliveries.ingested();
          return;
        case RUNTIME_EVENT.TOOL_RESULT:
          gathering.toolCalls.push({
            name: event.invocation.name,
            argumentsChars: event.invocation.argumentsJson.length,
            outcomeStatus: event.result.status ?? TOOL_RESULT_STATUS.ANSWERED,
          });
          // The answered tool is in the context. A recorded run keeps every
          // answer before the model is asked again; an unrecorded turn keeps
          // only an effect, so a turn that merely read and failed still rolls
          // back whole and reads its deltas again, while an action that happened
          // is never reverted.
          if (run.recorded || journaledEffect(turn.policy, event.invocation.name)) {
            await turn.advanceMark();
          }
          return;
        default:
          return;
      }
    };
    const started = this.#options.runtime.start({
      runId,
      context,
      tools,
      toolSchemas: brainToolSchemas(turn.policy),
      prompt: turn.prompt,
      input: turn.opening.map((text) => ({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text })),
      ephemeral: () => [
        standingContextText(
          this.#options.roster().text,
          this.#options.standingContext(),
          this.#seam.now(),
        ),
      ],
      maximumOutputTokens: this.#options.maximumOutputTokens,
      ...(this.#options.reasoningEffort
        ? { reasoningEffort: this.#options.reasoningEffort }
        : undefined),
      ...(this.#options.promptCacheKey !== undefined
        ? { promptCacheKey: this.#options.promptCacheKey }
        : undefined),
      signal: turnContext.signal,
      onEvent,
    });
    this.#active = { run, started, plan: turn.plan, riders: turn.riders };
    // Steered words the runtime never ingested are not delivered; words it
    // did ingest wait for the turn's final checkpoint, which decides them.
    return started.done.finally(() => turn.plan.deliveries.runEnded());
  }

  /** How a run's end reads as a turn's: an observation turn keeps what it read wherever a run would fall short. */
  #turnResultFrom(
    end: RuntimeRunEnd,
    turnContext: TurnContext,
    gathering: TurnGathering,
  ): TurnResult | undefined {
    if (this.#revoked(turnContext)) {
      gathering.error = turnContext.run.timedOut ? "execution deadline passed" : "turn revoked";
      return { outcome: TURN_OUTCOME.REVOKED };
    }
    switch (end.reason) {
      case RUN_END_REASON.COMPLETED:
        // The reply is everything the model said across the run, in order:
        // the words before a tool call are as much its answer as the words
        // after, and a final answer that said nothing drops none of them. The
        // end's own text is the final answer's, already reported as the last
        // words unless the runtime reported none.
        if (gathering.said.at(-1) !== end.text) gathering.said.push(end.text);
        gathering.outputText = joinReplyMessages(gathering.said);
        if (end.incomplete) gathering.incomplete = incompleteDetail(end.incomplete);
        return undefined;
      case RUN_END_REASON.THROTTLED:
        gathering.error = "quiet";
        return { outcome: TURN_OUTCOME.QUIET, until: end.until };
      case RUN_END_REASON.PROVIDER_FAILURE:
        gathering.error = end.detail;
        return { outcome: TURN_OUTCOME.FAILED };
      case RUN_END_REASON.INCOMPLETE:
      case RUN_END_REASON.LOOP_GUARD:
        // The model stopped short of any words. A run says it fell short
        // rather than claiming a reply; an observation turn has nobody to
        // answer, and keeps what it read so the deltas are not read twice.
        gathering.error = end.detail;
        return turnContext.run.recorded ? { outcome: TURN_OUTCOME.INCOMPLETE } : undefined;
      case RUN_END_REASON.CANCELLED:
      case RUN_END_REASON.DEADLINE:
        gathering.error =
          end.reason === RUN_END_REASON.DEADLINE ? "execution deadline passed" : "turn revoked";
        return { outcome: TURN_OUTCOME.REVOKED };
    }
  }

  #revoked(context: Pick<TurnContext, "signal">): boolean {
    return turnRevoked(this.#seam.stopped(), context);
  }
}

/** How a run's turn result reads as its record's end. */
export function runOutcomeOf(flags: RunEndFlags, result: TurnResult, stopped: boolean): RunOutcome {
  const end: RunEnd = {};
  let status: BrainRequestRecord["status"];
  if (flags.timedOut) {
    status = BRAIN_REQUEST_STATUS.TIMED_OUT;
    end.failure = BRAIN_REQUEST_FAILURE.DEADLINE;
  } else if (flags.cancelled) {
    status = BRAIN_REQUEST_STATUS.CANCELLED;
  } else if (stopped || flags.generation.abort.signal.aborted) {
    status = BRAIN_REQUEST_STATUS.INTERRUPTED;
  } else if (flags.checkpointFailed) {
    // What the run did may be unrecorded; that outranks whatever the model
    // did afterwards, and the reply, if one formed, still travels.
    status = BRAIN_REQUEST_STATUS.FAILED;
    end.failure = BRAIN_REQUEST_FAILURE.PERSISTENCE;
    if (result.outcome === TURN_OUTCOME.DONE && result.text) end.text = result.text;
  } else if (flags.compactionFailed) {
    status = BRAIN_REQUEST_STATUS.FAILED;
    end.failure = BRAIN_REQUEST_FAILURE.COMPACTION;
  } else if (result.outcome === TURN_OUTCOME.INCOMPLETE) {
    status = BRAIN_REQUEST_STATUS.FAILED;
    end.failure = BRAIN_REQUEST_FAILURE.INCOMPLETE;
  } else if (result.outcome !== TURN_OUTCOME.DONE) {
    status = BRAIN_REQUEST_STATUS.FAILED;
    end.failure = BRAIN_REQUEST_FAILURE.MODEL;
  } else {
    status = BRAIN_REQUEST_STATUS.SUCCEEDED;
    if (result.text) end.text = result.text;
  }
  return { status, end };
}

function uniqueIdentities(events: readonly BrainWakeEvent[]): readonly SessionIdentity[] {
  const seen: SessionIdentity[] = [];
  for (const event of events) {
    if (!seen.some((identity) => sameIdentity(identity, event.identity))) {
      seen.push({ ...event.identity });
    }
  }
  return seen;
}
