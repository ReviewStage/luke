import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { childTitlesOf, fillChildTitle } from "@luke/database/models/child-titles";
import { type CodingAgent, fillCodingAgentTitle } from "@luke/database/models/coding-agent-store";
import {
  listMessagesPast,
  listRecentMessages,
  listTurnOpeners,
  turnsBefore,
} from "@luke/database/models/message-reads";
import { nameUntitledTask } from "@luke/database/models/task-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import type { StoredAutomationOrigin } from "@luke/database/schemas/coding-agent";
import { firstMessageParts } from "@luke/features/agent-replay";
import { AUTOMATION_FIRING } from "@luke/features/automation-wire";
import { CODING_AGENT_BOUNDS } from "@luke/features/coding-agent-wire";
import { UNTITLED_TASK_NAME } from "@luke/features/task-wire";
import { failureKind } from "@luke/runtime/effect";
import { generateText, isTextUIPart, type LanguageModel, type ToolSet } from "ai";
import { Effect, Option, type Schema } from "effect";
import { SqlClient } from "effect/sql";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE, type StoredUIMessage } from "../../core.js";
import { CODER } from "./bounds.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import { CURSOR_START } from "./transcript.js";

/**
 * title.ts -- a coding agent's title, generated from its opening as its words are received and from its first exchange as a turn of its ends, and a subagent's from the task it was handed.
 *
 * One small call, bounded in words and in time, asked for a sentence-case
 * title of a few words with nothing around it; what comes back is tidied
 * of the quotes and the full stop a model adds anyway, and cut to the
 * wire's bound. An agent is asked for its title as the developer's words
 * are received, so a first turn that runs long is named as it starts, from
 * its opening alone, and again as each of its first turns ends where none
 * stands yet. It is named from what the developer first said to
 * it, what they said last where that is another message, and what it last
 * answered where it has, each cut to an excerpt, as a chat is
 * named from its opening rather than from the plan it was started under:
 * an agent started from the plan said the plan first, so the plan is what
 * names it, and one started on a prompt of its own is named for that prompt.
 * An agent started from another is named from the brief and the note it
 * was handed, never from the other agent's transcript replayed between
 * them (`@luke/features/agent-replay`), whose words are that agent's.
 * An automation's run is named from the automation's prompt alone in its
 * opening's place, without the lines Luke adds of the firing, which would
 * name every run of it alike, and the GitHub event's subject where one
 * fired it; a run about one pull request or issue was named by it as it
 * started (`automation-runs.ts`), so no model is asked.
 * An exchange that names no task yet, a greeting or a file with no words,
 * is answered with nothing, and the next words or turn's end ask again, for the
 * agent's first `CODER.TITLE_TURNS` turns; a call that fails, times out, or
 * answers nothing writes nothing, and the tab shows the automation's name
 * meanwhile, where an automation's run started the agent, and the model's
 * otherwise. A line a chat notice steered in is no word of the
 * developer's, so it names nothing. A subagent, a coding agent's worker or a
 * planning worker, is named by the same call over the task it was handed alone, and its title
 * is filled on its child conversation (`child-titles.ts`). Nothing of the
 * conversation leaves here but to the model.
 *
 * A task its member left untitled is named by the same call over its
 * conversation with Luke too, under the brain's tools
 * (`brain-host/task-title.ts`), a note the brain wrote down for itself
 * being no word of the developer's.
 *
 * A task still standing untitled, as one started from a prompt alone does,
 * takes the title its first agent to be titled is given, and keeps it: a
 * name a member or Luke gave the task, before or meanwhile, is never
 * written over, and a later agent's title never renames it.
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
  // A task's own sentinel names nothing, so a task it would name stays open to the next title.
  if (title.length === 0 || title.toLowerCase() === UNTITLED_TASK_NAME.toLowerCase()) {
    return Option.none();
  }
  return Option.some(title);
}

/** A part's words without the replay of another agent or the note's marker: the brief and the note where either stands, the part whole otherwise. */
function withoutReplay(text: string): string {
  const read = firstMessageParts(text);
  return read.note === undefined ? read.brief : `${read.brief}\n${read.note.text}`;
}

/** A message's words as the call reads them: its text alone, any replay of another agent left out, cut to the excerpt; a file it carries is no word of it. */
function excerptOf(message: StoredUIMessage | undefined): string {
  const words = (message?.parts ?? [])
    .filter((part) => isTextUIPart(part))
    .map((part) => withoutReplay(part.text).trim())
    .filter((text) => text.length > 0)
    .join("\n");
  return words.slice(0, AGENT_TITLE.EXCERPT_CHARS);
}

/** What an automation's run is named from in its opening's place: the GitHub event's subject where one fired it, then the automation's prompt alone, cut to the excerpt; the subject leads, so a long prompt never cuts it off. */
function originWords(origin: StoredAutomationOrigin): string {
  const { firing } = origin;
  const subject =
    firing.kind === AUTOMATION_FIRING.GITHUB
      ? [
          `Repository: ${firing.repository}`,
          ...(firing.number === undefined ? [] : [`Number: #${firing.number}`]),
          ...(firing.branch === undefined ? [] : [`Branch: ${firing.branch}`]),
          ...(firing.title === undefined ? [] : [`Title: ${firing.title}`]),
        ]
      : [];
  return [...subject, origin.prompt.trim()].join("\n").slice(0, AGENT_TITLE.EXCERPT_CHARS);
}

/** A row of the developer's own words: a user row no chat notice wrote, and no note the brain wrote down for itself. */
function saidByDeveloper(message: StoredUIMessage | undefined): boolean {
  if (message?.role !== MESSAGE_ROLE.USER) return false;
  if ("author" in message.metadata && message.metadata.author === MESSAGE_AUTHOR.BRAIN)
    return false;
  return !("channel" in message.metadata && message.metadata.channel === MESSAGE_CHANNEL.CHAT);
}

/** What the line before an answer is known to be, in the window a title reads. */
const HEARD = {
  /** No answer yet in the window: the line an answer answers may lie before it. */
  UNKNOWN: "unknown",
  /** A line of the developer's since the answer before. */
  DEVELOPER: "developer",
  /** No line of the developer's since the answer before. */
  OTHER: "other",
} as const;

type Heard = (typeof HEARD)[keyof typeof HEARD];

/**
 * The agent's latest answer to the developer: one that follows a line of
 * the developer's since the answer before it, or, before any answer in the
 * window, one whose turn a chat notice did not open, since the line it
 * answers may lie before the window. Note that an answer a chat notice
 * alone prompted is left out, because it speaks to another member of the
 * chat, while one to a developer's line a notice was steered in after
 * still answers the developer.
 */
function answerToDeveloper<
  Row extends { readonly message: StoredUIMessage; readonly turnId?: string },
>(records: readonly Row[], noticed: ReadonlySet<string>): Row | undefined {
  let heard: Heard = HEARD.UNKNOWN;
  let answer: Row | undefined;
  for (const record of records) {
    if (saidByDeveloper(record.message)) heard = HEARD.DEVELOPER;
    if (record.message.role !== MESSAGE_ROLE.ASSISTANT) continue;
    const prompted = record.turnId !== undefined && noticed.has(record.turnId);
    if (heard === HEARD.DEVELOPER || (heard === HEARD.UNKNOWN && !prompted)) answer = record;
    heard = HEARD.OTHER;
  }
  return answer;
}

/**
 * The turns among the answers a chat notice opened. Note that the line
 * that opened a turn is read by the turn's id rather than from the window,
 * because notices a turn took in mid-run can push it out of the window, and
 * a line taken in mid-run names no turn. Nothing where the read is refused,
 * so every answer stands.
 */
function turnsNoticed(
  target: ConversationTarget,
  tools: ToolSet,
  records: readonly { readonly message: StoredUIMessage; readonly turnId?: string }[],
): Effect.Effect<ReadonlySet<string>, QueryError | Schema.SchemaError, DatabaseServices> {
  const turnIds = records.flatMap((record) =>
    record.message.role === MESSAGE_ROLE.ASSISTANT && record.turnId !== undefined
      ? [record.turnId]
      : [],
  );
  return Effect.map(
    listTurnOpeners(target.userId, target.conversationId, tools, [...new Set(turnIds)]),
    (openers) =>
      new Set(
        (openers.ok ? openers.value : []).flatMap((opener) =>
          opener.turnId === undefined || saidByDeveloper(opener.message) ? [] : [opener.turnId],
        ),
      ),
  );
}

/**
 * What an agent is named from: the developer's first message, or an
 * automation's prompt alone where its run started the agent, their latest
 * where it is another, so a retry past a greeting reads the task that
 * followed it, and the agent's latest answer, each by its speaker, a
 * message with no words left out.
 */
function conversationExchange(
  target: ConversationTarget,
  tools: ToolSet,
  origin: StoredAutomationOrigin | null,
): Effect.Effect<string, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.gen(function* () {
    const { userId, conversationId } = target;
    const opening = yield* listMessagesPast(userId, conversationId, tools, CURSOR_START, 1);
    const recent = yield* listRecentMessages(
      userId,
      conversationId,
      tools,
      AGENT_TITLE.RECENT_MESSAGES,
    );
    const first = opening.read.ok ? opening.read.value[0] : undefined;
    const newest = recent.ok ? recent.value : [];
    const said = newest.findLast((record) => saidByDeveloper(record.message));
    const answered = answerToDeveloper(newest, yield* turnsNoticed(target, tools, newest));
    const opened = saidByDeveloper(first?.message) ? first : undefined;
    // An answer to no word of the developer's, as to a wake the brain took before anyone spoke, names nothing.
    if (origin === null && opened === undefined && said === undefined) return "";
    return [
      {
        speaker: SPEAKER.DEVELOPER,
        words: origin === null ? excerptOf(opened?.message) : originWords(origin),
      },
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
      Effect.as(
        Effect.logWarning(`a title could not be generated: ${failureKind(failure.cause)}`),
        Option.none(),
      ),
    ),
  );
}

/**
 * The title generated from a conversation's first exchange, as one of its
 * first `CODER.TITLE_TURNS` turns asks for it: an agent's under the coder's
 * tools, or a task's under the brain's (`brain-host/task-title.ts`), its
 * automation's origin in its opening's place where one started it. Nothing
 * for a conversation past those turns, one with no words in it yet, and a
 * call that answered nothing, so the next turn asks again.
 */
export function titleOfConversation(
  model: LanguageModel,
  target: ConversationTarget,
  tools: ToolSet,
  origin: StoredAutomationOrigin | null = null,
): Effect.Effect<Option.Option<string>, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.gen(function* () {
    const ran = yield* turnsBefore(
      target.userId,
      target.conversationId,
      CODER.TITLE_TURNS,
      undefined,
    );
    if (ran.earlier) return Option.none();
    const exchange = yield* conversationExchange(target, tools, origin);
    if (exchange.length === 0) return Option.none();
    return yield* generateAgentTitle(model, exchange);
  });
}

/**
 * The agent's title filled, and its task named with it where the task still
 * stands untitled, in one transaction, so a rename that fails takes the
 * title back with it and the next words or turn's end ask again. Note that
 * a title the developer set meanwhile is theirs for the agent alone, so the
 * fill that finds one names no task.
 */
function titledWithTask(
  userId: string,
  agent: CodingAgent,
  title: string,
): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices> {
  const written = Effect.gen(function* () {
    const filled = yield* fillCodingAgentTitle(userId, agent.id, title);
    if (!filled || agent.taskId === null) return;
    yield* nameUntitledTask(userId, agent.taskId, title);
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(written));
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
): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices> {
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
 * none stands, as words are received in, or as one ends, one of its first
 * `CODER.TITLE_TURNS` turns: a title
 * already standing, the developer's own included, is never asked for
 * again, an agent past those turns is left on the model's name, and an
 * exchange with no words in it asks nothing. A call that answers nothing
 * writes nothing, so the next words or turn's end ask again. The title
 * written also names the agent's task where it still stands untitled.
 */
export function titleCodingAgent(
  model: LanguageModel,
  target: ConversationTarget,
  agent: CodingAgent,
): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.gen(function* () {
    if (agent.title !== null) return;
    const title = yield* titleOfConversation(model, target, CODER_TOOL_SET, agent.automationOrigin);
    if (Option.isNone(title)) return;
    yield* titledWithTask(target.userId, agent, title.value);
  });
}
