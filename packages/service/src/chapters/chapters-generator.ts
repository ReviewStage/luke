import { createAnthropic } from "@ai-sdk/anthropic";
import {
  PULL_REQUEST_CHAPTERS_FAILURE,
  type PullRequestChaptersFailure,
} from "@luke/database/pull-request-chapters-vocabulary";
import type { CodingAgentChangedFile } from "@luke/features/coding-agent-wire";
import {
  CHAPTER_KIND,
  CHAPTER_RISK,
  type Chapter,
  type ChapterHunk,
  chapterHunks,
  coverHunks,
  type HunkRef,
  ignoredForChapters,
  LINE_REF_SIDE,
  otherChangesChapter,
  unescapeLiteralNewlines,
  validLineRefs,
} from "@luke/features/pull-request-chapters";
import { failureKind } from "@luke/runtime/effect";
import { jsonRoundTrip } from "@luke/wire";
import { describeWire, emitJsonSchema } from "@luke/wire/effect";
import {
  generateText,
  jsonSchema,
  type LanguageModel,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";
import { Data, Duration, Effect, Redacted, Schema } from "effect";
import {
  CHAPTERS_INSTRUCTIONS,
  chaptersPrompt,
  REPAIR_INSTRUCTIONS,
  repairPrompt,
} from "./chapters-prompt.js";

/**
 * chapters-generator.ts -- a pull request's changed files and words told as chapters, in one structured model call on Luke's own key, held to the diff in code.
 *
 * The changed files are split into the hunks a model is shown and those it
 * never sees: the files a reader reads past (`ignoredForChapters`) and every
 * file with no hunk to read, a pure rename, a binary file, or one whose
 * patch was left out. The shown hunks and the pull request's words are told
 * against an input cap first (`CHAPTERS_BOUNDS.MAX_INPUT_TOKENS`, estimated
 * by characters), so a diff too large to send is refused before any call.
 *
 * One call asks for the chapters through the AI SDK's structured output
 * (`Output.object`), the first structured call in the repository: the JSON
 * Schema the provider decodes against is emitted from the Effect Schema
 * below (`emitJsonSchema`), and the answer is decoded by that same Schema,
 * never trusted. The answer schema is looser than the wire's chapter on
 * what code holds anyway, a line number or a hunk's start, so one stray
 * reference drops itself (`validLineRefs`, `coverHunks`) rather than the
 * whole answer.
 *
 * The answer is held to the hunks the model was shown (`coverHunks`): an
 * unknown reference is dropped and a repeated one stays in its first
 * chapter. Hunks no chapter holds are put to the model once more, in one
 * repair call asking where each belongs, an existing chapter by its number
 * or a new chapter read after them, a hunk placed in a chapter raising its
 * risk where the hunk earns more; whatever is still outside, with every
 * hunk the model never saw, closes the story as "Other changes". A repair
 * that fails, or whose prompt is past the cap, is passed over, since the
 * first answer already stands. Each
 * key change keeps only line references inside its own chapter's hunks, and
 * the literal `\n` a model escapes twice is read as the newline it meant.
 *
 * The model is a seam (`ChaptersModel`), as an agent's title model is:
 * production reaches Anthropic with Luke's own key on one fixed fast model
 * (`chaptersModelOf`), never through the account's meter, and a test hands
 * in a scripted model. The whole generation is bounded in time
 * (`CHAPTERS_BOUNDS.TIMEOUT`), and every way it fails is one of the store's
 * four kinds (`PULL_REQUEST_CHAPTERS_FAILURE`). A failure is logged by its
 * kind alone: neither the diff nor the answer leaves here but to the model
 * and the caller.
 */

/** A generation that answered no chapters, and why, in the store's words (`PULL_REQUEST_CHAPTERS_FAILURE`). */
export class ChaptersFailure extends Data.TaggedError("ChaptersFailure")<{
  readonly kind: PullRequestChaptersFailure;
}> {}

/** The bounds a generation keeps to. */
export const CHAPTERS_BOUNDS = {
  /** The most tokens the instructions and the input together may be told at before the diff is refused as too large. */
  MAX_INPUT_TOKENS: 150_000,
  /** The characters a token of input is told at. Note that we count three, not four, because a diff is code and line numbers, which read in shorter tokens than prose. */
  CHARS_PER_TOKEN: 3,
  /** How long the whole generation may take, the repair included; a route that runs it is given longer. */
  TIMEOUT: Duration.seconds(180),
  /** The most tokens the chapters call may write. */
  MAX_OUTPUT_TOKENS: 32_000,
  /** The most tokens the repair call may write, which places a few hunks. */
  REPAIR_MAX_OUTPUT_TOKENS: 8_000,
  /** How hard the model is asked to think: grouping and judging risk earn more than a title's least. */
  EFFORT: "medium",
} as const;

/** The one model chapters are told on: Claude's fast model, at Anthropic's own id, the one an agent's title runs on. */
const CHAPTERS_MODEL_ID = "claude-haiku-5-5";

/** The AI SDK's word for a call the provider stopped on its own policy, as Anthropic's refusal reads. */
const FINISH_REFUSED = "content-filter";

/** The model a generation runs on, and its id, which the answer names. */
export interface ChaptersModel {
  readonly id: string;
  readonly model: LanguageModel;
}

/** What a generation reads: the pull request's changed files, its title and body, and its commit messages where the caller has them. */
export interface ChaptersInput {
  readonly files: readonly CodingAgentChangedFile[];
  readonly title: string;
  readonly body: string | null;
  readonly commitMessages?: readonly string[];
}

/** The chapters told, in reading order with "Other changes" last where it holds anything, and the model that told them. */
export interface GeneratedChapters {
  readonly model: string;
  readonly chapters: readonly Chapter[];
}

/** A hunk as an answer cites it; its start is held to the diff by `coverHunks`, not here. */
const answerHunkRefSchema = Schema.Struct({
  path: describeWire(Schema.String, "The exact path a hunk header names."),
  oldStart: describeWire(Schema.Int, "The oldStart that same hunk header names."),
});

/** Lines a key change points at as an answer writes them; `validLineRefs` drops a range outside the chapter's hunks. */
const answerLineRefSchema = Schema.Struct({
  path: Schema.String,
  side: describeWire(
    Schema.Literals(Object.values(LINE_REF_SIDE)),
    "additions for the new (right) column's lines, deletions for the old (left) column's.",
  ),
  startLine: Schema.Int,
  endLine: Schema.Int,
});

/** One chapter as the model tells it, every field a story chapter's but its kind. */
const answerChapterSchema = Schema.Struct({
  title: describeWire(Schema.String, "An action-oriented verb phrase of at most 8 words."),
  summary: describeWire(Schema.String, "2 to 3 sentences in Markdown, leading with impact."),
  hunkRefs: describeWire(
    Schema.Array(answerHunkRefSchema),
    "The chapter's hunks: a file's together, in ascending oldStart.",
  ),
  keyChanges: describeWire(
    Schema.Array(
      Schema.Struct({
        content: describeWire(Schema.String, "One judgment call, as a single-sentence question."),
        lineRefs: Schema.Array(answerLineRefSchema),
      }),
    ),
    "Judgment calls only a person can make; empty when there are none.",
  ),
  risk: Schema.Literals(Object.values(CHAPTER_RISK)),
  riskReasons: Schema.Array(Schema.String),
});

type AnswerChapter = typeof answerChapterSchema.Type;

/** The one-pass answer: the chapters in reading order. */
export const chaptersAnswerSchema = Schema.Struct({
  chapters: Schema.Array(answerChapterSchema),
});

/** The repair's answer: where each left-out hunk goes, an existing chapter by its number with the risk it earns, or a new chapter. */
export const repairAnswerSchema = Schema.Struct({
  placements: describeWire(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        oldStart: Schema.Int,
        chapter: describeWire(Schema.Int, "The number of the existing chapter, as listed."),
        risk: describeWire(
          Schema.Literals(Object.values(CHAPTER_RISK)),
          "The risk this hunk earns on its own, by the rubric.",
        ),
        riskReason: describeWire(
          Schema.String,
          "Why this hunk earns that risk, in a short phrase.",
        ),
      }),
    ),
    "Left-out hunks that belong to an existing chapter.",
  ),
  newChapters: describeWire(
    Schema.Array(answerChapterSchema),
    "Chapters of left-out hunks that belong to none of the existing ones; empty when every hunk is placed.",
  ),
});

/** What one structured call asks: its instructions, its prompt, the schema its answer is held to, and how much it may write. */
interface StructuredAsk<A> {
  readonly system: string;
  readonly prompt: string;
  readonly schema: Schema.Codec<A, unknown>;
  readonly maxOutputTokens: number;
}

/**
 * The kind of a call's failure: an answer the SDK could not read as the
 * schema's JSON is invalid, unless the provider stopped it on its policy,
 * which is a refusal, as every other failure of the call is.
 */
function callFailureOf(cause: unknown): PullRequestChaptersFailure {
  if (NoObjectGeneratedError.isInstance(cause)) {
    return cause.finishReason === FINISH_REFUSED
      ? PULL_REQUEST_CHAPTERS_FAILURE.MODEL_REFUSED
      : PULL_REQUEST_CHAPTERS_FAILURE.INVALID_ANSWER;
  }
  if (NoOutputGeneratedError.isInstance(cause)) return PULL_REQUEST_CHAPTERS_FAILURE.INVALID_ANSWER;
  return PULL_REQUEST_CHAPTERS_FAILURE.MODEL_REFUSED;
}

/** A failure of its kind, logged by that kind and the cause's own name alone. */
function failedAs(
  kind: PullRequestChaptersFailure,
  cause?: unknown,
): Effect.Effect<never, ChaptersFailure> {
  const named = cause === undefined ? kind : `${kind} (${failureKind(cause)})`;
  return Effect.andThen(
    Effect.logWarning(`chapters could not be generated: ${named}`),
    Effect.fail(new ChaptersFailure({ kind })),
  );
}

/**
 * One structured call: the schema emitted as JSON Schema for the provider
 * to decode against, the answer decoded by the same Schema. Note that the
 * SDK is handed the JSON Schema alone, with no validation of its own,
 * because the Effect decode is the one that counts.
 */
function askStructured<A>(
  model: ChaptersModel,
  ask: StructuredAsk<A>,
): Effect.Effect<A, ChaptersFailure> {
  const called = Effect.tryPromise({
    try: async (abortSignal) => {
      const answer = await generateText({
        model: model.model,
        system: ask.system,
        prompt: ask.prompt,
        output: Output.object({
          schema: jsonSchema<unknown>(jsonRoundTrip(emitJsonSchema(ask.schema))),
        }),
        maxOutputTokens: ask.maxOutputTokens,
        providerOptions: { anthropic: { effort: CHAPTERS_BOUNDS.EFFORT } },
        abortSignal,
      });
      if (answer.finishReason === FINISH_REFUSED) return { refused: true } as const;
      return { refused: false, output: answer.output } as const;
    },
    catch: (cause) => cause,
  });
  return Effect.matchEffect(called, {
    onFailure: (cause) => failedAs(callFailureOf(cause), cause),
    onSuccess: (answer) =>
      answer.refused
        ? failedAs(PULL_REQUEST_CHAPTERS_FAILURE.MODEL_REFUSED)
        : Effect.catch(Schema.decodeUnknownEffect(ask.schema)(answer.output), () =>
            failedAs(PULL_REQUEST_CHAPTERS_FAILURE.INVALID_ANSWER),
          ),
  });
}

/** A chapter the model told, as a story chapter, its words read with the newlines it meant. */
function storyChapter(told: AnswerChapter): Chapter {
  return {
    kind: CHAPTER_KIND.STORY,
    title: unescapeLiteralNewlines(told.title),
    summary: unescapeLiteralNewlines(told.summary),
    hunkRefs: told.hunkRefs,
    keyChanges: told.keyChanges.map((change) => ({
      content: unescapeLiteralNewlines(change.content),
      lineRefs: change.lineRefs,
    })),
    risk: told.risk,
    riskReasons: told.riskReasons,
  };
}

/**
 * The chapter with a hunk placed where it reads: before its file's first
 * hunk that starts after it, after its file's last hunk otherwise, and at
 * the end where the chapter holds none of its file.
 */
function withHunkPlaced(chapter: Chapter, ref: HunkRef): Chapter {
  const refs = chapter.hunkRefs;
  const later = refs.findIndex((each) => each.path === ref.path && each.oldStart > ref.oldStart);
  const lastOfFile = refs.findLastIndex((each) => each.path === ref.path);
  const afterFile = lastOfFile === -1 ? refs.length : lastOfFile + 1;
  const at = later === -1 ? afterFile : later;
  return { ...chapter, hunkRefs: [...refs.slice(0, at), ref, ...refs.slice(at)] };
}

/** How risky each level is against the others; a chapter with no level is below them all. */
const RISK_RANK = new Map<Chapter["risk"], number>([
  [null, -1],
  [CHAPTER_RISK.LOW, 0],
  [CHAPTER_RISK.MEDIUM, 1],
  [CHAPTER_RISK.HIGH, 2],
]);

/**
 * The chapter at the risk a hunk placed in it earns where that is higher,
 * with the hunk's reason beside its own. Note that a placed hunk raises a
 * chapter's risk and never lowers it, because the chapter was judged
 * without it and a risk told too low is the one a reviewer cannot see.
 */
function withRiskOf(chapter: Chapter, risk: Chapter["risk"], reason: string): Chapter {
  if ((RISK_RANK.get(risk) ?? -1) <= (RISK_RANK.get(chapter.risk) ?? -1)) return chapter;
  return { ...chapter, risk, riskReasons: [...chapter.riskReasons, reason] };
}

/** The chapters with the repair applied: each placement in the chapter it names, where one stands at that number, raising its risk where the hunk earns more, and the new chapters after them. */
function repairedChapters(
  chapters: readonly Chapter[],
  repair: typeof repairAnswerSchema.Type,
): readonly Chapter[] {
  let placed = chapters;
  for (const { path, oldStart, chapter, risk, riskReason } of repair.placements) {
    const at = chapter - 1;
    const target = placed[at];
    if (target === undefined) continue;
    const raised = withRiskOf(target, risk, unescapeLiteralNewlines(riskReason));
    placed = placed.with(at, withHunkPlaced(raised, { path, oldStart }));
  }
  return [...placed, ...repair.newChapters.map(storyChapter)];
}

/**
 * The chapters with the hunks no chapter holds placed by one repair call
 * and held to the shown hunks again. Note that a repair that fails leaves
 * the chapters as they stood, because the first answer is still good and
 * what stays outside closes the story as "Other changes".
 */
function repairCoverage(
  model: ChaptersModel,
  input: ChaptersInput,
  covered: { readonly chapters: readonly Chapter[]; readonly missing: readonly HunkRef[] },
  shown: readonly ChapterHunk[],
  statusOf: (path: string) => string,
): Effect.Effect<{ readonly chapters: readonly Chapter[]; readonly missing: readonly HunkRef[] }> {
  const missingSet = new Set(covered.missing);
  const missing = shown.filter((each) => missingSet.has(each.ref));
  const prompt = repairPrompt({
    title: input.title,
    chapters: covered.chapters,
    missing,
    statusOf,
  });
  // A repair past the cap is never sent, and what it would place closes the story as Other changes.
  if (estimatedTokens(REPAIR_INSTRUCTIONS + prompt) > CHAPTERS_BOUNDS.MAX_INPUT_TOKENS) {
    return Effect.succeed(covered);
  }
  const asked = askStructured(model, {
    system: REPAIR_INSTRUCTIONS,
    prompt,
    schema: repairAnswerSchema,
    maxOutputTokens: CHAPTERS_BOUNDS.REPAIR_MAX_OUTPUT_TOKENS,
  });
  return asked.pipe(
    Effect.map((repair) => coverHunks(repairedChapters(covered.chapters, repair), shown)),
    Effect.catch(() => Effect.succeed(covered)),
  );
}

/** The input's tokens, told by its characters. */
function estimatedTokens(text: string): number {
  return Math.ceil(text.length / CHAPTERS_BOUNDS.CHARS_PER_TOKEN);
}

/** The status a file's hunks are headed with. */
function statusesOf(files: readonly CodingAgentChangedFile[]): (path: string) => string {
  const byPath = new Map(files.map((file) => [file.path, file.status]));
  return (path) => byPath.get(path) ?? "modified";
}

/** Whether a hunk is one a model never sees: a file a reader reads past, or a file with no hunk to read. */
function unseen(each: ChapterHunk): boolean {
  return each.hunk === null || ignoredForChapters(each.ref.path);
}

/**
 * The model chapters are told on, on Luke's own Anthropic key and never the
 * account's meter, or nothing where the deployment holds no key, as the
 * hosted route reads it from `HostedEnvironment`'s `anthropicKey`.
 */
export function chaptersModelOf(
  anthropicKey: Redacted.Redacted | undefined,
  fetch?: typeof globalThis.fetch,
): ChaptersModel | undefined {
  if (anthropicKey === undefined) return undefined;
  // The key is revealed here alone, into the SDK client that puts it on its requests.
  const settings = {
    apiKey: Redacted.value(anthropicKey),
    ...(fetch === undefined ? undefined : { fetch }),
  };
  return { id: CHAPTERS_MODEL_ID, model: createAnthropic(settings)(CHAPTERS_MODEL_ID) };
}

/**
 * A pull request told as chapters on the model given: the shown hunks
 * grouped, ordered, and told in one call, held to the diff, repaired once
 * where hunks were left out, and closed by "Other changes" where anything
 * stands outside. A pull request with nothing to show the model asks it
 * nothing. Fails as too large before any call where the input is past the
 * cap, and as a timeout where the whole takes longer than its bound.
 */
export function generateChapters(
  model: ChaptersModel,
  input: ChaptersInput,
): Effect.Effect<GeneratedChapters, ChaptersFailure> {
  const all = chapterHunks(input.files);
  const shown = all.filter((each) => !unseen(each));
  const statusOf = statusesOf(input.files);
  const prompt = chaptersPrompt({
    title: input.title,
    body: input.body,
    commitMessages: input.commitMessages,
    stats: {
      files: input.files.length,
      additions: input.files.reduce((sum, file) => sum + file.additions, 0),
      deletions: input.files.reduce((sum, file) => sum + file.deletions, 0),
    },
    shown,
    statusOf,
  });
  const generated = Effect.gen(function* () {
    if (estimatedTokens(CHAPTERS_INSTRUCTIONS + prompt) > CHAPTERS_BOUNDS.MAX_INPUT_TOKENS) {
      return yield* failedAs(PULL_REQUEST_CHAPTERS_FAILURE.TOO_LARGE);
    }
    const told =
      shown.length === 0
        ? { chapters: [] }
        : yield* askStructured(model, {
            system: CHAPTERS_INSTRUCTIONS,
            prompt,
            schema: chaptersAnswerSchema,
            maxOutputTokens: CHAPTERS_BOUNDS.MAX_OUTPUT_TOKENS,
          });
    const first = coverHunks(told.chapters.map(storyChapter), shown);
    const covered =
      first.missing.length === 0
        ? first
        : yield* repairCoverage(model, input, first, shown, statusOf);
    const outside = new Set(covered.missing);
    const other = all
      .filter((each) => unseen(each) || outside.has(each.ref))
      .map((each) => each.ref);
    const chapters = covered.chapters.map((chapter) => validLineRefs(chapter, shown));
    return {
      model: model.id,
      chapters: other.length === 0 ? chapters : [...chapters, otherChangesChapter(other)],
    };
  });
  return generated.pipe(
    Effect.timeoutOrElse({
      duration: CHAPTERS_BOUNDS.TIMEOUT,
      orElse: () => failedAs(PULL_REQUEST_CHAPTERS_FAILURE.TIMEOUT),
    }),
  );
}
