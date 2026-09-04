import type { RealtimeFunctionCall } from "@sidecar/acts";
import {
  cutFront,
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  SESSION_LOCATION,
  SESSION_STATUS,
  type Session,
  type SessionIdentity,
  sameSessionIdentity,
} from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { BRAIN_CLIENT_OUTCOME, type BrainClient } from "./brain-client.js";
import type { BrainDelivery, BrainTranscriptDelta, BrainWakeEvent } from "./brain-events.js";
import {
  askInputItem,
  holdReleasedInputItem,
  observedEventsItem,
  standingContextItem,
} from "./brain-input.js";
import { BrainMemory, type BrainPersistedState } from "./brain-memory.js";
import {
  type BrainFunctionCall,
  brainResponsesOutput,
  functionCallOutputItem,
  type ResponsesInputItem,
} from "./brain-openai.js";
import {
  BRAIN_TOOL,
  brainToolDefinitions,
  isBrainOnlyTool,
  maximumBriefingLength,
} from "./brain-tools.js";

/**
 * The brain: one long-lived agent that looks at the roster on the host's
 * observation cadence — the agents' hooks riding along on the look that
 * follows them — is asked things by the developer, and answers with briefings
 * for the voice to speak and acts for the host to carry. Nothing detects a
 * change on its behalf: the look carries what stands and what each transcript
 * gained, and the brain notices what is new against its own memory. It is
 * transport- and storage-agnostic on purpose — the client, the roster
 * rendering, the transcript reads, the delivery, and the persistence are all
 * handed in.
 *
 * What a turn may do is fixed by what opened it, at the API and again at
 * dispatch: an observed-events or hold-released turn is offered no act tool
 * and refuses one, so nothing a transcript says can become an act, and a
 * developer-ask turn — the one kind the developer opened — may act, each act
 * still running the host's own validation as a function call and nothing more.
 */

export const BRAIN_DEFAULTS = {
  MAX_TOOL_ITERATIONS: 8,
  /** How long an ask waits for its reply before the voice is told there is none. */
  ASK_DEADLINE_MS: 45_000,
  /** The most of one session's new transcript one look carries, cut from the front. */
  DELTA_PER_SESSION_CHARS: 20_000,
  /** The most of a whole transcript one read answers with, cut from the front. */
  FULL_TRANSCRIPT_CHARS: 60_000,
} as const;

export const BRAIN_TURN_TRIGGER = {
  ROSTER: "roster",
  ASK: "ask",
  HOLD_RELEASED: "hold-released",
} as const;

export type BrainTurnTrigger = (typeof BRAIN_TURN_TRIGGER)[keyof typeof BRAIN_TURN_TRIGGER];

/** What each kind of turn may do; the ask is the only one the developer opened. */
const TURN_RULES = {
  [BRAIN_TURN_TRIGGER.ROSTER]: { allowsActs: false, allowsAnnounce: true, dropsEmptyDeltas: true },
  [BRAIN_TURN_TRIGGER.ASK]: { allowsActs: true, allowsAnnounce: false, dropsEmptyDeltas: false },
  [BRAIN_TURN_TRIGGER.HOLD_RELEASED]: {
    allowsActs: false,
    allowsAnnounce: true,
    dropsEmptyDeltas: false,
  },
} as const satisfies Record<
  BrainTurnTrigger,
  { allowsActs: boolean; allowsAnnounce: boolean; dropsEmptyDeltas: boolean }
>;

const REFUSAL_REASON = {
  UNOBSERVED_SESSION: "not an observed session",
  ACT_OUTSIDE_ASK: "not run: an act runs only in a developer-ask turn",
  ANNOUNCE_OUTSIDE_OBSERVED:
    "reply in text: this is a developer ask, and your final text is the speech",
  EMPTY_BRIEFING: "a briefing needs words",
  BUDGET_SPENT: "not run: this turn's tool budget is spent",
  ACT_FAILED: "the act did not complete",
  READ_FAILED: "the transcript could not be read",
} as const;

/**
 * The roster as the host renders it, with the identities every tool argument
 * is validated against, and the sessions themselves for the look to choose
 * which transcripts to read.
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
 * One turn as the development trace records it: what opened it, the hooks it
 * carried, the kinds of item it appended, the input size the API counted, how
 * many transcript characters it read, each tool call by name and outcome, the
 * text and briefings it produced, and how it ran — never a transcript's text.
 */
export interface BrainTurnTraceRecord {
  trigger: BrainTurnTrigger;
  hooks: readonly string[];
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
  maxToolIterations?: number;
  askDeadlineMs?: number;
  deltaPerSessionChars?: number;
  fullTranscriptChars?: number;
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
  /** The roster as it stood when the turn was planned, read once for the whole turn. */
  roster: BrainRoster;
  open: (events: readonly BrainWakeEvent[], now: number) => readonly ResponsesInputItem[];
}

interface DispatchOutcome {
  callId: string;
  output: WireRecord;
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

function rejection(reason: string): WireRecord {
  return { status: ACT_RESULT_STATUS.REJECTED, reason };
}

export class BrainAgent {
  readonly #options: BrainAgentOptions;
  readonly #now: () => number;
  readonly #report: (message: string) => void;
  readonly #maxToolIterations: number;
  readonly #askDeadlineMs: number;
  readonly #deltaPerSessionChars: number;
  readonly #fullTranscriptChars: number;
  #memory = new BrainMemory();
  #turnInFlight = false;
  #restored: Promise<void> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #stopped = false;

  constructor(options: BrainAgentOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
    this.#maxToolIterations = options.maxToolIterations ?? BRAIN_DEFAULTS.MAX_TOOL_ITERATIONS;
    this.#askDeadlineMs = options.askDeadlineMs ?? BRAIN_DEFAULTS.ASK_DEADLINE_MS;
    this.#deltaPerSessionChars =
      options.deltaPerSessionChars ?? BRAIN_DEFAULTS.DELTA_PER_SESSION_CHARS;
    this.#fullTranscriptChars = options.fullTranscriptChars ?? BRAIN_DEFAULTS.FULL_TRANSCRIPT_CHARS;
  }

  /**
   * Asks the brain on the developer's behalf. Resolves with nothing when the
   * turn failed or the deadline passed; the turn itself still runs to its end
   * so the memory never holds half of one.
   */
  async ask(question: string): Promise<BrainAskAnswer | undefined> {
    if (this.#stopped) return undefined;
    const turn = this.#enqueue(() =>
      this.#turn({
        trigger: BRAIN_TURN_TRIGGER.ASK,
        events: [],
        roster: this.#options.roster(),
        open: (_events, now) => [askInputItem(question, now)],
      }),
    );
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<undefined>((resolve) => {
      deadline = setTimeout(() => resolve(undefined), this.#askDeadlineMs);
    });
    const result = await Promise.race([turn, timedOut]);
    clearTimeout(deadline);
    if (result?.outcome !== TURN_OUTCOME.DONE) return undefined;
    return { text: result.text };
  }

  /**
   * Hands back briefings the host held while a meeting or a pause stood, for
   * one re-decision against the roster as it now stands.
   */
  releaseHeld(held: readonly BrainDelivery[]): void {
    if (this.#stopped || held.length === 0) return;
    void this.#enqueue(() =>
      this.#turn({
        trigger: BRAIN_TURN_TRIGGER.HOLD_RELEASED,
        events: [],
        roster: this.#options.roster(),
        open: (_events, now) => [holdReleasedInputItem(held, now)],
      }),
    );
  }

  /** Lets the running turn finish and takes nothing more. */
  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#queue;
  }

  /**
   * One look at the whole roster, driven by the host's observation pass rather
   * than an internal timer, with the hooks that fired since the last one
   * riding along. Carries, for every local session the brain has read before,
   * that is working or waiting now, or that a hook named, what its transcript
   * gained since; sessions with nothing new and no hook are left out. A hook
   * for a session the roster does not hold is still heard. Skipped while the
   * client is quiet, because the next look reads the same deltas; skipped
   * while a turn is in flight only when no hook is waiting, since a hook
   * should not wait a whole cadence behind an ask.
   */
  rosterLook(hooks: readonly BrainWakeEvent[] = []): void {
    if (this.#stopped) return;
    if (this.#options.client.quietUntil() !== undefined) return;
    if (this.#turnInFlight && hooks.length === 0) return;
    const roster = this.#options.roster();
    const sessions = roster.sessions ?? [];
    const now = this.#now();
    const looks: BrainWakeEvent[] = sessions.flatMap((session) => {
      const identity: SessionIdentity = {
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      };
      const hook = hooks.find((event) => sameSessionIdentity(event.identity, identity));
      const readBefore = this.#memory.cursor(identity) !== undefined;
      const live =
        session.status === SESSION_STATUS.WORKING || session.status === SESSION_STATUS.WAITING;
      if (session.location !== SESSION_LOCATION.LOCAL || !(readBefore || live || hook)) return [];
      return [
        {
          identity,
          session,
          atMs: now,
          ...(hook?.hookEvent ? { hookEvent: hook.hookEvent } : undefined),
        },
      ];
    });
    const unseen = hooks.filter(
      (event) => !sessions.some((session) => sameSessionIdentity(session, event.identity)),
    );
    void this.#enqueue(() =>
      this.#turn({
        trigger: BRAIN_TURN_TRIGGER.ROSTER,
        events: [...looks, ...unseen],
        roster,
        open: (events, openedAt) => [observedEventsItem(events, openedAt)],
      }),
    );
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
    const rules = TURN_RULES[plan.trigger];
    const tools = brainToolDefinitions(rules.allowsActs);
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
    const events = rules.dropsEmptyDeltas
      ? attachedDeltas.events.filter(
          (event) => event.hookEvent !== undefined || Boolean(event.transcriptDelta?.text),
        )
      : attachedDeltas.events;
    append(plan.open(events, startedAt));

    for (;;) {
      const context = standingContextItem(
        plan.roster.text,
        this.#options.standingContext(),
        this.#now(),
      );
      const answer = await this.#options.client.respond([...this.#memory.items(), context], tools);
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
          this.#dispatch(call, plan, deliveries).then((outcome) => {
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
      this.#memory.retainCursors(plan.roster.identities);
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
      hooks: plan.events.flatMap((event) => (event.hookEvent ? [event.hookEvent] : [])),
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
   * Reads what each session's transcript gained since the brain last looked,
   * once per session however many events name it, and moves the cursor. The
   * cursor moves with the memory: a turn that fails rolls both back, so the
   * same delta is read again rather than skipped.
   */
  async #attachDeltas(
    events: readonly BrainWakeEvent[],
  ): Promise<{ events: readonly BrainWakeEvent[]; transcriptBytes: number }> {
    const read: SessionIdentity[] = [];
    let transcriptBytes = 0;
    const attached: BrainWakeEvent[] = [];
    for (const event of events) {
      if (read.some((identity) => sameSessionIdentity(identity, event.identity))) {
        attached.push({ ...event });
        continue;
      }
      read.push(event.identity);
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
    plan: TurnPlan,
    deliveries: BrainDelivery[],
  ): Promise<DispatchOutcome> {
    const rules = TURN_RULES[plan.trigger];
    const args = parsedArguments(call.argumentsJson);
    const observed = (identity: SessionIdentity) =>
      plan.roster.identities.some((listed) => sameSessionIdentity(listed, identity));
    const named = identityFromRecord(args);

    if (!isBrainOnlyTool(call.name)) {
      // The API was offered no act in this turn; a call that names one anyway
      // is refused here before the performer ever sees it.
      if (!rules.allowsActs) {
        return { callId: call.callId, output: rejection(REFUSAL_REASON.ACT_OUTSIDE_ASK) };
      }
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
      case BRAIN_TOOL.READ_TRANSCRIPT: {
        if (!named || !observed(named)) {
          return { callId: call.callId, output: rejection(REFUSAL_REASON.UNOBSERVED_SESSION) };
        }
        return { callId: call.callId, output: await this.#readWhole(named) };
      }
      case BRAIN_TOOL.ANNOUNCE: {
        if (!rules.allowsAnnounce) {
          return {
            callId: call.callId,
            output: rejection(REFUSAL_REASON.ANNOUNCE_OUTSIDE_OBSERVED),
          };
        }
        const briefing = text(args.briefing)?.slice(0, maximumBriefingLength);
        if (!briefing) {
          return { callId: call.callId, output: rejection(REFUSAL_REASON.EMPTY_BRIEFING) };
        }
        deliveries.push({ briefing, decidedAt: this.#now() });
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
