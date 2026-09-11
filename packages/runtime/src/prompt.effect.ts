/**
 * `gatherPromptFacts` in Effect's own terms. `prompt.ts` is a port of OpenClaw
 * `b7528507` and stays faithful to it — it imports nothing from `effect` —
 * so the one thing this sibling wraps is the fact-gathering stage, the only
 * part of the module that reaches a file: it reads the workspace's bootstrap
 * files, the skill roots, and the execution directory's own `AGENTS.md`, and
 * an unexpected failure there becomes a typed error.
 *
 * `buildSystemPrompt` gets no sibling: it is already a pure function of the
 * facts it is handed — no file, no clock, no failure mode — so an
 * `Effect.sync` around it would add a layer with nothing behind it.
 */
import { Data, Effect } from "effect";
import { type GatherOptions, gatherPromptFacts, type PromptFacts } from "./prompt.js";

/** An unexpected filesystem failure while gathering the facts a prompt is built from. */
export class PromptFactsIOError extends Data.TaggedError("PromptFactsIOError")<{
  readonly cause: unknown;
}> {}

/**
 * Gathers the live facts a prompt is built from: the workspace's bootstrap
 * files, the eligible skills under the configuration's roots, and the
 * execution directory's notes when a run has one.
 */
export const gatherPromptFactsEffect = (
  options: GatherOptions,
): Effect.Effect<PromptFacts, PromptFactsIOError> =>
  Effect.tryPromise({
    try: () => gatherPromptFacts(options),
    catch: (cause) => new PromptFactsIOError({ cause }),
  });
