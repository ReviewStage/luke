import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  REPLAY_STEP_KIND,
  REPLAY_TOOL_STATE,
  type ReplayStep,
  stepsBytes,
  summaryBytes,
  toolStep,
} from "@luke/features/agent-replay";
import { MockLanguageModelV4 } from "ai/test";
import { Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import {
  type FittedSteps,
  fitReplay,
  measuredBoundBytes,
  REPLAY_FIT,
  replayBudgetBytes,
  replayTokens,
  type SummaryModel,
  summarizeSteps,
  withinWindow,
} from "./replay-summary.js";

/**
 * replay-summary.test.ts -- the steps a replay cannot keep, summarized on a scripted model in
 * chunks sized to its window, a few at a time and then combined, the oldest chunks past the cap
 * left out and said so, and nothing written where a call fails or the whole runs past its time;
 * and the steps kept beside a summary, counted within the bound. The model is a script that keeps
 * what it was asked, at the SDK's own boundary; nothing reaches a database. Synthetic steps,
 * sized to the continues production refused as too long for their window (`PRODUCTION`).
 */

/**
 * The continue Anthropic refused: a first message of about 3.03 MB that it counted at 1,368,155
 * tokens against a window of 1,000,000, continuing a source that had compacted, whose raw steps
 * came to 3.45 MB while the context it last measured was 142,000 tokens.
 */
const PRODUCTION = {
  REFUSED_BYTES: 3_030_000,
  REFUSED_TOKENS: 1_368_155,
  WINDOW_TOKENS: 1_000_000,
  SOURCE_RAW_BYTES: 3_450_000,
  SOURCE_MEASURED_TOKENS: 142_000,
  INSTRUCTIONS_TOKENS: 24_000,
} as const;

/** The bytes a token of that refused message took, as the provider counted them. */
const PROVIDER_BYTES_PER_TOKEN = PRODUCTION.REFUSED_BYTES / PRODUCTION.REFUSED_TOKENS;

/** A tool call whose input and result are JSON, as most of a replay is, about `size` bytes of it. */
const jsonCall = (at: number, size = 2_500): ReplayStep =>
  toolStep({
    summary: `Ran: pnpm test --step ${at}`,
    state: REPLAY_TOOL_STATE.DONE,
    input: JSON.stringify({ command: `pnpm test --step ${at}`, description: "Run the tests" }),
    output: JSON.stringify({
      stdout: Array.from({ length: Math.ceil(size / 40) }, (_, line) => `ok ${line} - case ${at}`),
      exitCode: 0,
      status: "completed",
    }),
  });

/** Steps of tool JSON adding up to about `bytes`. */
const jsonSteps = (bytes: number): ReplayStep[] => {
  const steps: ReplayStep[] = [];
  let used = 0;
  while (used < bytes) {
    const step = jsonCall(steps.length);
    steps.push(step);
    used += stepsBytes([step]);
  }
  return steps;
};

/** A step of the agent's own words, `size` characters long. */
const said = (at: number, size = 1_000): ReplayStep => ({
  kind: REPLAY_STEP_KIND.SAID,
  summary: `Said: Step ${at}.`,
  words: `Step ${at}. ${"x".repeat(size)}`,
});

/** A model answering each call by `answer`, or never where it answers nothing, keeping each prompt it was asked. */
function scripted(answer: (prompt: string) => string | undefined) {
  const asked: string[] = [];
  const bounds: (number | undefined)[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const prompt = JSON.stringify(options.prompt);
      asked.push(prompt);
      bounds.push(options.maxOutputTokens);
      const text = answer(prompt);
      if (text === undefined) return new Promise<never>(() => {});
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  const summary: SummaryModel = { model, providerOptions: {}, counted: Effect.void };
  return { summary, asked, bounds };
}

/** A window whose share eve compacts at leaves room for about `chunkBytes` of steps per summary call. */
const windowFor = (chunkBytes: number) =>
  Math.ceil(
    (chunkBytes / 2 + REPLAY_FIT.SUMMARY_OUTPUT_TOKENS + REPLAY_FIT.SUMMARY_PROMPT_TOKENS) / 0.9,
  );

it.effect(
  "steps that fit one call are summarized by it alone, the summary standing for every step",
  () =>
    Effect.gen(function* () {
      const { summary, asked } = scripted(() => "Recap.");
      const written = yield* summarizeSteps(summary, [said(0), said(1)], 200_000);

      assert.deepEqual(written, Option.some({ text: "Recap.", steps: 2 }));
      assert.equal(asked.length, 1);
      assert.match(asked[0] ?? "", /Step 0\..*Step 1\./su);
    }),
);

it.effect("steps past one call's room are summarized in chunks, then combined oldest first", () =>
  Effect.gen(function* () {
    const { summary, asked } = scripted((prompt) =>
      prompt.includes("Part 1:")
        ? "Whole recap."
        : `Recap of ${/Step (\d+)\./u.exec(prompt)?.[1]}.`,
    );
    const steps = Array.from({ length: 6 }, (_, at) => said(at, 10_000));
    const written = yield* summarizeSteps(summary, steps, windowFor(25_000));

    assert.deepEqual(written, Option.some({ text: "Whole recap.", steps: 6 }));
    assert.equal(asked.length, 4, "three chunks of two steps, then the combining call");
    assert.match(
      asked.at(-1) ?? "",
      /Part 1:\\nRecap of 0\..*Part 2:\\nRecap of 2\..*Part 3:\\nRecap of 4\./su,
    );
  }),
);

it.effect(
  "chunks past the cap leave out the oldest steps, the summary says how many and stands for the rest alone, and each chunk's summary is held to its share of the combining call",
  () =>
    Effect.gen(function* () {
      const { summary, asked, bounds } = scripted((prompt) =>
        prompt.includes("Part 1:") ? "Whole recap." : "Part.",
      );
      const steps = Array.from({ length: REPLAY_FIT.MAX_CHUNKS + 2 }, (_, at) => said(at, 20_000));
      const written = yield* summarizeSteps(summary, steps, windowFor(25_000));

      assert.ok(Option.isSome(written));
      assert.match(
        written.value.text,
        /^\(The oldest 2 steps were too many to summarize and are left out\.\)/u,
      );
      assert.equal(written.value.steps, steps.length - 2, "the two left out are not summarized");
      assert.equal(asked.length, REPLAY_FIT.MAX_CHUNKS + 1);
      const chunkBound = bounds[0] ?? 0;
      assert.ok(
        chunkBound * REPLAY_FIT.MAX_CHUNKS <= 25_000 / 2,
        `each chunk writes at most ${chunkBound}`,
      );
      assert.equal(bounds.at(-1), REPLAY_FIT.SUMMARY_OUTPUT_TOKENS);
      assert.ok(!asked.some((prompt) => prompt.includes("Step 0.") || prompt.includes("Step 1.")));
    }),
);

it.effect(
  "a carried recap in a chunk past the cap is left out with its steps, and the summary stands for none of them",
  () =>
    Effect.gen(function* () {
      const { summary, asked } = scripted((prompt) =>
        prompt.includes("Part 1:") ? "Whole recap." : "Part.",
      );
      const earlier = { text: "The first twenty steps built the store.", steps: 20 };
      // Each step fills a chunk, the recap riding in the first: one chunk past the cap.
      const steps = Array.from({ length: REPLAY_FIT.MAX_CHUNKS + 1 }, (_, at) => said(at, 20_000));
      const written = yield* summarizeSteps(summary, steps, windowFor(25_000), earlier);

      assert.ok(Option.isSome(written));
      assert.match(
        written.value.text,
        /^\(The oldest 21 steps were too many to summarize and are left out\.\)/u,
      );
      assert.equal(written.value.steps, REPLAY_FIT.MAX_CHUNKS);
      assert.ok(!asked.some((prompt) => prompt.includes("built the store")));
    }),
);

it.effect("a call that fails, or a summary still unwritten at the timeout, writes nothing", () =>
  Effect.gen(function* () {
    const failing = scripted(() => "");
    assert.deepEqual(yield* summarizeSteps(failing.summary, [said(0)], 200_000), Option.none());

    const stuck = scripted(() => undefined);
    const fiber = yield* Effect.forkChild(summarizeSteps(stuck.summary, [said(0)], 200_000));
    yield* TestClock.adjust(REPLAY_FIT.TIMEOUT);
    assert.deepEqual(yield* Fiber.join(fiber), Option.none());
  }),
);

it.effect(
  "steps that fit are kept whole and none summarized; past the bound the newest are kept beside the summary's room, or alone where none is written",
  () =>
    Effect.gen(function* () {
      const steps = Array.from({ length: 40 }, (_, at) => said(at, 2_000));
      const whole = yield* fitReplay(steps, undefined, stepsBytes(steps), () =>
        Effect.die("no summary asked for"),
      );
      assert.deepEqual(whole, { kept: steps, summary: undefined });

      const budget = 60_000;
      const recap = { text: "Recap.", steps: 0 };
      const summarized: number[] = [];
      const beside = yield* fitReplay(steps, undefined, budget, (dropped) => {
        summarized.push(dropped.length);
        return Effect.succeed(Option.some({ ...recap, steps: dropped.length }));
      });
      const alone = yield* fitReplay(steps, undefined, budget, () => Effect.succeed(Option.none()));

      assert.equal(beside.summary?.steps, steps.length - beside.kept.length);
      assert.deepEqual(summarized, [steps.length - beside.kept.length]);
      assert.ok(
        beside.kept.length < alone.kept.length,
        "the summary's room came out of the steps kept",
      );
      assert.ok(stepsBytes(alone.kept) <= budget);
      assert.equal(alone.summary, undefined);
      assert.equal(alone.kept.at(-1), steps.at(-1));
    }),
);

it.effect(
  "a recap the source already carried is read first and folded into the new summary, and kept as it is where everything fits",
  () =>
    Effect.gen(function* () {
      const { summary, asked } = scripted(() => "Folded recap.");
      const earlier = { text: "The first twenty steps built the store.", steps: 20 };
      const written = yield* summarizeSteps(summary, [said(0)], 200_000, earlier);
      assert.deepEqual(written, Option.some({ text: "Folded recap.", steps: 21 }));
      assert.match(
        asked[0] ?? "",
        /Recap of the earlier steps:\\nThe first twenty steps built the store\..*Step 0\./su,
      );

      const steps = [said(0), said(1)];
      const kept = yield* fitReplay(steps, earlier, 1_000_000, () =>
        Effect.die("no summary asked for"),
      );
      assert.deepEqual(kept, { kept: steps, summary: earlier });

      const folded: (typeof earlier | undefined)[] = [];
      yield* fitReplay(
        Array.from({ length: 40 }, (_, at) => said(at, 2_000)),
        earlier,
        60_000,
        (_, carried) => {
          folded.push(carried);
          return Effect.succeed(Option.none());
        },
      );
      assert.deepEqual(folded, [earlier]);

      // A new summary that cannot be written keeps the carried one beside fewer of the newest steps.
      const many = Array.from({ length: 40 }, (_, at) => said(at, 2_000));
      const fallback = yield* fitReplay(many, earlier, 60_000, () => Effect.succeed(Option.none()));
      assert.equal(fallback.summary, earlier);
      assert.equal(fallback.kept.at(-1), many.at(-1));
    }),
);

it.effect(
  "the estimate counts the refused replay at no fewer tokens than its provider did, and a replay of tool JSON fitted by it stays under the window",
  () =>
    Effect.gen(function* () {
      assert.ok(replayTokens(PRODUCTION.REFUSED_BYTES) >= PRODUCTION.REFUSED_TOKENS);

      const steps = jsonSteps(PRODUCTION.REFUSED_BYTES);
      const budget = replayBudgetBytes(
        PRODUCTION.WINDOW_TOKENS,
        PRODUCTION.INSTRUCTIONS_TOKENS,
        20_000,
      );
      const fitted = yield* fitReplay(steps, undefined, budget, () =>
        Effect.succeed(Option.none()),
      );

      assert.ok(fitted.kept.length < steps.length, "the whole did not fit, and was cut");
      const counted =
        PRODUCTION.INSTRUCTIONS_TOKENS +
        (stepsBytes(fitted.kept) + 20_000) / PROVIDER_BYTES_PER_TOKEN;
      assert.ok(
        counted < PRODUCTION.WINDOW_TOKENS,
        `the provider would count ${Math.round(counted)} tokens`,
      );
    }),
);

it.effect(
  "a compacted source of 3.45 MB replays verbatim no more than the context it last measured, the rest summarized, the whole far under the window",
  () =>
    Effect.gen(function* () {
      const steps = jsonSteps(PRODUCTION.SOURCE_RAW_BYTES);
      const measured = { inputTokens: PRODUCTION.SOURCE_MEASURED_TOKENS, compacted: true };
      const bound = measuredBoundBytes(measured, stepsBytes(steps));
      assert.ok(bound !== undefined);
      const budget = replayBudgetBytes(
        PRODUCTION.WINDOW_TOKENS,
        PRODUCTION.INSTRUCTIONS_TOKENS,
        20_000,
      );
      const summarized: number[] = [];
      const fitted = yield* fitReplay(steps, undefined, Math.min(budget, bound), (dropped) => {
        summarized.push(dropped.length);
        return Effect.succeed(Option.some({ text: "Recap.", steps: dropped.length }));
      });

      assert.deepEqual(summarized, [steps.length - fitted.kept.length]);
      assert.equal(fitted.summary?.steps, steps.length - fitted.kept.length);
      assert.equal(fitted.kept.at(-1), steps.at(-1), "the newest steps are the ones kept");
      const replayed = stepsBytes(fitted.kept) + summaryBytes(fitted.summary);
      assert.ok(replayTokens(replayed) <= PRODUCTION.SOURCE_MEASURED_TOKENS);
      assert.ok(replayed / PROVIDER_BYTES_PER_TOKEN < PRODUCTION.WINDOW_TOKENS / 4);

      // A source that never compacted, whose steps are what it last measured, is bounded by the window alone.
      const whole = jsonSteps(200_000);
      assert.equal(
        measuredBoundBytes(
          { inputTokens: replayTokens(stepsBytes(whole)), compacted: false },
          stepsBytes(whole),
        ),
        undefined,
      );
      // One whose raw steps far outgrow what it last measured is bounded by that, compacted or not.
      assert.equal(
        measuredBoundBytes(
          { inputTokens: PRODUCTION.SOURCE_MEASURED_TOKENS, compacted: false },
          PRODUCTION.SOURCE_RAW_BYTES,
        ),
        bound,
      );
    }),
);

it("a first prompt still past the window drops the oldest steps kept, then the summary, until it fits", () => {
  const steps = jsonSteps(100_000);
  const fitted: FittedSteps = { kept: steps, summary: { text: "Recap.", steps: 7 } };
  const fixedTokens = 10_000;
  const promptTokens = (held: FittedSteps) =>
    fixedTokens + replayTokens(stepsBytes(held.kept) + summaryBytes(held.summary));
  const window = promptTokens(fitted);

  assert.equal(withinWindow(fitted, promptTokens, window), fitted, "a prompt that fits stands");

  const fewer = withinWindow(fitted, promptTokens, window - 10_000);
  assert.ok(promptTokens(fewer) <= window - 10_000);
  assert.ok(fewer.kept.length > 0 && fewer.kept.length < steps.length);
  assert.equal(fewer.kept.at(-1), steps.at(-1));
  assert.deepEqual(fewer.summary, fitted.summary);

  const bare = withinWindow(fitted, promptTokens, fixedTokens);
  assert.deepEqual(bare, { kept: [], summary: undefined });
});
