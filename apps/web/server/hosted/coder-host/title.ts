import { CODING_AGENT_BOUNDS } from "@sidecar/hosted/coding-agent-wire";
import { generateText, type LanguageModel } from "ai";
import { Duration, Effect, Option } from "effect";

/**
 * title.ts -- a coding agent's title, generated once from what it was handed as the agent starts.
 *
 * One small call, bounded in words and in time, over the plan's name and
 * the agent's first message, the plan's text or the developer's task, asked
 * for a sentence-case title of a few words with nothing around it; what
 * comes back is tidied of the quotes and the full stop a model adds anyway,
 * and cut to the wire's bound. The call that fails, times out, or answers
 * nothing leaves no title, and the tab shows the model's name instead.
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
  "Name the coding task below in three to six words, as a sentence-case title: a capital on the first word only, no quotes, and no punctuation at the end. Answer with the title and nothing else.";

/** The quotes a model wraps a title in, and the punctuation it ends one with. */
const SURROUNDING_QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/gu;
const TRAILING_PUNCTUATION = /[.!?:;,]+$/u;

/** What the title is generated from: the plan's name, and the agent's first message, the plan's text or the developer's task. */
export interface AgentTitleSource {
  readonly planName: string;
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
      prompt: `Plan: ${source.planName}\n\n${source.handed}`,
      maxOutputTokens: AGENT_TITLE.MAX_OUTPUT_TOKENS,
      providerOptions: { anthropic: { effort: AGENT_TITLE.EFFORT } },
    }),
  ).pipe(
    Effect.map((answer) => tidyAgentTitle(answer.text)),
    Effect.timeoutOption(AGENT_TITLE.TIMEOUT),
    Effect.map(Option.flatten),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning("a coding agent's title could not be generated", failure.cause),
        Option.none(),
      ),
    ),
  );
}
