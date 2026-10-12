import { turnsBefore } from "@sidecar/database/models/message-reads";
import { CODING_AGENT_BOUNDS } from "@sidecar/hosted/coding-agent-wire";
import { generateText, isTextUIPart, type LanguageModel } from "ai";
import { Effect, Option, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { MESSAGE_ROLE, type StoredUIMessage } from "../../core.js";
import { childTitlesOf, fillChildTitle } from "../child-titles.js";
import { type CodingAgent, fillCodingAgentTitle } from "../coding-agent-store.js";
import { type ConversationTarget, listMessagesPast, listRecentMessages } from "../store/index.js";
import { CODER } from "./bounds.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import { CURSOR_START } from "./transcript.js";

/**
 * title.ts -- a coding agent's title, generated from its first exchange as a turn of its ends, and a subagent's from the task it was handed.
 *
 * One small call, bounded in words and in time, asked for a sentence-case
 * title of a few words with nothing around it; what comes back is tidied
 * of the quotes and the full stop a model adds anyway, and cut to the
 * wire's bound. An agent is named from what the developer first said to
 * it, what they said last where that is another message, and what it last
 * answered, each cut to an excerpt, as a chat is
 * named from its opening rather than from the plan it was started under:
 * an agent started from the plan said the plan first, so the plan is what
 * names it, and one started on a task of its own is named for that task.
 * An exchange that names no task yet, a greeting or a file with no words,
 * is answered with nothing, and the next turn's end asks again, for the
 * agent's first `CODER.TITLE_TURNS` turns; a call that fails, times out, or
 * answers nothing writes nothing, and the tab shows the model's name
 * meanwhile. A subagent, a coding agent's worker or a planning worker, is
 * named by the same call over the task it was handed alone, and its title
 * is filled on its child conversation (`child-titles.ts`). Nothing of the
 * conversation leaves here but to the model.
 */

const AGENT_TITLE = {
  /** The most tokens the model may spend on the title, which is a few words. */
  MAX_OUTPUT_TOKENS: 64,
  /** How long the call may take before the agent goes untitled. */
  TIMEOUT: CODER.TITLE_TIMEOUT,
  /** The least the model is asked to think, since a title is no reasoning task. */
  EFFORT: "low",
  /** The most of each message the call reads, which is enough to tell the task from. */
  EXCERPT_CHARS: 2_000,
  /** The newest messages read for the agent's latest answer, past the lines sent since it ended. */
  RECENT_MESSAGES: 8,
} as const;

const INSTRUCTIONS =
  "Name the task below in three to six words, as a sentence-case title: a capital on the first word only, no quotes, and no punctuation at the end. Answer with the title and nothing else, or with nothing at all where no task is named yet, as in a greeting.";

/** The quotes a model wraps a title in, and the punctuation it ends one with. */
const SURROUNDING_QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/gu;
const TRAILING_PUNCTUATION = /[.!?:;,]+$/u;

/** Who each message of an agent's exchange is said by, as the call reads it. */
const SPEAKER = {
  DEVELOPER: "Developer",
  AGENT: "Agent",
} as const;

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

/** A message's words as the call reads them: its text alone, cut to the excerpt; a file it carries is no word of it. */
function excerptOf(message: StoredUIMessage | undefined): string {
  const words = (message?.parts ?? [])
    .filter((part) => isTextUIPart(part))
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .join("\n");
  return words.slice(0, AGENT_TITLE.EXCERPT_CHARS);
}

/**
 * What an agent is named from: the developer's first message, their latest
 * where it is another, so a retry past a greeting reads the task that
 * followed it, and the agent's latest answer, each by its speaker, a
 * message with no words left out.
 */
function agentExchange(
  target: ConversationTarget,
): Effect.Effect<string, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const { userId, conversationId } = target;
    const opening = yield* listMessagesPast(
      userId,
      conversationId,
      CODER_TOOL_SET,
      CURSOR_START,
      1,
    );
    const recent = yield* listRecentMessages(
      userId,
      conversationId,
      CODER_TOOL_SET,
      AGENT_TITLE.RECENT_MESSAGES,
    );
    const first = opening.read.ok ? opening.read.value[0] : undefined;
    const newest = recent.ok ? recent.value : [];
    const said = newest.findLast((record) => record.message.role === MESSAGE_ROLE.USER);
    const answered = newest.findLast((record) => record.message.role === MESSAGE_ROLE.ASSISTANT);
    const opened = first?.message.role === MESSAGE_ROLE.USER ? first : undefined;
    return [
      { speaker: SPEAKER.DEVELOPER, words: excerptOf(opened?.message) },
      {
        speaker: SPEAKER.DEVELOPER,
        words: said === undefined || said.id === opened?.id ? "" : excerptOf(said.message),
      },
      { speaker: SPEAKER.AGENT, words: excerptOf(answered?.message) },
    ]
      .filter((line) => line.words.length > 0)
      .map((line) => `${line.speaker}: ${line.words}`)
      .join("\n\n");
  });
}

/** The title the model gives the task, or nothing for a call that failed, ran out of time, or answered nothing. */
function generateAgentTitle(
  model: LanguageModel,
  named: string,
): Effect.Effect<Option.Option<string>> {
  return Effect.tryPromise(() =>
    generateText({
      model,
      system: INSTRUCTIONS,
      prompt: named,
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
    const title = yield* generateAgentTitle(model, task);
    if (Option.isNone(title)) return;
    yield* fillChildTitle(parent, childConversationId, title.value);
  });
}

/**
 * An agent's title generated from its first exchange and written where
 * none stands, as one of its first `CODER.TITLE_TURNS` turns ends: a title
 * already standing, the developer's own included, is never asked for
 * again, an agent past those turns is left on the model's name, and an
 * exchange with no words in it asks nothing. A call that answers nothing
 * writes nothing, so the next turn's end asks again.
 */
export function titleCodingAgent(
  model: LanguageModel,
  target: ConversationTarget,
  agent: CodingAgent,
): Effect.Effect<void, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    if (agent.title !== null) return;
    const ran = yield* turnsBefore(
      target.userId,
      target.conversationId,
      CODER.TITLE_TURNS,
      undefined,
    );
    if (ran.earlier) return;
    const exchange = yield* agentExchange(target);
    if (exchange.length === 0) return;
    const title = yield* generateAgentTitle(model, exchange);
    if (Option.isNone(title)) return;
    yield* fillCodingAgentTitle(target.userId, agent.id, title.value);
  });
}
