import { CODING_AGENT_BOUNDS } from "@sidecar/hosted/coding-agent-wire";
import { generateText, type LanguageModel } from "ai";
import { Duration, Effect, Option, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { childTitlesOf, fillChildTitle } from "../child-titles.js";
import type { ConversationTarget } from "../store/index.js";

/**
 * title.ts -- a coding agent's title, generated once from what it was handed as the agent starts, and a subagent's the same way.
 *
 * One small call, bounded in words and in time, over the plan's name and
 * the agent's first message, the plan's text or the developer's task, asked
 * for a sentence-case title of a few words with nothing around it; what
 * comes back is tidied of the quotes and the full stop a model adds anyway,
 * and cut to the wire's bound. The call that fails, times out, or answers
 * nothing leaves no title, and the tab shows the model's name instead.
 * A subagent, a coding agent's worker or a planning worker, is named by
 * the same call over the task it was handed alone, there being no plan of
 * its own to name, and its title is filled on its child conversation
 * (`child-titles.ts`).
 * Nothing of the plan or the task leaves here but to the model.
 */

const AGENT_TITLE = {
  /** The most tokens the model may spend on the title, which is a few words. */
  MAX_OUTPUT_TOKENS: 64,
  /** How long the call may take before the agent goes untitled. */
  TIMEOUT: Duration.seconds(20),
  /** The least the model is asked to think, since a title is no reasoning task. */
  EFFORT: "low",
} as const;

const INSTRUCTIONS =
  "Name the task below in three to six words, as a sentence-case title: a capital on the first word only, no quotes, and no punctuation at the end. Answer with the title and nothing else.";

/** The quotes a model wraps a title in, and the punctuation it ends one with. */
const SURROUNDING_QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/gu;
const TRAILING_PUNCTUATION = /[.!?:;,]+$/u;

/** What the title is generated from: the plan's name, absent for a subagent, and the first message, the plan's text or the task. */
export interface AgentTitleSource {
  readonly planName?: string;
  readonly handed: string;
}

/** The model's answer as a title: its first line, unquoted, unpunctuated, and bounded; nothing where nothing is left. */
function tidyAgentTitle(answer: string): Option.Option<string> {
  const line = answer.trim().split("\n")[0] ?? "";
  const title = line
    .replaceAll(SURROUNDING_QUOTES, "")
    .replace(TRAILING_PUNCTUATION, "")
    .trim()
    .slice(0, CODING_AGENT_BOUNDS.MAX_TITLE_CHARS)
    .trim();
  return title.length === 0 ? Option.none() : Option.some(title);
}

/** The title the model gives the task, or nothing for a call that failed, ran out of time, or answered nothing. */
export function generateAgentTitle(
  model: LanguageModel,
  source: AgentTitleSource,
): Effect.Effect<Option.Option<string>> {
  return Effect.tryPromise(() =>
    generateText({
      model,
      system: INSTRUCTIONS,
      prompt:
        source.planName === undefined
          ? source.handed
          : `Plan: ${source.planName}\n\n${source.handed}`,
      maxOutputTokens: AGENT_TITLE.MAX_OUTPUT_TOKENS,
      providerOptions: { anthropic: { effort: AGENT_TITLE.EFFORT } },
    }),
  ).pipe(
    Effect.map((answer) => tidyAgentTitle(answer.text)),
    Effect.timeoutOption(AGENT_TITLE.TIMEOUT),
    Effect.map(Option.flatten),
    Effect.catch((failure) =>
      Effect.as(Effect.logWarning("a title could not be generated", failure.cause), Option.none()),
    ),
  );
}

/**
 * A subagent's title generated from the task it was handed and filled on
 * its child conversation, for a child that has none yet: a title already
 * standing is never asked for again, and a call that fails leaves the child
 * untitled. A child not yet opened is filled nowhere.
 */
export function titleSubagent(
  model: LanguageModel,
  parent: ConversationTarget,
  childConversationId: string,
  task: string,
): Effect.Effect<void, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const standing = yield* childTitlesOf(parent, [childConversationId]);
    if (standing.has(childConversationId)) return;
    const title = yield* generateAgentTitle(model, { handed: task });
    if (Option.isNone(title)) return;
    yield* fillChildTitle(parent, childConversationId, title.value);
  });
}
