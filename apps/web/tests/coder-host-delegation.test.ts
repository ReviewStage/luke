import assert from "node:assert/strict";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { Result } from "effect";
import { test } from "vitest";
import { delegationChoice } from "../server/hosted/coder-host/delegation";
import type { OfferedModel } from "../server/hosted/model-catalog";

/**
 * What a coding agent may choose for a worker, held to the catalog a Start
 * is held to: an ask that names nothing runs the worker on the agent's own
 * pair, a pair the catalog offers is taken as asked, and one it does not is
 * refused in a sentence that lists what would have been taken.
 */

const CATALOG: readonly OfferedModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  },
];

const OWN = { model: "anthropic/claude-opus-5.5", effort: "high" } as const;

test("an ask that names nothing runs the worker on the agent's own pair, and one that names a pair the catalog offers runs it as asked", () => {
  assert.deepEqual(delegationChoice(OWN, {}, CATALOG), Result.succeed(OWN));
  assert.deepEqual(
    delegationChoice(OWN, { model: "openai/gpt-6.1-sol", effort: "low" }, CATALOG),
    Result.succeed({ model: "openai/gpt-6.1-sol", effort: "low" }),
  );
  assert.deepEqual(
    delegationChoice(OWN, { effort: "max" }, CATALOG),
    Result.succeed({ model: OWN.model, effort: "max" }),
  );
});

test("an ask outside the catalog is refused with the models offered, or with the efforts the named model lists", () => {
  const unknownModel = delegationChoice(OWN, { model: "google/gemini-3" }, CATALOG);
  assert.ok(Result.isFailure(unknownModel));
  assert.ok(unknownModel.failure.includes("anthropic/claude-opus-5.5, openai/gpt-6.1-sol"));

  const unknownEffort = delegationChoice(
    OWN,
    { model: "openai/gpt-6.1-sol", effort: "max" },
    CATALOG,
  );
  assert.ok(Result.isFailure(unknownEffort));
  assert.ok(unknownEffort.failure.includes("`max`"));
  assert.ok(unknownEffort.failure.includes("low, high"));
});
