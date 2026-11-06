import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import { type Agent, fillAgentTitle } from "@repo/database/models/agent-store";
import {
  listMessagesPast,
  listRecentMessages,
  listTurnOpeners,
  turnsBefore,
} from "@repo/database/models/message-reads";
import { nameUntitledTask } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import type { StoredAutomationOrigin } from "@repo/database/schemas/agent";
import { firstMessageParts } from "@repo/features/agent-replay";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import { AUTOMATION_FIRING } from "@repo/features/automation-wire";
import { titlesNothing } from "@repo/features/task-wire";
import { failureKind } from "@repo/runtime/effect";
import { generateText, isTextUIPart, type LanguageModel, type ToolSet } from "ai";
import { Effect, Option, type Schema } from "effect";
import { SqlClient } from "effect/sql";
import { MESSAGE_CHANNEL, MESSAGE_ROLE, type StoredUIMessage } from "../../core.js";
import { CODER } from "./bounds.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import { CURSOR_START } from "./transcript.js";

const AGENT_TITLE = {
  MAX_OUTPUT_TOKENS: 64,
  TIMEOUT: CODER.TITLE_TIMEOUT,
  EFFORT: "low",
  THINKING: "disabled",
  FALLBACK_WORDS: 6,
  EXCERPT_CHARS: 2_000,
  RECENT_MESSAGES: 8,
} as const;

const INSTRUCTIONS =
  "Name the task below in three to six words, as a sentence-case title: a capital on the first word only, no quotes, and no punctuation at the end. Answer with the title and nothing else, or with nothing at all where no task is named yet, as in a greeting.";

const SURROUNDING_QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/gu;
const TRAILING_PUNCTUATION = /[.!?:;,]+$/u;

const MARKDOWN_LINK = /\[([^[\]]*)\]\((?:[^()]|\([^()]*\))*\)/gu;

const MARKDOWN_MARKS = /[#*`>]+/gu;

const LIST_MARKER = /^\s*(?:[-+]|\d+\.)\s+/u;

const SPEAKER = {
  DEVELOPER: "Developer",
  AGENT: "Agent",
} as const;

function tidyAgentTitle(answer: string): Option.Option<string> {
  const line = answer.trim().split("\n")[0] ?? "";
  const title = line
    .replaceAll(SURROUNDING_QUOTES, "")
    .replace(TRAILING_PUNCTUATION, "")
    .trim()
    .slice(0, AGENT_BOUNDS.MAX_TITLE_CHARS)
    .trim();
  if (title.length === 0 || titlesNothing(title)) {
    return Option.none();
  }
  return Option.some(title);
}

function firstWordsTitle(text: string): Option.Option<string> {
  const line =
    text
      .slice(0, AGENT_TITLE.EXCERPT_CHARS)
      .split("\n")
      .map((each) =>
        each
          .replace(LIST_MARKER, "")
          .replaceAll(MARKDOWN_LINK, "$1")
          .replaceAll(MARKDOWN_MARKS, " ")
          .trim(),
      )
      .find((each) => each.length > 0) ?? "";
  const words = line.split(/\s+/u).slice(0, AGENT_TITLE.FALLBACK_WORDS).join(" ");
  return Option.map(
    tidyAgentTitle(words),
    (title) => `${title.charAt(0).toUpperCase()}${title.slice(1)}`,
  );
}

function withoutReplay(text: string): string {
  const read = firstMessageParts(text);
  return read.note === undefined ? read.brief : `${read.brief}\n${read.note.text}`;
}

function excerptOf(message: StoredUIMessage | undefined): string {
  if (
    message?.role === MESSAGE_ROLE.USER &&
    "channel" in message.metadata &&
    message.metadata.channel === MESSAGE_CHANNEL.SLACK
  ) {
    return message.metadata.words.trim().slice(0, AGENT_TITLE.EXCERPT_CHARS);
  }
  const words = (message?.parts ?? [])
    .filter((part) => isTextUIPart(part))
    .map((part) => withoutReplay(part.text).trim())
    .filter((text) => text.length > 0)
    .join("\n");
  return words.slice(0, AGENT_TITLE.EXCERPT_CHARS);
}

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

function saidByDeveloper(message: StoredUIMessage | undefined): boolean {
  if (message?.role !== MESSAGE_ROLE.USER || "source" in message.metadata) return false;
  return message.metadata.channel !== MESSAGE_CHANNEL.AGENT_MESSAGE;
}

const HEARD = {
  UNKNOWN: "unknown",
  DEVELOPER: "developer",
  OTHER: "other",
} as const;

type Heard = (typeof HEARD)[keyof typeof HEARD];

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

interface ConversationNaming {
  readonly exchange: string;
  readonly opening: string;
}

const NOTHING_TO_NAME: ConversationNaming = { exchange: "", opening: "" };

function conversationExchange(
  target: ConversationTarget,
  tools: ToolSet,
  origin: StoredAutomationOrigin | null,
): Effect.Effect<ConversationNaming, QueryError | Schema.SchemaError, DatabaseServices> {
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
    if (origin === null && opened === undefined && said === undefined) return NOTHING_TO_NAME;
    const exchange = [
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
    const firstWords = origin === null ? excerptOf((opened ?? said)?.message) : origin.prompt;
    return { exchange, opening: firstWords };
  });
}

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
      providerOptions: {
        anthropic: { effort: AGENT_TITLE.EFFORT, thinking: { type: AGENT_TITLE.THINKING } },
      },
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

function titleOfConversation(
  model: LanguageModel | undefined,
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
    const naming = yield* conversationExchange(target, tools, origin);
    if (naming.exchange.length === 0) return Option.none();
    if (model === undefined) return firstWordsTitle(naming.opening);
    return yield* generateAgentTitle(model, naming.exchange);
  });
}

function titledWithTask(
  userId: string,
  agent: Agent,
  title: string,
): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices> {
  const written = Effect.gen(function* () {
    const filled = yield* fillAgentTitle(userId, agent.id, title);
    if (!filled || agent.taskId === null) return;
    yield* nameUntitledTask(userId, agent.taskId, title);
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(written));
}

export function titleInboxThread(
  model: LanguageModel,
  text: string,
): Effect.Effect<Option.Option<string>> {
  const words = text.trim().slice(0, AGENT_TITLE.EXCERPT_CHARS);
  return words === "" ? Effect.succeed(Option.none()) : generateAgentTitle(model, words);
}

export function titleAgent(
  model: LanguageModel | undefined,
  target: ConversationTarget,
  agent: Agent,
): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.gen(function* () {
    if (agent.title !== null) return;
    const title = yield* titleOfConversation(model, target, CODER_TOOL_SET, agent.automationOrigin);
    if (Option.isNone(title)) return;
    yield* titledWithTask(target.userId, agent, title.value);
  });
}
