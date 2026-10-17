import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { DatabaseServices } from "@luke/database/core/query";
import { spendHostedMeter } from "@luke/database/models/quota";
import {
  newestStepsWithin,
  type ReplayStep,
  type ReplaySummary,
  stepsBytes,
  summaryBytes,
} from "@luke/features/agent-replay";
import {
  base64Bytes,
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER, type ModelChoice, type ModelProvider } from "@luke/features/models-wire";
import { failureKind } from "@luke/runtime/effect";
import { generateText, type LanguageModel } from "ai";
import { Duration, Effect, Option, Redacted } from "effect";
import { HostedEnvironment } from "../../environment.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import { spendingKeyOf } from "./account-keys.js";
import { CODER } from "./bounds.js";

/**
 * replay-summary.ts -- how much of another agent's transcript a new agent's first message holds, and the summary Luke writes of the steps that do not fit.
 *
 * The replay is sized against the new agent's own context: the share of its
 * model's window eve compacts at, less its instructions, its brief and note,
 * and room for its first steps, each told in a token of two bytes
 * (`BYTES_PER_TOKEN`), not eve's own four, since a replay is mostly tool
 * JSON and a model reads that in more, shorter tokens. A source that never
 * compacted, run on the same window, fits whole, since every step it
 * replays fit in that window once; one that compacted, or whose raw steps
 * far outgrow the context it last measured, replays verbatim no more than
 * that context (`measuredBoundBytes`), since its raw rows hold everything
 * eve folded away. Past the bound the newest steps are kept and the oldest
 * summarized, as a compaction would: one call per chunk of them on the new
 * agent's own model at its lowest effort, a few at a time, then one call
 * combining the chunks' summaries, the whole held to a timeout. A summary
 * that cannot be written in time, or at all, leaves the newest steps that
 * fit alone, and never fails the Start. Once fitted, the whole first prompt
 * is told against the window again, and steps, then the summary, are
 * dropped until it fits (`withinWindow`), so no Start hands eve a prompt
 * its model must refuse.
 */

/** The bounds the replay's fit and its summary keep to. */
export const REPLAY_FIT = {
  /** Room left in the new agent's context for its first steps past its first message. */
  HEADROOM_TOKENS: 16_000,
  /** The instructions and tool definitions told where the source never recorded a step to read them from. */
  INSTRUCTIONS_FALLBACK_TOKENS: 24_000,
  /** The most tokens one summary call may write, a chunk's or the combining one. */
  SUMMARY_OUTPUT_TOKENS: 4_000,
  /** The least a chunk's summary is held to, however many chunks share the combining call's room. */
  MIN_CHUNK_OUTPUT_TOKENS: 256,
  /** What an image or a PDF the first message carries is counted at beside the replay, which no byte count tells. */
  FILE_TOKENS: 2_000,
  /** Room in a summary call for its instructions, past the steps it reads. */
  SUMMARY_PROMPT_TOKENS: 2_000,
  /** The most chunks summarized; the oldest past it are left out, which the summary says. */
  MAX_CHUNKS: 8,
  /** How many chunk summaries run at once. */
  CONCURRENCY: 4,
  /** How long the whole summary may take before the Start goes on without it. */
  TIMEOUT: Duration.seconds(60),
} as const;

/**
 * The bytes a token of replay text stands for. Note that we count two,
 * not eve's four, because a replay is mostly tool calls' JSON, which reads
 * at about 2.2 bytes a token: a continue of 3.03 MB was refused at
 * 1,368,155 tokens, 1.77 times what four bytes a token told. Two holds
 * prose and JSON alike under the window, prose with room to spare.
 */
const BYTES_PER_TOKEN = 2;

/** The bytes a token stands for in eve's own estimate, which a step's recorded instructions are told in. */
const EVE_BYTES_PER_TOKEN = 4;

/** The most bytes one UTF-16 code unit of a string takes in UTF-8, which cuts a string to a byte bound by its length. */
const UTF8_BYTES_PER_UNIT = 3;

/** How far a source's raw steps may outgrow the context it last measured before they are taken to hold what eve folded away. */
const RAW_PAST_MEASURED = 2;

/** Room for the summary's marker and the line saying what was left out, past its words. */
const SUMMARY_MARKER_BYTES = 256;

const CHUNK_INSTRUCTIONS =
  "You summarize part of a coding agent's transcript for another agent that takes over its work and cannot read it. Keep, as plainly and briefly as you can: the goal; every instruction or correction the developer gave, near verbatim; each decision made and why; the files changed; the commands that mattered, with their outcomes; where the work stood at the end; and the problems still open. Leave out what led nowhere. Answer with the summary alone.";

const COMBINE_INSTRUCTIONS =
  "You combine summaries of consecutive parts of one coding agent's transcript, oldest first, into one summary for another agent that takes over its work. Keep the goal, every instruction or correction the developer gave near verbatim, the decisions and why, the files changed, the commands that mattered with their outcomes, where the work stood at the end, and the problems still open. Where a later part overrides an earlier one, keep the later. Answer with the summary alone.";

/** The model a summary is written on: the new agent's own model on the key its turns spend on, the provider's options for its lowest effort, and the count of one use on Luke's key, nothing on the account's own. */
export interface SummaryModel {
  readonly model: LanguageModel;
  readonly providerOptions: Record<string, Record<string, string>>;
  readonly counted: Effect.Effect<void>;
}

/** How a Start finds the model a summary is written on, for the account and the new agent's choice at the effort named; nothing where it has no key to reach it on. */
export type SummaryModelOf = (
  userId: string,
  choice: ModelChoice,
  effort: string,
) => Effect.Effect<SummaryModel | undefined, never, DatabaseServices>;

/** The provider's own options for the lowest effort, with no thinking asked for. */
function summaryOptions(
  provider: ModelProvider,
  effort: string,
): Record<string, Record<string, string>> {
  return provider === MODEL_PROVIDER.ANTHROPIC
    ? { anthropic: { effort } }
    : { openai: { reasoningEffort: effort } };
}

/** One use counted on the account's meter, a count that cannot be written logged, since a meter enforces nothing. */
function countedOnLuke(userId: string): Effect.Effect<void, never, DatabaseServices> {
  return Effect.flatMap(
    Effect.clockWith((clock) => clock.currentTimeMillis),
    (now) => spendHostedMeter({ userId, now }),
  ).pipe(
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(`A hosted inference was not counted: ${failureKind(failure)}`),
    ),
  );
}

/** The tokens text of these bytes is told at, as above. */
export function replayTokens(bytes: number): number {
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

/** Tokens eve estimated at four bytes each, told again at two, as the replay beside them is. */
export function fromEveEstimate(tokens: number): number {
  return replayTokens(tokens * EVE_BYTES_PER_TOKEN);
}

/** The context a source last measured: the tokens its newest step read, and whether eve had compacted its conversation. */
export interface MeasuredContext {
  readonly inputTokens: number;
  readonly compacted: boolean;
}

/**
 * The bytes the replay's steps and summary may take: the share of the
 * window eve compacts at, less the instructions, the first message's own
 * words, and the headroom, in tokens of two bytes; none where nothing is
 * left.
 */
export function replayBudgetBytes(
  windowTokens: number,
  instructionsTokens: number,
  firstMessageBytes: number,
): number {
  const threshold = Math.floor(windowTokens * CODER.COMPACTION_THRESHOLD_SHARE);
  const words = replayTokens(firstMessageBytes);
  const left = threshold - instructionsTokens - words - REPLAY_FIT.HEADROOM_TOKENS;
  return Math.max(0, left) * BYTES_PER_TOKEN;
}

/**
 * The most bytes of a source's steps replayed verbatim, by the context it
 * last measured: that context, where eve compacted the source or its raw
 * steps outgrow that context `RAW_PAST_MEASURED` times over, because its
 * rows then hold what eve had folded into a summary and its model no longer
 * read; no bound past the window's otherwise, or where it never measured one.
 */
export function measuredBoundBytes(
  measured: MeasuredContext | undefined,
  rawBytes: number,
): number | undefined {
  if (measured === undefined) return undefined;
  const bound = measured.inputTokens * BYTES_PER_TOKEN;
  return measured.compacted || rawBytes > bound * RAW_PAST_MEASURED ? bound : undefined;
}

/**
 * The bytes the first message's files take beside its words: a text file's
 * own, since eve is handed it inlined, and an image's or a PDF's counted at
 * `REPLAY_FIT.FILE_TOKENS`, since its bytes tell nothing of its tokens.
 */
export function filesBytes(files: readonly CodingAgentAttachment[]): number {
  return files.reduce(
    (sum, file) =>
      sum +
      (file.mediaType === CODING_AGENT_ATTACHMENT_TYPE.TEXT
        ? base64Bytes(file.data)
        : REPLAY_FIT.FILE_TOKENS * BYTES_PER_TOKEN),
    0,
  );
}

/** A step as a summary call reads it: its line, then its words. */
function stepWords(step: ReplayStep): string {
  return `${step.summary}\n${step.words}`;
}

/** One part a summary call reads, the recap or a step, and how many of the source's steps it stands for. */
interface SummaryPart {
  readonly words: string;
  readonly steps: number;
}

/** The parts in runs of at most `chunkBytes` each, oldest first; a part larger than a run is cut to fit one alone, since only the summary reads it. */
function chunksOf(parts: readonly SummaryPart[], chunkBytes: number): SummaryPart[][] {
  const chunks: SummaryPart[][] = [];
  let current: SummaryPart[] = [];
  let used = 0;
  for (const part of parts) {
    const size = new TextEncoder().encode(part.words).byteLength;
    if (used + size > chunkBytes && current.length > 0) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(
      size > chunkBytes
        ? { ...part, words: part.words.slice(0, Math.floor(chunkBytes / UTF8_BYTES_PER_UNIT)) }
        : part,
    );
    used += Math.min(size, chunkBytes);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** How many of the source's steps the chunks stand for. */
function chunkSteps(chunks: readonly (readonly SummaryPart[])[]): number {
  return chunks.flat().reduce((sum, part) => sum + part.steps, 0);
}

/** One summary call: the instructions and the words, bounded in what it writes, the use counted first; a call that fails or writes nothing fails. */
function summaryCall(model: SummaryModel, system: string, prompt: string, maxOutputTokens: number) {
  return Effect.gen(function* () {
    yield* model.counted;
    const answer = yield* Effect.tryPromise(() =>
      generateText({
        model: model.model,
        system,
        prompt,
        maxOutputTokens,
        providerOptions: model.providerOptions,
      }),
    );
    const text = answer.text.trim();
    if (text === "") return yield* Effect.fail(new Error("the summary came back empty"));
    return text;
  });
}

/**
 * A summary of the steps, the recap the source already carried of those
 * before them read first, written on the model in chunks sized to its
 * window, a few at a time, then combined into one; each chunk's summary is
 * held to its share of the combining call's room, and the oldest chunks
 * past `REPLAY_FIT.MAX_CHUNKS` are left out, which the summary says. The
 * summary stands for the steps of the chunks it read alone, so the steps
 * left out count as left out rather than as summarized. Nothing where a
 * call failed or the whole ran past the timeout.
 */
export function summarizeSteps(
  model: SummaryModel,
  steps: readonly ReplayStep[],
  windowTokens: number,
  earlier?: ReplaySummary,
): Effect.Effect<Option.Option<ReplaySummary>> {
  const threshold = Math.floor(windowTokens * CODER.COMPACTION_THRESHOLD_SHARE);
  const room = Math.max(
    1,
    threshold - REPLAY_FIT.SUMMARY_OUTPUT_TOKENS - REPLAY_FIT.SUMMARY_PROMPT_TOKENS,
  );
  const recap: SummaryPart[] =
    earlier === undefined
      ? []
      : [{ words: `Recap of the earlier steps:\n${earlier.text}`, steps: earlier.steps }];
  const read = [...recap, ...steps.map((step) => ({ words: stepWords(step), steps: 1 }))];
  const all = chunksOf(read, room * BYTES_PER_TOKEN);
  const kept = all.slice(-REPLAY_FIT.MAX_CHUNKS);
  const leftOut = chunkSteps(all.slice(0, all.length - kept.length));
  const chunkOutput = Math.min(
    REPLAY_FIT.SUMMARY_OUTPUT_TOKENS,
    Math.max(REPLAY_FIT.MIN_CHUNK_OUTPUT_TOKENS, Math.floor(room / Math.max(1, kept.length))),
  );
  const written = Effect.gen(function* () {
    const parts = yield* Effect.forEach(
      kept,
      (chunk) =>
        summaryCall(
          model,
          CHUNK_INSTRUCTIONS,
          chunk.map((part) => part.words).join("\n\n"),
          chunkOutput,
        ),
      { concurrency: REPLAY_FIT.CONCURRENCY },
    );
    const combined =
      parts.length === 1
        ? (parts[0] ?? "")
        : yield* summaryCall(
            model,
            COMBINE_INSTRUCTIONS,
            parts.map((part, at) => `Part ${at + 1}:\n${part}`).join("\n\n"),
            REPLAY_FIT.SUMMARY_OUTPUT_TOKENS,
          );
    const lead =
      leftOut === 0
        ? ""
        : `(The oldest ${leftOut} steps were too many to summarize and are left out.)\n\n`;
    return { text: `${lead}${combined}`, steps: chunkSteps(kept) };
  });
  return written.pipe(
    Effect.timeoutOption(REPLAY_FIT.TIMEOUT),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`a replay's summary could not be written: ${failureKind(failure)}`),
        Option.none(),
      ),
    ),
  );
}

/** The steps a replay keeps and the summary ahead of them. */
export interface FittedSteps {
  readonly kept: readonly ReplayStep[];
  readonly summary: ReplaySummary | undefined;
}

/**
 * The steps a replay keeps within its budget, and the summary of the ones
 * before them: every step, with the summary the source's own replay carried
 * of those before them, where all fit; otherwise the newest that fit beside
 * room for a summary, with a summary of the rest, the carried one folded in,
 * where one is written and fits, or else the newest that fit beside the
 * carried summary where it fits, or alone.
 */
export function fitReplay(
  steps: readonly ReplayStep[],
  carried: ReplaySummary | undefined,
  budgetBytes: number,
  summarize: (
    dropped: readonly ReplayStep[],
    earlier: ReplaySummary | undefined,
  ) => Effect.Effect<Option.Option<ReplaySummary>>,
): Effect.Effect<FittedSteps> {
  return Effect.gen(function* () {
    if (stepsBytes(steps) + summaryBytes(carried) <= budgetBytes) {
      return { kept: steps, summary: carried };
    }
    // A summary is held to its output bound, so that is the room it is counted for before it is written.
    const reserve = REPLAY_FIT.SUMMARY_OUTPUT_TOKENS * BYTES_PER_TOKEN + SUMMARY_MARKER_BYTES;
    const beside = newestStepsWithin(steps, Math.max(0, budgetBytes - reserve));
    const summary = yield* summarize(steps.slice(0, steps.length - beside.length), carried);
    if (Option.isSome(summary) && stepsBytes(beside) + summaryBytes(summary.value) <= budgetBytes) {
      return { kept: beside, summary: summary.value };
    }
    // A summary that could not be written leaves the carried one, where it fits, beside the newest steps.
    const carriedBytes = summaryBytes(carried);
    if (carried !== undefined && carriedBytes <= budgetBytes) {
      return { kept: newestStepsWithin(steps, budgetBytes - carriedBytes), summary: carried };
    }
    return { kept: newestStepsWithin(steps, budgetBytes), summary: undefined };
  });
}

/**
 * The fitted replay held to the window as the whole first prompt reads,
 * `promptTokens` telling that prompt for the steps and summary given: as it
 * stands where it fits, else with the oldest steps kept dropped by what it
 * runs over, a step at least each round, then the summary, until it fits or
 * nothing of the replay is left. Note that the fit is told again rather
 * than trusted, because the budget it was made to leaves out what the
 * brief, the preamble, and the files come to once the message is written.
 */
export function withinWindow(
  fitted: FittedSteps,
  promptTokens: (fitted: FittedSteps) => number,
  windowTokens: number,
): FittedSteps {
  let held = fitted;
  for (;;) {
    const over = promptTokens(held) - windowTokens;
    if (over <= 0) return held;
    if (held.kept.length > 0) {
      const room = Math.max(0, stepsBytes(held.kept) - over * BYTES_PER_TOKEN);
      const fewer = newestStepsWithin(held.kept, room);
      held = { ...held, kept: fewer.length < held.kept.length ? fewer : held.kept.slice(1) };
    } else if (held.summary !== undefined) {
      held = { kept: held.kept, summary: undefined };
    } else {
      return held;
    }
  }
}

/**
 * The deployment's summary model: the new agent's own model, its fast
 * version's base where it chose one, reached at its provider directly on
 * the key its turns spend on (`account-keys.ts`), at the effort named and
 * with no thinking asked for; nothing where the provider is unknown or no
 * key stands. The key is revealed here alone, into the SDK client that puts
 * it on its requests.
 */
export const productionSummaryModel = (
  userId: string,
  choice: ModelChoice,
  effort: string,
): Effect.Effect<SummaryModel | undefined, never, DatabaseServices | HostedEnvironment> =>
  Effect.gen(function* () {
    const named = providerModelOf(choice.model);
    if (named === undefined) return undefined;
    const environment = yield* HostedEnvironment;
    const luke = { anthropic: environment.anthropicKey, openAi: environment.openAiKey };
    const spending = yield* spendingKeyOf(
      userId,
      named.provider,
      luke,
      environment.providerKeyEncryptionKeys,
    ).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(`a replay summary's key could not be read: ${failureKind(failure)}`),
          undefined,
        ),
      ),
    );
    if (spending === undefined) return undefined;
    // The meter is written on the Start's own database, held here so a summary call needs nothing more.
    const database = yield* Effect.context<DatabaseServices>();
    const settings = { apiKey: Redacted.value(spending.key) };
    const model =
      named.provider === MODEL_PROVIDER.ANTHROPIC
        ? createAnthropic(settings)(named.modelId)
        : createOpenAI(settings).responses(named.modelId);
    return {
      model,
      providerOptions: summaryOptions(named.provider, effort),
      counted: spending.lukes
        ? countedOnLuke(userId).pipe(Effect.provideContext(database))
        : Effect.void,
    };
  });
