import { once } from "node:events";
import { expect, it } from "@effect/vitest";
import { PULL_REQUEST_CHAPTERS_FAILURE } from "@luke/database/pull-request-chapters-vocabulary";
import {
  CHANGED_FILE_STATUS,
  type ChangedFileStatus,
  type CodingAgentChangedFile,
  PATCH_OMITTED,
} from "@luke/features/coding-agent-wire";
import {
  CHAPTER_KIND,
  CHAPTER_RISK,
  type Chapter,
  LINE_REF_SIDE,
} from "@luke/features/pull-request-chapters";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  CHAPTERS_BOUNDS,
  type ChaptersInput,
  type ChaptersModel,
  generateChapters,
} from "./chapters-generator.js";

/**
 * chapters-generator.test.ts -- a pull request told as chapters on a scripted model: the answer held to the diff, the hunks it left out repaired once and the rest closed as "Other changes", ignored files kept from the model, and each way a generation fails named by its kind. Synthetic throughout; no provider is reached.
 */

/** One answer the scripted model gives, in the order it is asked. */
type Step =
  | { readonly answer: unknown }
  | { readonly text: string }
  | { readonly refused: true }
  | { readonly fails: Error }
  | { readonly hangs: true };

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** What the model answers for a step that answers words. */
function answered(text: string, refused = false) {
  return {
    content: refused ? [] : [{ type: "text" as const, text }],
    finishReason: refused
      ? { unified: "content-filter" as const, raw: "refusal" }
      : { unified: "stop" as const, raw: "end_turn" },
    usage: USAGE,
    warnings: [],
  };
}

/** A scripted model, and every prompt it was asked, its instructions with it. */
interface ScriptedModel {
  readonly model: ChaptersModel;
  readonly asked: readonly string[];
}

/** A model that answers the steps in order and keeps every prompt it was asked. */
function scriptedModel(steps: readonly Step[]): ScriptedModel {
  const asked: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const step = steps[asked.length];
      asked.push(JSON.stringify(options.prompt));
      if (step === undefined) throw new Error("the script has no answer left");
      if ("hangs" in step) {
        if (options.abortSignal !== undefined) await once(options.abortSignal, "abort");
        throw new Error("aborted");
      }
      if ("fails" in step) throw step.fails;
      if ("refused" in step) return answered("", true);
      return answered("text" in step ? step.text : JSON.stringify(step.answer));
    },
  });
  return { model: { id: "scripted", model }, asked };
}

/** A changed file with its patch. */
function changed(
  path: string,
  patch: string | null,
  status: ChangedFileStatus = CHANGED_FILE_STATUS.MODIFIED,
): CodingAgentChangedFile {
  return {
    path,
    previousPath: null,
    status,
    additions: 1,
    deletions: 1,
    patch,
    omitted: patch === null ? PATCH_OMITTED.BINARY : null,
  };
}

/** A file of two hunks: one adding line 2, starting at old line 1; one changing old line 21, starting at old line 20. */
const TWO_HUNKS = changed(
  "src/app.ts",
  [
    "@@ -1,3 +1,4 @@",
    " const a = 1;",
    "+const b = 2;",
    " const c = 3;",
    " const d = 4;",
    "@@ -20,3 +21,3 @@",
    " function f() {",
    "-  return 1;",
    "+  return 2;",
    " }",
  ].join("\n"),
);

/** A file added whole, its one hunk starting at old line 0. */
const ADDED = changed(
  "src/util.ts",
  ["@@ -0,0 +1,2 @@", "+export const util = 1;", "+export const more = 2;"].join("\n"),
  CHANGED_FILE_STATUS.ADDED,
);

const APP_FIRST = { path: "src/app.ts", oldStart: 1 };
const APP_SECOND = { path: "src/app.ts", oldStart: 20 };
const UTIL = { path: "src/util.ts", oldStart: 0 };

/** The pull request's words around its files. */
function pullRequest(files: readonly CodingAgentChangedFile[]): ChaptersInput {
  return { files, title: "Tidy the app", body: "Small changes." };
}

/** A chapter as the model tells one, holding the hunks named. */
function told(title: string, hunkRefs: readonly unknown[], keyChanges: readonly unknown[] = []) {
  return {
    title,
    summary: `${title}, told.`,
    hunkRefs,
    keyChanges,
    risk: CHAPTER_RISK.LOW,
    riskReasons: ["Local change."],
  };
}

/** The titles and hunks of chapters, which is what most of these tests read. */
function shapeOf(chapters: readonly Chapter[]) {
  return chapters.map((chapter) => ({
    kind: chapter.kind,
    title: chapter.title,
    hunkRefs: chapter.hunkRefs,
  }));
}

it.effect(
  "puts the hunks a model left out to it once and closes what it still leaves out as Other changes",
  () =>
    Effect.gen(function* () {
      const script = scriptedModel([
        { answer: { chapters: [told("Bump the constants", [APP_FIRST])] } },
        { answer: { placements: [{ ...APP_SECOND, chapter: 1 }], newChapters: [] } },
      ]);

      const generated = yield* generateChapters(script.model, pullRequest([TWO_HUNKS, ADDED]));

      expect(shapeOf(generated.chapters)).toEqual([
        {
          kind: CHAPTER_KIND.STORY,
          title: "Bump the constants",
          hunkRefs: [APP_FIRST, APP_SECOND],
        },
        { kind: CHAPTER_KIND.OTHER, title: "Other changes", hunkRefs: [UTIL] },
      ]);
      expect(generated.model).toBe("scripted");
      expect(script.asked).toHaveLength(2);
      expect(script.asked[1]).toContain(String.raw`path: \"src/util.ts\", oldStart: 0`);
    }),
);

it.effect("reads a new chapter the repair tells after the chapters before it", () =>
  Effect.gen(function* () {
    const script = scriptedModel([
      { answer: { chapters: [told("Bump the constants", [APP_SECOND, APP_FIRST])] } },
      { answer: { placements: [], newChapters: [told("Add the util", [UTIL])] } },
    ]);

    const generated = yield* generateChapters(script.model, pullRequest([TWO_HUNKS, ADDED]));

    expect(shapeOf(generated.chapters)).toEqual([
      { kind: CHAPTER_KIND.STORY, title: "Bump the constants", hunkRefs: [APP_SECOND, APP_FIRST] },
      { kind: CHAPTER_KIND.STORY, title: "Add the util", hunkRefs: [UTIL] },
    ]);
  }),
);

it.effect("closes the left-out hunks as Other changes when the repair cannot be read", () =>
  Effect.gen(function* () {
    const script = scriptedModel([
      { answer: { chapters: [told("Bump the constants", [APP_FIRST, APP_SECOND])] } },
      { text: "I would put it in chapter one." },
    ]);

    const generated = yield* generateChapters(script.model, pullRequest([TWO_HUNKS, ADDED]));

    expect(shapeOf(generated.chapters).map((chapter) => chapter.hunkRefs)).toEqual([
      [APP_FIRST, APP_SECOND],
      [UTIL],
    ]);
  }),
);

it.effect(
  "drops a hunk named twice from its later chapter, and a hunk the diff does not hold",
  () =>
    Effect.gen(function* () {
      const ghost = { path: "src/ghost.ts", oldStart: 3 };
      const script = scriptedModel([
        {
          answer: {
            chapters: [
              told("Bump the constants", [APP_FIRST, ghost]),
              told("Return two", [APP_FIRST, APP_SECOND]),
              told("Haunt the house", [ghost]),
            ],
          },
        },
      ]);

      const generated = yield* generateChapters(script.model, pullRequest([TWO_HUNKS]));

      expect(shapeOf(generated.chapters)).toEqual([
        { kind: CHAPTER_KIND.STORY, title: "Bump the constants", hunkRefs: [APP_FIRST] },
        { kind: CHAPTER_KIND.STORY, title: "Return two", hunkRefs: [APP_SECOND] },
      ]);
      expect(script.asked).toHaveLength(1);
    }),
);

it.effect(
  "keeps ignored files and files with no hunk from the model and closes them as Other changes",
  () =>
    Effect.gen(function* () {
      const lockfile = changed(
        "pnpm-lock.yaml",
        ["@@ -1,1 +1,1 @@", "-lockfileVersion: '8.0'", "+lockfileVersion: '9.0'"].join("\n"),
      );
      const picture = changed("assets/logo.bin", null, CHANGED_FILE_STATUS.ADDED);
      const script = scriptedModel([
        { answer: { chapters: [told("Tidy the app", [APP_FIRST, APP_SECOND])] } },
      ]);

      const generated = yield* generateChapters(
        script.model,
        pullRequest([lockfile, TWO_HUNKS, picture]),
      );

      expect(script.asked).toHaveLength(1);
      expect(script.asked[0]).not.toContain("pnpm-lock.yaml");
      expect(script.asked[0]).not.toContain("lockfileVersion");
      expect(script.asked[0]).not.toContain("assets/logo.bin");
      expect(shapeOf(generated.chapters).at(-1)).toEqual({
        kind: CHAPTER_KIND.OTHER,
        title: "Other changes",
        hunkRefs: [
          { path: "pnpm-lock.yaml", oldStart: 1 },
          { path: "assets/logo.bin", oldStart: 0 },
        ],
      });
    }),
);

it.effect("asks the model nothing where every file is one it never sees", () =>
  Effect.gen(function* () {
    const script = scriptedModel([]);
    const lockfile = changed("yarn.lock", ["@@ -1,1 +1,1 @@", "-a", "+b"].join("\n"));

    const generated = yield* generateChapters(script.model, pullRequest([lockfile]));

    expect(script.asked).toHaveLength(0);
    expect(shapeOf(generated.chapters)).toEqual([
      {
        kind: CHAPTER_KIND.OTHER,
        title: "Other changes",
        hunkRefs: [{ path: "yarn.lock", oldStart: 1 }],
      },
    ]);
  }),
);

it.effect("refuses a diff past the input cap as too large without calling the model", () =>
  Effect.gen(function* () {
    const script = scriptedModel([]);
    const capChars = CHAPTERS_BOUNDS.MAX_INPUT_TOKENS * CHAPTERS_BOUNDS.CHARS_PER_TOKEN;
    const lines = Math.ceil(capChars / 40);
    const huge = changed(
      "src/huge.ts",
      [
        `@@ -0,0 +1,${lines} @@`,
        ...Array.from({ length: lines }, (_, at) => `+const line${at} = "${"x".repeat(20)}";`),
      ].join("\n"),
      CHANGED_FILE_STATUS.ADDED,
    );

    const failure = yield* Effect.flip(generateChapters(script.model, pullRequest([huge])));

    expect(failure.kind).toBe(PULL_REQUEST_CHAPTERS_FAILURE.TOO_LARGE);
    expect(script.asked).toHaveLength(0);
  }),
);

it.effect("answers a timeout where the model takes longer than the bound", () =>
  Effect.gen(function* () {
    const script = scriptedModel([{ hangs: true }]);

    const fiber = yield* Effect.forkChild(
      Effect.flip(generateChapters(script.model, pullRequest([TWO_HUNKS]))),
      { startImmediately: true },
    );
    yield* TestClock.adjust(CHAPTERS_BOUNDS.TIMEOUT);
    const failure = yield* Fiber.join(fiber);

    expect(failure.kind).toBe(PULL_REQUEST_CHAPTERS_FAILURE.TIMEOUT);
  }),
);

it.effect("answers model_refused where the provider refuses the call or fails it", () =>
  Effect.gen(function* () {
    const refusing = scriptedModel([{ refused: true }]);
    const failing = scriptedModel([
      {
        fails: new APICallError({
          message: "overloaded",
          url: "https://provider.invalid/v1/messages",
          requestBodyValues: {},
          statusCode: 400,
          isRetryable: false,
        }),
      },
    ]);

    const refused = yield* Effect.flip(generateChapters(refusing.model, pullRequest([TWO_HUNKS])));
    const failed = yield* Effect.flip(generateChapters(failing.model, pullRequest([TWO_HUNKS])));

    expect(refused.kind).toBe(PULL_REQUEST_CHAPTERS_FAILURE.MODEL_REFUSED);
    expect(failed.kind).toBe(PULL_REQUEST_CHAPTERS_FAILURE.MODEL_REFUSED);
  }),
);

it.effect("answers invalid_answer where the answer is not JSON or not chapters", () =>
  Effect.gen(function* () {
    const prose = scriptedModel([{ text: "Here are your chapters!" }]);
    const misshapen = scriptedModel([{ answer: { chapters: [{ title: 7, hunkRefs: "all" }] } }]);

    const unreadable = yield* Effect.flip(generateChapters(prose.model, pullRequest([TWO_HUNKS])));
    const wrong = yield* Effect.flip(generateChapters(misshapen.model, pullRequest([TWO_HUNKS])));

    expect(unreadable.kind).toBe(PULL_REQUEST_CHAPTERS_FAILURE.INVALID_ANSWER);
    expect(wrong.kind).toBe(PULL_REQUEST_CHAPTERS_FAILURE.INVALID_ANSWER);
  }),
);

it.effect(
  "keeps only line references inside a chapter's own hunks and reads twice-escaped newlines",
  () =>
    Effect.gen(function* () {
      const inside = {
        path: "src/app.ts",
        side: LINE_REF_SIDE.ADDITIONS,
        startLine: 2,
        endLine: 2,
      };
      const otherChapter = {
        path: "src/util.ts",
        side: LINE_REF_SIDE.ADDITIONS,
        startLine: 1,
        endLine: 1,
      };
      const pastHunk = {
        path: "src/app.ts",
        side: LINE_REF_SIDE.ADDITIONS,
        startLine: 9,
        endLine: 12,
      };
      const script = scriptedModel([
        {
          answer: {
            chapters: [
              {
                ...told(
                  "Bump the constants",
                  [APP_FIRST, APP_SECOND],
                  [
                    { content: "Should `b` be two?", lineRefs: [inside, otherChapter, pastHunk] },
                    { content: "Is the util needed?", lineRefs: [otherChapter] },
                  ],
                ),
                summary: String.raw`First.\n\nSecond.`,
              },
              told("Add the util", [UTIL]),
            ],
          },
        },
      ]);

      const generated = yield* generateChapters(script.model, pullRequest([TWO_HUNKS, ADDED]));

      expect(generated.chapters[0]?.keyChanges).toEqual([
        { content: "Should `b` be two?", lineRefs: [inside] },
      ]);
      expect(generated.chapters[0]?.summary).toBe("First.\n\nSecond.");
    }),
);
