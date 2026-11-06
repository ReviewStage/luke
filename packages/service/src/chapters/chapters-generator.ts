import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  PULL_REQUEST_CHAPTERS_FAILURE,
  type PullRequestChaptersFailure,
} from "@repo/database/pull-request-chapters-vocabulary";
import type { AgentChangedFile } from "@repo/features/agent-wire";
import { type ChaptersModelId, chaptersModelOn } from "@repo/features/chapters-model-choice";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
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
} from "@repo/features/pull-request-chapters";
import { failureKind } from "@repo/runtime/effect";
import { jsonRoundTrip } from "@repo/wire";
import { describeWire, emitJsonSchema } from "@repo/wire/effect";
import {
  generateText,
  jsonSchema,
  type LanguageModel,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";
import { Data, Duration, Effect, Redacted, Schema } from "effect";
import type { OwnKey } from "../agents/coder-host/model.js";
import {
  CHAPTERS_INSTRUCTIONS,
  chaptersPrompt,
  REPAIR_INSTRUCTIONS,
  repairPrompt,
} from "./chapters-prompt.js";

export class ChaptersFailure extends Data.TaggedError("ChaptersFailure")<{
  readonly kind: PullRequestChaptersFailure;
}> {}

export const CHAPTERS_BOUNDS = {
  TIMEOUT: Duration.seconds(180),
  MAX_OUTPUT_TOKENS: 32_000,
  REPAIR_MAX_OUTPUT_TOKENS: 8_000,
  EFFORT: "medium",
} as const;

const FINISH_REFUSED = "content-filter";

export interface ChaptersModel {
  readonly id: string;
  readonly model: LanguageModel;
}

export interface ChaptersInput {
  readonly files: readonly AgentChangedFile[];
  readonly title: string;
  readonly body: string | null;
  readonly commitMessages?: readonly string[];
}

export interface GeneratedChapters {
  readonly model: string;
  readonly chapters: readonly Chapter[];
}

const answerHunkRefSchema = Schema.Struct({
  path: describeWire(Schema.String, "The exact path a hunk header names."),
  oldStart: describeWire(Schema.Int, "The oldStart that same hunk header names."),
});

const answerLineRefSchema = Schema.Struct({
  path: Schema.String,
  side: describeWire(
    Schema.Literals(Object.values(LINE_REF_SIDE)),
    "additions for the new (right) column's lines, deletions for the old (left) column's.",
  ),
  startLine: Schema.Int,
  endLine: Schema.Int,
});

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

export const chaptersAnswerSchema = Schema.Struct({
  chapters: Schema.Array(answerChapterSchema),
});

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

interface StructuredAsk<A> {
  readonly system: string;
  readonly prompt: string;
  readonly schema: Schema.Codec<A, unknown>;
  readonly maxOutputTokens: number;
}

function callFailureOf(cause: unknown): PullRequestChaptersFailure {
  if (NoObjectGeneratedError.isInstance(cause)) {
    return cause.finishReason === FINISH_REFUSED
      ? PULL_REQUEST_CHAPTERS_FAILURE.MODEL_REFUSED
      : PULL_REQUEST_CHAPTERS_FAILURE.INVALID_ANSWER;
  }
  if (NoOutputGeneratedError.isInstance(cause)) return PULL_REQUEST_CHAPTERS_FAILURE.INVALID_ANSWER;
  return PULL_REQUEST_CHAPTERS_FAILURE.MODEL_REFUSED;
}

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
        providerOptions: {
          anthropic: { effort: CHAPTERS_BOUNDS.EFFORT },
          openai: { reasoningEffort: CHAPTERS_BOUNDS.EFFORT },
        },
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

function withHunkPlaced(chapter: Chapter, ref: HunkRef): Chapter {
  const refs = chapter.hunkRefs;
  const later = refs.findIndex((each) => each.path === ref.path && each.oldStart > ref.oldStart);
  const lastOfFile = refs.findLastIndex((each) => each.path === ref.path);
  const afterFile = lastOfFile === -1 ? refs.length : lastOfFile + 1;
  const at = later === -1 ? afterFile : later;
  return { ...chapter, hunkRefs: [...refs.slice(0, at), ref, ...refs.slice(at)] };
}

const RISK_RANK = new Map<Chapter["risk"], number>([
  [null, -1],
  [CHAPTER_RISK.LOW, 0],
  [CHAPTER_RISK.MEDIUM, 1],
  [CHAPTER_RISK.HIGH, 2],
]);

function withRiskOf(chapter: Chapter, risk: Chapter["risk"], reason: string): Chapter {
  if ((RISK_RANK.get(risk) ?? -1) <= (RISK_RANK.get(chapter.risk) ?? -1)) return chapter;
  return { ...chapter, risk, riskReasons: [...chapter.riskReasons, reason] };
}

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

function statusesOf(files: readonly AgentChangedFile[]): (path: string) => string {
  const byPath = new Map(files.map((file) => [file.path, file.status]));
  return (path) => byPath.get(path) ?? "modified";
}

function unseen(each: ChapterHunk): boolean {
  return each.hunk === null || ignoredForChapters(each.ref.path);
}

export function chaptersModelOf(
  own: OwnKey,
  modelId: ChaptersModelId,
  fetch?: typeof globalThis.fetch,
): ChaptersModel {
  const settings = {
    apiKey: Redacted.value(own.key),
    ...(fetch === undefined ? undefined : { fetch }),
  };
  const id = chaptersModelOn(own.provider, modelId);
  if (own.provider === MODEL_PROVIDER.ANTHROPIC) {
    return { id, model: createAnthropic(settings)(id) };
  }
  return { id, model: createOpenAI(settings).responses(id) };
}

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
