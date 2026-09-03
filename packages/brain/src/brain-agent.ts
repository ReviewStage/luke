import type { RealtimeFunctionCall } from "@sidecar/acts";
import type { ScheduledTimer } from "@sidecar/realtime";
import {
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  SESSION_LOCATION,
  SESSION_STATUS,
  type Session,
  type SessionIdentity,
} from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { BRAIN_CLIENT_OUTCOME, type BrainClient } from "./brain-client.js";
import {
  BRAIN_DELIVERY_SOURCE,
  BRAIN_WAKE_KIND,
  type BrainDelivery,
  type BrainDeliverySource,
  type BrainTranscriptDelta,
  type BrainWakeEvent,
} from "./brain-events.js";
import {
  askInputItem,
  holdReleasedInputItem,
  standingContextItem,
  wakeInputItem,
} from "./brain-input.js";
import { BrainMemory, type BrainPersistedState } from "./brain-memory.js";
import {
  type BrainFunctionCall,
  brainResponsesOutput,
  functionCallOutputItem,
  type ResponsesInputItem,
} from "./brain-openai.js";
import { BRAIN_TOOL, isBrainOnlyTool, maximumBriefingLength } from "./brain-tools.js";

/**
 * The brain: one long-lived agent that is woken by the agents' hooks and by
 * its own scheduled look at the roster, asked things by the developer, and
 * answers with briefings for the voice to speak and acts for the host to
 * carry. Nothing detects a change on its behalf: the roster look carries
 * what stands and what each transcript gained, and the brain notices what is
 * new against its own memory. It is transport- and storage-agnostic on
 * purpose — the client, the roster rendering, the transcript reads, the
 * delivery, and the persistence are all handed in — so the same agent runs in
 * the desktop's main process and, later, behind a service request.
 *
 * Every write it can cause still runs the host's own validation: an act tool
 * call goes to the performer as a function call and nothing more, and the host
 * validates it against what it observed exactly as it would a spoken one.
 */

export const BRAIN_DEFAULTS = {
  MAXIMUM_OUTPUT_TOKENS: 16_000,
  MAX_TOOL_ITERATIONS: 8,
  /** Wakes inside this window open one turn together: a hook and the poll's edge for the same stop. */
  WAKE_COALESCE_MS: 3_000,
  /** How long an ask waits for its reply before the voice is told there is none. */
  ASK_DEADLINE_MS: 45_000,
  /** The most of one session's new transcript one wake carries, cut from the front. */
  DELTA_PER_SESSION_CHARS: 20_000,
  /** The most of a whole transcript one read answers with, cut from the front. */
  FULL_TRANSCRIPT_CHARS: 60_000,
} as const;

/**
 * How often the brain looks at the whole roster on its own clock, for the
 * providers no hook covers and for whatever a hook did not report. A look is
 * skipped while a turn is in flight or the client is quiet; the next one
 * catches up, because the look reads what each transcript gained since the
 * brain last saw it rather than what happened in the interval.
 */
export const BRAIN_ROSTER_WAKE_INTERVAL_MS = 60_000;

/** Stands where the front of a transcript was cut, so the model knows it is reading a tail. */
export const OMISSION_MARKER = "[… earlier transcript omitted …]";

export const BRAIN_TURN_TRIGGER = {
  WAKE: "wake",
  ROSTER: "roster",
  ASK: "ask",
  HOLD_RELEASED: "hold-released",
} as const;

export type BrainTurnTrigger = (typeof BRAIN_TURN_TRIGGER)[keyof typeof BRAIN_TURN_TRIGGER];

const REFUSAL_REASON = {
  UNOBSERVED_SESSION: "not an observed session",
  ANNOUNCE_IN_ASK: "reply in text: this is a developer ask, and your final text is the speech",
  EMPTY_BRIEFING: "a briefing needs words",
  BUDGET_SPENT: "not run: this turn's tool budget is spent",
  ACT_FAILED: "the act did not complete",
  READ_FAILED: "the transcript could not be read",
} as const;

/**
 * The roster as the host renders it, with the identities every tool argument
 * is validated against, and the sessions themselves for the scheduled look to
 * choose which transcripts to read.
 */
export interface BrainRoster {
  text: string;
  identities: readonly SessionIdentity[];
  sessions?: readonly Session[];
}

/** Carries one act for the host to validate and perform; answers what happened as a record. */
export interface BrainActPerformer {
  perform(call: RealtimeFunctionCall): Promise<WireRecord>;
}

export interface BrainAskAnswer {
  /** The reply, as the voice speaks it. */
  text: string;
}

export interface BrainToolCallTrace {
  name: string;
  argumentsChars: number;
  outcomeStatus: string;
}

/**
 * One turn as the development trace records it: what woke it, the kinds of
 * item it appended, the input size the API counted, how many transcript
 * characters it read, each tool call by name and outcome, the text and
 * briefings it produced, and how it ran — never a transcript's text.
 */
export interface BrainTurnTraceRecord {
  trigger: BrainTurnTrigger;
  inputItemKinds: readonly string[];
  inputTokens?: number;
  transcriptBytes: number;
  toolCalls: readonly BrainToolCallTrace[];
  outputText?: string;
  deliveries: readonly { briefingChars: number }[];
  model?: string;
  elapsedMs: number;
  iterations: number;
  compacted: boolean;
  error?: string;
}

export interface BrainAgentOptions {
  client: BrainClient;
  acts: BrainActPerformer;
  roster: () => BrainRoster;
  /** Everything the host renders beside the roster: projects, facts, recent conversation, guide. */
  standingContext: () => string;
  readTranscriptSince: (
    identity: SessionIdentity,
    cursor: string | undefined,
  ) => Promise<ProviderTranscriptSinceResult>;
  readTranscript: (identity: SessionIdentity) => Promise<ProviderTranscriptResult>;
  deliver: (delivery: BrainDelivery) => void | Promise<void>;
  persist: (state: BrainPersistedState) => void | Promise<void>;
  restore: () => BrainPersistedState | undefined | Promise<BrainPersistedState | undefined>;
  trace?: (record: BrainTurnTraceRecord) => void;
  report?: (message: string) => void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
  maximumOutputTokens?: number;
  maxToolIterations?: number;
  wakeCoalesceMs?: number;
  askDeadlineMs?: number;
  deltaPerSessionChars?: number;
  fullTranscriptChars?: number;
  rosterWakeIntervalMs?: number;
}

const TURN_OUTCOME = {
  DONE: "done",
  QUIET: "quiet",
  FAILED: "failed",
} as const;

type TurnResult =
  | { outcome: typeof TURN_OUTCOME.DONE; text: string }
  | { outcome: typeof TURN_OUTCOME.QUIET; until: number }
  | { outcome: typeof TURN_OUTCOME.FAILED };

interface TurnPlan {
  trigger: BrainTurnTrigger;
  events: readonly BrainWakeEvent[];
  open: (events: readonly BrainWakeEvent[], now: number) => readonly ResponsesInputItem[];
  deliverySource?: BrainDeliverySource;
  /** Whether a roster look's events with nothing new in their transcript are left out. */
  dropEmptyRosterDeltas?: boolean;
}

interface DispatchOutcome {
  callId: string;
  output: WireRecord;
}

/** A transcript held to a bound from the front, and whether anything was cut. */
interface FrontCut {
  text: string;
  cut: boolean;
}

function cutFront(value: string, maximumChars: number): FrontCut {
  if (value.length <= maximumChars) return { text: value, cut: false };
  const keep = Math.max(0, maximumChars - OMISSION_MARKER.length - 1);
  return { text: `${OMISSION_MARKER}\n${value.slice(value.length - keep)}`, cut: true };
}

function parsedArguments(argumentsJson: string): WireRecord {
  try {
    // SAFETY: JSON.parse returns a wire value; the record check below is the validation.
    const parsed = JSON.parse(argumentsJson) as UnparsedWireValue;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function identityFromRecord(value: UnparsedWireValue): SessionIdentity | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = text(value.provider_id);
  const providerSessionId = text(value.provider_session_id);
  return providerId && providerSessionId ? { providerId, providerSessionId } : undefined;
}

function sameIdentity(first: SessionIdentity, second: SessionIdentity): boolean {
  return (
    first.providerId === second.providerId && first.providerSessionId === second.providerSessionId
  );
}

function rejection(reason: string): WireRecord {
  return { status: ACT_RESULT_STATUS.REJECTED, reason };
}

/** Identities collected without a composite key: one list, membership by both fields. */
class IdentitySet {
  readonly #identities: SessionIdentity[] = [];

  add(identity: SessionIdentity): void {
    if (!this.#identities.some((held) => sameIdentity(held, identity))) {
      this.#identities.push({ ...identity });
    }
  }

  list(): readonly SessionIdentity[] {
    return [...this.#identities];
  }
}

export class BrainAgent {
  readonly #options: BrainAgentOptions;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly #cancel: (timer: ScheduledTimer) => void;
  readonly #report: (message: string) => void;
  readonly #maximumOutputTokens: number;
  readonly #maxToolIterations: number;
  readonly #wakeCoalesceMs: number;
  readonly #askDeadlineMs: number;
  readonly #deltaPerSessionChars: number;
  readonly #fullTranscriptChars: number;
  readonly #rosterWakeIntervalMs: number;
  #memory = new BrainMemory();
  #rosterTimer: ScheduledTimer | undefined;
  #turnInFlight = false;
  #restored: Promise<void> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #pending: BrainWakeEvent[] = [];
  #flushTimer: ScheduledTimer | undefined;
  #stopped = false;

  constructor(options: BrainAgentOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#schedule =
      options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.#cancel =
      options.cancel ??
      ((timer) => {
        // SAFETY: a timer this agent scheduled itself came from setTimeout above.
        globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>);
      });
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
    this.#maximumOutputTokens = options.maximumOutputTokens ?? BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS;
    this.#maxToolIterations = options.maxToolIterations ?? BRAIN_DEFAULTS.MAX_TOOL_ITERATIONS;
    this.#wakeCoalesceMs = options.wakeCoalesceMs ?? BRAIN_DEFAULTS.WAKE_COALESCE_MS;
    this.#askDeadlineMs = options.askDeadlineMs ?? BRAIN_DEFAULTS.ASK_DEADLINE_MS;
    this.#deltaPerSessionChars =
      options.deltaPerSessionChars ?? BRAIN_DEFAULTS.DELTA_PER_SESSION_CHARS;
    this.#fullTranscriptChars = options.fullTranscriptChars ?? BRAIN_DEFAULTS.FULL_TRANSCRIPT_CHARS;
    this.#rosterWakeIntervalMs = options.rosterWakeIntervalMs ?? BRAIN_ROSTER_WAKE_INTERVAL_MS;
  }

  /** Starts the scheduled roster looks; nothing is sent until the first interval has passed. */
  start(): void {
    if (this.#stopped || this.#rosterTimer !== undefined) return;
    this.#scheduleRosterLook();
  }

  /** How many wakes are waiting for their turn to open. */
  pendingWakes(): number {
    return this.#pending.length;
  }

  /**
   * Queues wake events. Nothing is sent yet: wakes inside the coalescing
   * window open one turn together, and wakes during a client's quiet wait for
   * it to end rather than being dropped.
   */
  wake(events: readonly BrainWakeEvent[]): void {
    if (this.#stopped || events.length === 0) return;
    this.#pending.push(...events);
    this.#scheduleFlush(this.#wakeCoalesceMs);
  }

  /**
   * Asks the brain on the developer's behalf. Pending wakes ride in the same
   * turn so the reply knows what just changed. Resolves with nothing when the
   * turn failed or the deadline passed; the turn itself still runs to its end
   * so the memory never holds half of one.
   */
  async ask(question: string): Promise<BrainAskAnswer | undefined> {
    if (this.#stopped) return undefined;
    this.#cancelFlush();
    const events = this.#takePending();
    const turn = this.#enqueue(() =>
      this.#turn({
        trigger: BRAIN_TURN_TRIGGER.ASK,
        events,
        open: (attached, now) => [askInputItem(question, attached, now)],
      }),
    );
    let deadline: ScheduledTimer | undefined;
    const timedOut = new Promise<undefined>((resolve) => {
      deadline = this.#schedule(() => resolve(undefined), this.#askDeadlineMs);
    });
    const result = await Promise.race([turn, timedOut]);
    if (deadline !== undefined) this.#cancel(deadline);
    if (result?.outcome !== TURN_OUTCOME.DONE) return undefined;
    return { text: result.text };
  }

  /**
   * Hands back briefings the host held while a meeting or a pause stood, for
   * one re-decision against the roster as it now stands. Pending wakes open
   * in the same turn, ahead of the held briefings, so the decision is made
   * knowing everything that happened during the hold.
   */
  releaseHeld(held: readonly BrainDelivery[]): void {
    if (this.#stopped || held.length === 0) return;
    this.#cancelFlush();
    const events = this.#takePending();
    void this.#enqueue(() =>
      this.#turn({
        trigger: BRAIN_TURN_TRIGGER.HOLD_RELEASED,
        events,
        open: (attached, now) => [
          ...(attached.length > 0 ? [wakeInputItem(attached, now)] : []),
          holdReleasedInputItem(held, now),
        ],
        deliverySource: BRAIN_DELIVERY_SOURCE.HOLD_RELEASED,
      }),
    );
  }

  /** Drops pending wakes, lets the running turn finish, and takes nothing more. */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#cancelFlush();
    if (this.#rosterTimer !== undefined) {
      this.#cancel(this.#rosterTimer);
      this.#rosterTimer = undefined;
    }
    this.#pending = [];
    await this.#queue;
  }

  #scheduleRosterLook(): void {
    this.#rosterTimer = this.#schedule(() => {
      this.#rosterTimer = undefined;
      this.#rosterLook();
      if (!this.#stopped) this.#scheduleRosterLook();
    }, this.#rosterWakeIntervalMs);
  }

  /**
   * The scheduled look at the whole roster: one turn carrying the roster as
   * `list_sessions` renders it and, for every local session the brain has
   * read before or that is working or waiting now, what its transcript gained
   * since — sessions with nothing new are left out. Skipped while a turn is in
   * flight or the client is quiet, because the next look reads the same
   * deltas; pending hook wakes ride along rather than waiting for their own.
   */
  #rosterLook(): void {
    if (this.#stopped || this.#turnInFlight) return;
    if (this.#options.client.quietUntil() !== undefined) return;
    const roster = this.#options.roster();
    const now = this.#now();
    const looks: BrainWakeEvent[] = (roster.sessions ?? []).flatMap((session) => {
      const identity: SessionIdentity = {
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      };
      const readBefore = this.#memory.cursor(identity) !== undefined;
      const live =
        session.status === SESSION_STATUS.WORKING || session.status === SESSION_STATUS.WAITING;
      if (session.location !== SESSION_LOCATION.LOCAL || !(readBefore || live)) return [];
      return [{ kind: BRAIN_WAKE_KIND.ROSTER, identity, session, atMs: now }];
    });
    this.#cancelFlush();
    const events = [...this.#takePending(), ...looks];
    void this.#enqueue(() =>
      this.#turn({
        trigger: BRAIN_TURN_TRIGGER.ROSTER,
        events,
        open: (attached, openedAt) => [wakeInputItem(attached, openedAt, roster.text)],
        deliverySource: BRAIN_DELIVERY_SOURCE.WAKE,
        dropEmptyRosterDeltas: true,
      }),
    );
  }

  #scheduleFlush(delayMs: number): void {
    if (this.#flushTimer !== undefined) return;
    this.#flushTimer = this.#schedule(() => {
      this.#flushTimer = undefined;
      this.#flush();
    }, delayMs);
  }

  #cancelFlush(): void {
    if (this.#flushTimer === undefined) return;
    this.#cancel(this.#flushTimer);
    this.#flushTimer = undefined;
  }

  #flush(): void {
    if (this.#stopped) return;
    const quietUntil = this.#options.client.quietUntil();
    if (quietUntil !== undefined) {
      this.#scheduleFlush(Math.max(quietUntil - this.#now(), this.#wakeCoalesceMs));
      return;
    }
    const events = this.#takePending();
    if (events.length === 0) return;
    void this.#enqueue(async () => {
      const result = await this.#turn({
        trigger: BRAIN_TURN_TRIGGER.WAKE,
        events,
        open: (attached, now) => [wakeInputItem(attached, now)],
        deliverySource: BRAIN_DELIVERY_SOURCE.WAKE,
      });
      if (result.outcome === TURN_OUTCOME.QUIET && !this.#stopped) {
        // The turn sent nothing, so the wakes are still news: they go back
        // to the front of the queue and open together once the quiet ends.
        this.#pending.unshift(...events);
        this.#scheduleFlush(Math.max(result.until - this.#now(), this.#wakeCoalesceMs));
      }
    });
  }

  #takePending(): readonly BrainWakeEvent[] {
    const events = this.#pending;
    this.#pending = [];
    return events;
  }

  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  #ready(): Promise<void> {
    this.#restored ??= (async () => {
      try {
        const state = await this.#options.restore();
        if (state) this.#memory = new BrainMemory(state);
      } catch (error) {
        this.#report(
          `Brain memory could not be restored: ${error instanceof Error ? error.name : "unknown error"}`,
        );
      }
    })();
    return this.#restored;
  }

  async #turn(plan: TurnPlan): Promise<TurnResult> {
    this.#turnInFlight = true;
    try {
      return await this.#runTurn(plan);
    } finally {
      this.#turnInFlight = false;
    }
  }

  async #runTurn(plan: TurnPlan): Promise<TurnResult> {
    await this.#ready();
    const startedAt = this.#now();
    const mark = this.#memory.mark();
    const appendedKinds: string[] = [];
    const toolCalls: BrainToolCallTrace[] = [];
    const deliveries: BrainDelivery[] = [];
    let iterations = 0;
    let compacted = false;
    let inputTokens: number | undefined;
    let outputText = "";
    let failure: TurnResult | undefined;
    let error: string | undefined;

    const append = (items: readonly ResponsesInputItem[]) => {
      this.#memory.append(items);
      for (const item of items) appendedKinds.push(text(item.type) ?? "unknown");
    };

    const attachedDeltas = await this.#attachDeltas(plan.events);
    const transcriptBytes = attachedDeltas.transcriptBytes;
    const events = plan.dropEmptyRosterDeltas
      ? attachedDeltas.events.filter(
          (event) => event.kind !== BRAIN_WAKE_KIND.ROSTER || Boolean(event.transcriptDelta?.text),
        )
      : attachedDeltas.events;
    append(plan.open(events, startedAt));

    for (;;) {
      const roster = this.#options.roster();
      const context = standingContextItem(
        roster.text,
        this.#options.standingContext(),
        this.#now(),
      );
      const answer = await this.#options.client.respond([...this.#memory.items(), context], {
        maximumOutputTokens: this.#maximumOutputTokens,
      });
      if (answer.outcome === BRAIN_CLIENT_OUTCOME.QUIET) {
        failure = { outcome: TURN_OUTCOME.QUIET, until: answer.until };
        error = "quiet";
        break;
      }
      if (answer.outcome === BRAIN_CLIENT_OUTCOME.FAILED) {
        failure = { outcome: TURN_OUTCOME.FAILED };
        error = answer.reason;
        break;
      }
      const output = brainResponsesOutput(answer.payload);
      if (!output) {
        failure = { outcome: TURN_OUTCOME.FAILED };
        error = "response carried no output";
        break;
      }
      append(output.items);
      if (output.compacted) {
        this.#memory.dropBeforeLatestCompaction();
        compacted = true;
      }
      if (output.inputTokens !== undefined) inputTokens = output.inputTokens;
      outputText = output.outputText;
      if (output.functionCalls.length === 0) {
        if (output.incompleteReason && !outputText) {
          error = `${output.status ?? "incomplete"}: ${output.incompleteReason}`;
        }
        break;
      }

      iterations += 1;
      if (iterations > this.#maxToolIterations) {
        // Every call still gets its output so the memory never holds a
        // dangling function_call; the model reads the refusals next turn.
        append(
          output.functionCalls.map((call) => {
            toolCalls.push({
              name: call.name,
              argumentsChars: call.argumentsJson.length,
              outcomeStatus: ACT_RESULT_STATUS.REJECTED,
            });
            return functionCallOutputItem(
              call.callId,
              JSON.stringify(rejection(REFUSAL_REASON.BUDGET_SPENT)),
            );
          }),
        );
        error = "tool iteration budget spent";
        break;
      }

      const outcomes = await Promise.all(
        output.functionCalls.map((call) =>
          this.#dispatch(call, roster, plan, deliveries).then((outcome) => {
            toolCalls.push({
              name: call.name,
              argumentsChars: call.argumentsJson.length,
              outcomeStatus: text(outcome.output.status) ?? "answered",
            });
            return outcome;
          }),
        ),
      );
      append(
        outcomes.map((outcome) =>
          functionCallOutputItem(outcome.callId, JSON.stringify(outcome.output)),
        ),
      );
    }

    if (failure) {
      this.#memory.rollback(mark);
      this.#report(`Brain ${plan.trigger} turn did not complete: ${error}`);
    } else {
      this.#memory.retainCursors(this.#options.roster().identities);
      try {
        await this.#options.persist(this.#memory.persisted());
      } catch (persistError) {
        this.#report(
          `Brain memory could not be persisted: ${persistError instanceof Error ? persistError.name : "unknown error"}`,
        );
      }
      for (const delivery of deliveries) {
        try {
          await this.#options.deliver(delivery);
        } catch (deliverError) {
          this.#report(
            `Brain briefing could not be delivered: ${deliverError instanceof Error ? deliverError.name : "unknown error"}`,
          );
        }
      }
    }

    this.#options.trace?.({
      trigger: plan.trigger,
      inputItemKinds: appendedKinds,
      ...(inputTokens !== undefined ? { inputTokens } : undefined),
      transcriptBytes,
      toolCalls,
      ...(outputText ? { outputText } : undefined),
      deliveries: deliveries.map((delivery) => ({ briefingChars: delivery.briefing.length })),
      ...(this.#options.client.model ? { model: this.#options.client.model } : undefined),
      elapsedMs: this.#now() - startedAt,
      iterations,
      compacted,
      ...(error ? { error } : undefined),
    });

    return failure ?? { outcome: TURN_OUTCOME.DONE, text: outputText };
  }

  /**
   * Reads what each woken session's transcript gained since the brain last
   * looked, once per session however many events name it, and moves the
   * cursor. The cursor moves with the memory: a turn that fails rolls both
   * back, so the same delta is read again rather than skipped.
   */
  async #attachDeltas(
    events: readonly BrainWakeEvent[],
  ): Promise<{ events: readonly BrainWakeEvent[]; transcriptBytes: number }> {
    const read = new IdentitySet();
    let transcriptBytes = 0;
    const attached: BrainWakeEvent[] = [];
    for (const event of events) {
      if (read.list().some((identity) => sameIdentity(identity, event.identity))) {
        attached.push({ ...event });
        continue;
      }
      read.add(event.identity);
      const delta = await this.#readDelta(event.identity);
      transcriptBytes += delta.text.length;
      attached.push({ ...event, transcriptDelta: delta });
    }
    return { events: attached, transcriptBytes };
  }

  async #readDelta(identity: SessionIdentity): Promise<BrainTranscriptDelta> {
    let result: ProviderTranscriptSinceResult;
    try {
      result = await this.#options.readTranscriptSince(identity, this.#memory.cursor(identity));
    } catch {
      return { text: "", truncated: false, status: ACT_RESULT_STATUS.REJECTED };
    }
    if (result.status !== ACT_RESULT_STATUS.ACCEPTED) {
      return { text: "", truncated: false, status: result.status };
    }
    if (result.cursor !== undefined) this.#memory.setCursor(identity, result.cursor);
    const bounded = cutFront(result.text, this.#deltaPerSessionChars);
    return {
      text: bounded.text,
      truncated: result.truncated || bounded.cut,
      status: ACT_RESULT_STATUS.ACCEPTED,
    };
  }

  async #dispatch(
    call: BrainFunctionCall,
    roster: BrainRoster,
    plan: TurnPlan,
    deliveries: BrainDelivery[],
  ): Promise<DispatchOutcome> {
    const args = parsedArguments(call.argumentsJson);
    const observed = (identity: SessionIdentity) =>
      roster.identities.some((listed) => sameIdentity(listed, identity));
    const named = identityFromRecord(args);

    if (!isBrainOnlyTool(call.name)) {
      let output: WireRecord;
      try {
        output = await this.#options.acts.perform({
          name: call.name,
          argumentsJson: call.argumentsJson,
        });
      } catch {
        output = rejection(REFUSAL_REASON.ACT_FAILED);
      }
      return { callId: call.callId, output };
    }

    switch (call.name) {
      case BRAIN_TOOL.LIST_SESSIONS:
        return { callId: call.callId, output: { roster: this.#options.roster().text } };
      case BRAIN_TOOL.READ_TRANSCRIPT: {
        if (!named || !observed(named)) {
          return { callId: call.callId, output: rejection(REFUSAL_REASON.UNOBSERVED_SESSION) };
        }
        return { callId: call.callId, output: await this.#readWhole(named) };
      }
      case BRAIN_TOOL.ANNOUNCE: {
        if (plan.deliverySource === undefined) {
          return { callId: call.callId, output: rejection(REFUSAL_REASON.ANNOUNCE_IN_ASK) };
        }
        const briefing = text(args.briefing)?.slice(0, maximumBriefingLength);
        if (!briefing) {
          return { callId: call.callId, output: rejection(REFUSAL_REASON.EMPTY_BRIEFING) };
        }
        deliveries.push({ briefing, decidedAt: this.#now(), source: plan.deliverySource });
        return { callId: call.callId, output: { status: ACT_RESULT_STATUS.ACCEPTED } };
      }
    }
  }

  async #readWhole(identity: SessionIdentity): Promise<WireRecord> {
    let result: ProviderTranscriptResult;
    try {
      result = await this.#options.readTranscript(identity);
    } catch {
      return rejection(REFUSAL_REASON.READ_FAILED);
    }
    if (result.status !== ACT_RESULT_STATUS.ACCEPTED) {
      return { status: result.status, reason: result.reason };
    }
    const bounded = cutFront(result.transcript, this.#fullTranscriptChars);
    return {
      status: ACT_RESULT_STATUS.ACCEPTED,
      truncated: bounded.cut,
      transcript: bounded.text,
    };
  }
}
