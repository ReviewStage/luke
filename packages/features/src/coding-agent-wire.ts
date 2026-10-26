import { keepIdentity, MESSAGE_ROLE, TURN_ORIGIN, WireValueSchema } from "@luke/wire";
import { readEither, verbatimJsonSchema, wireKeys } from "@luke/wire/effect";
import { Schema as EffectSchema, Result, SchemaTransformation } from "effect";
import { integrationConnectionNameSchema, integrationConnectionOf } from "./integration-wire.js";
import { pinPositionSchema } from "./pin-order.js";
import {
  mergeMethodSchema,
  PULL_REQUEST_WRITE_BOUNDS,
  REACTION,
} from "./pull-request-write-wire.js";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { trimmedText } from "./text-schema.js";

/**
 * coding-agent-wire.ts -- a task's coding agents, as the desktop starts, lists, reads, messages, and stops them.
 *
 * A coding agent is one cloud session the service runs over a task: it
 * checks the task's repository out, implements the plan, and decides on a
 * pull request. Or, where the developer started it with words of their own,
 * it is handed those as its prompt in the plan's place, and never the plan.
 * The desktop starts one with a key of its own, so a retry of the same
 * Start is the same agent, and names the model and effort it runs on or
 * leaves both to the account's default. What comes back is the
 * agent's summary: its id, what it runs on, when it started, and where it
 * stands, which is the status of its newest turn. Its transcript is the
 * conversation's own `messages` rows, each an AI SDK `UIMessage`, read after
 * a cursor the service hands back with every page beside the agent's status
 * as the page was read, so a tab held open hears each message once as it
 * lands and again when it changes in place, and hears the agent end from
 * the page that ends the hold. A message to the agent steers the turn
 * under way, so the model sees it at its next step, or opens a turn when
 * the agent is idle; it shows in the transcript at once as the developer's
 * own row. Every send carries a key the client made, so a send repeated
 * after a lost answer finds the message it already sent and sends nothing
 * again. An agent's model, effort, and context window can be changed while
 * it stands: the change is read at its next step, and the answer is the
 * agent as it then stands. A context window is named only where it is the
 * standard one; a choice that names none runs on the model's whole window. An agent's title is generated once from its task as it starts,
 * and the developer may rename it; a rename is never overwritten, and an
 * empty one clears the title so the tab falls back to the model's name.
 * Each of its workers is given a title the same way, from the task it was
 * handed, which no one renames. An agent may be archived, which stops a
 * turn still running and leaves it out of the task's list unless the list
 * asks for archived agents, and brought back; its transcript and pull
 * request are kept. The MCP servers an agent is handed, one per integration
 * provider the account connected, can each be switched off for it, at its
 * Start or while it stands: the change is read as its next turn starts, so
 * a turn already running keeps what it was handed.
 *
 * Every request refuses a key it does not name; an answer ignores one a
 * newer service added. Declared directly with Effect's `Schema.Struct` and
 * exported under its own name.
 *
 * Note that `planId` keep the wire's legacy spelling of a task, because a
 * released desktop sends and reads them; they are renamed with the wire in a
 * follow-up, with no alias.
 */

export const CODING_AGENT_BOUNDS = {
  /** The most characters a Start's or a message's key may spell; a UUID is the usual. */
  MAX_KEY_CHARS: 128,
  /** The most characters a model id or an effort may spell on the way in; the catalog decides whether they name anything. */
  MAX_CHOICE_CHARS: 200,
  /** The most characters one message to an agent may spell, trimmed: room for a pasted failure and the words around it, well inside one model call. */
  MAX_MESSAGE_CHARS: 16_000,
  /**
   * The most characters a `start_agent` call's prompt may spell, trimmed, and its note apart:
   * room for an orchestrator's brief to a worker on a long plan, quoted whole. Both together,
   * with the headings around them, stay under a task's own bound (`TASK_BOUNDS.MAX_BODY_CHARS`),
   * which a start on the plan already hands an agent whole as its first message.
   */
  MAX_START_WORDS_CHARS: 64_000,
  /** The most characters eve's id for a tool call may spell, which is how a subagent's transcript is named on the path. */
  MAX_CALL_ID_CHARS: 128,
  /** The most characters of a spoken line's id, which the voice's ledger mints. */
  MAX_LINE_ID_CHARS: 128,
  /** The most characters an agent's title may spell, generated or renamed: a tab's width of words. */
  MAX_TITLE_CHARS: 80,
  /** The most characters the reason an agent was archived for may spell: a line of the archived agent's banner, never a report. */
  MAX_ARCHIVE_REASON_CHARS: 500,
  /** The most characters the words a workspace's agents are found by may spell. */
  MAX_SEARCH_CHARS: 200,
  /** The most MCP servers one agent's list may name, and the most characters one name may spell: room for every provider and then some, never a document. */
  MAX_SERVERS: 32,
  MAX_SERVER_CHARS: 64,
  /** The most messages one page of a transcript carries; a page with fewer holds everything past its cursor as the transcript stood when it was read. */
  MESSAGES_PAGE: 200,
  /**
   * The most characters a tool part's output, as JSON text, or a reasoning
   * part's words may spell on a transcript page a reader asked cut: past it
   * the page carries its first and last half alone, with the whole's size,
   * and the reader fetches the part whole when it opens it.
   */
  MAX_PART_CHARS: 4_096,
  /** The most items one to-do list may hold: a long run of work, never a log of every command. */
  MAX_TODOS: 40,
  /** The most characters one to-do may spell: a line of the list, not a paragraph. */
  MAX_TODO_CHARS: 300,
  /** The most files one message or Start may carry. */
  MAX_ATTACHMENTS: 10,
  /** The most characters an attached file's name may spell: its own name, never a path. */
  MAX_ATTACHMENT_NAME_CHARS: 255,
  /** The most bytes one image may hold as it travels; the desktop re-encodes a larger one smaller. */
  MAX_IMAGE_BYTES: 1_500_000,
  /** The most bytes one PDF may hold. */
  MAX_PDF_BYTES: 3_000_000,
  /** The most bytes one text file may hold: about 25,000 tokens of code, inlined whole for the model. */
  MAX_TEXT_BYTES: 100_000,
  /** The most bytes every file of one message holds together, which base64 grows by a third and which stays under a function's request body limit. */
  MAX_ATTACHMENTS_BYTES: 3_000_000,
} as const;

/**
 * The context windows a choice may run on: the long one, the model's whole
 * window, which every choice runs on unless it names the other, and the
 * standard one, which a model offers apart only where its provider prices
 * the tokens past it higher (`models-wire.ts`); a model with one window
 * has the one, whichever a choice names.
 */
export const CONTEXT_WINDOW = {
  STANDARD: "standard",
  LONG: "long",
} as const;

export type ContextWindow = (typeof CONTEXT_WINDOW)[keyof typeof CONTEXT_WINDOW];

/** A context window as a choice names it. */
export const contextWindowSchema = EffectSchema.Literals(Object.values(CONTEXT_WINDOW));

/**
 * Who a coding agent's commits are by and its pull request is opened as,
 * settled once for the agent as its first session starts: the developer who
 * started it, on their own GitHub account with the Luke GitHub App's bot as
 * co-author, or the App's bot alone, with why it is the bot.
 */
export const CODING_AGENT_AUTHOR = {
  /** The developer who started the agent, through the GitHub account they signed in with. */
  DEVELOPER: "developer",
  /** The App: the developer has no GitHub sign-in, or GitHub no longer honours it. */
  APP_UNLINKED: "app-unlinked",
  /** The App: the developer's own GitHub account may not push to the repository. */
  APP_NO_PUSH: "app-no-push",
  /** The App: an automation started the agent, so no developer's hand did. */
  APP_AUTOMATION: "app-automation",
  /** The App: GitHub could not be read as the agent started, so the developer's reach went unknown. */
  APP_UNREAD: "app-unread",
  /** The developer who started the agent, through their own GitHub personal access token, where no installation reaches the repository. */
  TOKEN: "token",
} as const;

export type CodingAgentAuthor = (typeof CODING_AGENT_AUTHOR)[keyof typeof CODING_AGENT_AUTHOR];

/**
 * Who pays for a coding agent's model calls, recorded as the agent starts
 * and never moved after: the starter's Claude plan or ChatGPT plan, which
 * run the provider's own harness, the starter's own API key, or Luke's key;
 * or, for a local agent, its Mac's own login to the harness. A plan that
 * runs out pauses the agent rather than falling through to another payer; a
 * Mac signed out since falls back to the account's saved credential.
 */
export const CODING_AGENT_PAYER = {
  // Note that the stored spelling says "plan", the subscription's own word, not a task's document.
  CLAUDE_SUBSCRIPTION: "claude_plan",
  CHATGPT_SUBSCRIPTION: "chatgpt_plan",
  API_KEY: "api_key",
  LUKE: "luke",
  /** A local agent's own Mac, by its harness's login there (`macSignedInSchema`), with the account's saved credential as the fallback. */
  MAC_SIGN_IN: "mac_sign_in",
} as const;

export type CodingAgentPayer = (typeof CODING_AGENT_PAYER)[keyof typeof CODING_AGENT_PAYER];

/**
 * What answers a coding agent's conversation, as its conversation's row
 * records it: eve, as every agent ran before the native harnesses, or the
 * provider's own harness, Claude Code or Codex, which Luke launches in the
 * agent's sandbox. The store's own vocabulary spells the same words
 * (`@luke/database/storage-vocabulary`'s `CONVERSATION_RUNTIME`).
 */
export const CODING_AGENT_RUNTIME = {
  EVE: "eve",
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;

export type CodingAgentRuntime = (typeof CODING_AGENT_RUNTIME)[keyof typeof CODING_AGENT_RUNTIME];

/** The runtimes that are a provider's own harness rather than eve, which an agent's summary names. */
export const NATIVE_CODING_AGENT_RUNTIMES = [
  CODING_AGENT_RUNTIME.CLAUDE_CODE,
  CODING_AGENT_RUNTIME.CODEX,
] as const;

export type NativeCodingAgentRuntime = (typeof NATIVE_CODING_AGENT_RUNTIMES)[number];

/**
 * What kind of agent a row is: a coder, which every agent started on work is,
 * or a member's operator, the one agent per member per workspace that
 * manages their other agents, started blank with no task and no repository.
 */
export const CODING_AGENT_KIND = {
  CODER: "coder",
  OPERATOR: "operator",
} as const;

export type CodingAgentKind = (typeof CODING_AGENT_KIND)[keyof typeof CODING_AGENT_KIND];

/**
 * Where an agent's runner and checkout live: a Vercel Sandbox, as every
 * agent from before the column does, or the starter's own Mac, which takes
 * its work as rows it follows (`@luke/features/mac-agent-wire`).
 */
export const CODING_AGENT_MACHINE = {
  VERCEL: "vercel",
  MAC: "mac",
} as const;

export type CodingAgentMachine = (typeof CODING_AGENT_MACHINE)[keyof typeof CODING_AGENT_MACHINE];

/** Why a Start on This Mac was refused, which the refusal names (`local-agent-refused`). */
export const LOCAL_AGENT_REFUSAL = {
  /** The account has the `local-agents` experiment off. */
  OFF: "off",
  /** No Mac of the account's beat lately, so none would take the agent. */
  MAC_AWAY: "mac-away",
  /** The model runs on Codex, which the Mac has none of checked yet: an app from before Codex on the Mac, or one whose download has not finished. */
  CODEX: "codex",
  /** The model runs on no native harness here, so no runner would launch on the Mac. */
  NO_HARNESS: "no-harness",
} as const;

export type LocalAgentRefusal = (typeof LOCAL_AGENT_REFUSAL)[keyof typeof LOCAL_AGENT_REFUSAL];

export const localAgentRefusalSchema = EffectSchema.Literals(Object.values(LOCAL_AGENT_REFUSAL));

export const MAC_PRESENCE = {
  /** How lately a Mac must have beaten to count as there: one beat, and room for the next to arrive. */
  FRESH_MS: 45_000,
} as const;

/** Whether a Mac that last beat at `seenAt` is there at `now`, both epoch milliseconds. */
export function macOnline(seenAt: number, now: number): boolean {
  return seenAt >= now - MAC_PRESENCE.FRESH_MS;
}

/**
 * The whole of what an operator answers a heartbeat that found nothing for
 * its member: a turn whose reply is exactly this, and nothing more, is a
 * quiet turn, which leaves its member no unseen dot and no notice, and whose
 * reply the panel does not draw. A reply that only mentions it is no quiet one.
 */
export const OPERATOR_QUIET_REPLY = "HEARTBEAT_OK";

/** The most characters of the time zone an operator's ensure names, an IANA zone's name. */
const OPERATOR_TIME_ZONE_MAX_CHARS = 64;

/** What an agent was handed as its first message: the task's document, a prompt the developer wrote in its place, or nothing, for an agent started blank, whose first words come later, typed or spoken. */
export const CODING_AGENT_BRIEF = {
  PLAN: "plan",
  // Note that the value says "task", because a released desktop decodes it.
  PROMPT: "task",
  BLANK: "blank",
} as const;

export type CodingAgentBrief = (typeof CODING_AGENT_BRIEF)[keyof typeof CODING_AGENT_BRIEF];

/** Where an agent stands, read from its newest turn: not yet started, at work, or how it ended. */
export const CODING_AGENT_STATUS = {
  /** The agent exists and its session has not run a turn yet. */
  STARTING: "starting",
  /** A turn is under way, or a message of the developer's awaits the turn it will open. */
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  /** The developer stopped it, or a Stop is on its way to it; anything it pushed stays. */
  CANCELLED: "cancelled",
} as const;

export type CodingAgentStatus = (typeof CODING_AGENT_STATUS)[keyof typeof CODING_AGENT_STATUS];

/**
 * Why a turn ended failed, as one fixed word: the service maps the turn's
 * own record to these, so nothing a provider or the runtime said travels
 * to the window.
 */
export const CODING_AGENT_FAILURE = {
  /** The model call failed. */
  MODEL: "model",
  /** The sandbox or the checkout failed. */
  SANDBOX: "sandbox",
  /** GitHub refused the agent's repository or could not be reached. */
  GITHUB: "github",
  /** The turn ran past its bound and the sweep settled it. */
  ABANDONED: "abandoned",
  /** The account's own API key for the model's provider was refused, out of quota, or can no longer be read; it is replaced in Settings. */
  PROVIDER_KEY: "provider_key",
  /** The agent's session never started, so no turn ran; a new agent is the way on. */
  NOT_STARTED: "not_started",
  /** The agent ran a fast version on the account's own key while Luke ran Fast on its own key alone; no agent fails this way now, and one that did still reads as this. */
  FAST_ON_OWN_KEY: "fast_own_key",
  /** The provider refused fast mode for the organization of the key the step ran on. */
  FAST_NOT_ENABLED: "fast_not_enabled",
  /** The provider refused the step's prompt as longer than the model's context window. */
  CONTEXT_OVERFLOW: "context_overflow",
  /** The agent's session ended for good while its turn ran, and eve no longer runs it: nothing reaches it again, and only a new agent, a continue of it among them, goes on. */
  SESSION_ENDED: "session_ended",
  OTHER: "other",
} as const;

export type CodingAgentFailure = (typeof CODING_AGENT_FAILURE)[keyof typeof CODING_AGENT_FAILURE];

/**
 * The files a message may carry, by the media type each travels as: an
 * image or a PDF, which the model reads as a file, or a text file of any
 * extension, which travels as its UTF-8 bytes and is inlined for the model
 * as fenced text under its name.
 */
export const CODING_AGENT_ATTACHMENT_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
  PDF: "application/pdf",
  TEXT: "text/plain",
} as const;

export type CodingAgentAttachmentType =
  (typeof CODING_AGENT_ATTACHMENT_TYPE)[keyof typeof CODING_AGENT_ATTACHMENT_TYPE];

/** The most bytes one file of each type may hold. */
const CODING_AGENT_ATTACHMENT_BYTES = {
  [CODING_AGENT_ATTACHMENT_TYPE.PNG]: CODING_AGENT_BOUNDS.MAX_IMAGE_BYTES,
  [CODING_AGENT_ATTACHMENT_TYPE.JPEG]: CODING_AGENT_BOUNDS.MAX_IMAGE_BYTES,
  [CODING_AGENT_ATTACHMENT_TYPE.WEBP]: CODING_AGENT_BOUNDS.MAX_IMAGE_BYTES,
  [CODING_AGENT_ATTACHMENT_TYPE.PDF]: CODING_AGENT_BOUNDS.MAX_PDF_BYTES,
  [CODING_AGENT_ATTACHMENT_TYPE.TEXT]: CODING_AGENT_BOUNDS.MAX_TEXT_BYTES,
} as const satisfies Record<CodingAgentAttachmentType, number>;

/** The characters base64 spells a count of bytes in, padded, as an attachment's data carries them. */
export function base64Chars(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
}

/** The files one message or Start may carry: their base64 together, and each one's name at JSON's widest escape with room for the keys around it. */
export const MAXIMUM_ATTACHMENTS_BODY_BYTES =
  base64Chars(CODING_AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES) +
  CODING_AGENT_BOUNDS.MAX_ATTACHMENTS * (6 * CODING_AGENT_BOUNDS.MAX_ATTACHMENT_NAME_CHARS + 128);

/** A Start names a key, a choice, and a prompt with its files at most: the prompt's bound at JSON's widest escape, the files, and room for the rest. */
export const MAXIMUM_START_BODY_BYTES =
  6 * CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 4_096;

/** The bytes standard padded base64 spells, as an attachment's data carries them. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length / 4) * 3 - padding;
}

/** A file's name on one line, which is how the model reads it, under its heading. */
const ONE_LINE_PATTERN = /^[^\r\n]*$/u;

/** Standard base64, padded, with no data-URL prefix and no line breaks. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;

/** Whether base64 spells UTF-8 text, as a text file must to be inlined for the model. */
function spellsUtf8(base64: string): boolean {
  try {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Whether a file is within its type's bound and, where it is text, spells UTF-8. */
function attachmentIsReadable(attachment: {
  readonly mediaType: CodingAgentAttachmentType;
  readonly data: string;
}): boolean {
  if (attachment.data.length > base64Chars(CODING_AGENT_ATTACHMENT_BYTES[attachment.mediaType])) {
    return false;
  }
  return attachment.mediaType !== CODING_AGENT_ATTACHMENT_TYPE.TEXT || spellsUtf8(attachment.data);
}

/**
 * One file a message carries: its own name on one line, never a path; the type it
 * travels as; and its bytes in base64, bounded by its type, a text file's
 * spelling UTF-8. Nothing beside it says where on the developer's machine
 * it came from.
 */
const codingAgentAttachmentSchema = EffectSchema.Struct({
  name: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_ATTACHMENT_NAME_CHARS),
    EffectSchema.isPattern(ONE_LINE_PATTERN),
  ),
  mediaType: EffectSchema.Literals(Object.values(CODING_AGENT_ATTACHMENT_TYPE)),
  data: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isPattern(BASE64_PATTERN),
  ),
}).check(EffectSchema.makeFilter(attachmentIsReadable));

export type CodingAgentAttachment = typeof codingAgentAttachmentSchema.Type;

/** The files of one message: bounded in count, and in the bytes they hold together, each file padded apart. */
const codingAgentAttachmentsSchema = EffectSchema.Array(codingAgentAttachmentSchema).check(
  EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_ATTACHMENTS),
  EffectSchema.makeFilter(
    (attachments) =>
      attachments.reduce((sum, attachment) => sum + base64Bytes(attachment.data), 0) <=
      CODING_AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES,
  ),
);

/** A message's words, trimmed and bounded, and empty where the files carry the message alone. */
const messageWordsSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS),
);

/** Whether a message carries anything: words, files, or both, never neither. The words are trimmed already. */
export function hasWordsOrFiles(
  words: string,
  attachments: readonly CodingAgentAttachment[] | undefined,
): boolean {
  return words !== "" || (attachments ?? []).length > 0;
}

/**
 * The MCP servers switched off for an agent, by connection name: one
 * account at an integration (`notion`, `notion-2`), the first account's
 * name being its provider's, so a list stored before a second account was
 * possible keeps its meaning. A name of a provider this build does not know
 * is left out rather than refused, so a service that offers one more
 * provider than a desktop knows still answers that desktop its agents, and
 * a provider retired from the list reads as nothing switched off.
 */
export const disabledServersSchema = EffectSchema.Array(
  EffectSchema.String.check(EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_SERVER_CHARS)),
).pipe(
  EffectSchema.check(EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_SERVERS)),
  EffectSchema.decodeTo(
    EffectSchema.Array(integrationConnectionNameSchema),
    SchemaTransformation.transform({
      decode: (named): readonly string[] =>
        named.filter((name) => integrationConnectionOf(name) !== undefined),
      encode: (servers): readonly string[] => servers,
    }),
  ),
);

/**
 * The agent a Start takes over from, on the same plan: everything it did
 * where no message is named, which is a continue, or its transcript up to
 * and including one of its own assistant messages, by that message's id as
 * its transcript carries it, which is a fork. A fork of a reply still being
 * written names where the developer saw it end as they pressed Fork: how
 * many of that message's steps had begun, and how many words and calls the
 * last of them held, so the cut keeps those and nothing the agent wrote
 * after; a fork naming none keeps the message whole, as a desktop before
 * the count asked.
 */
const codingAgentStartFromSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  messageId: EffectSchema.optionalKey(wireUuidSchema),
  messageSteps: EffectSchema.optionalKey(
    EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  ),
  messageStepParts: EffectSchema.optionalKey(
    EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  ),
}).check(
  EffectSchema.makeFilter(
    ({ messageId, messageSteps, messageStepParts }) =>
      (messageSteps === undefined || messageId !== undefined) &&
      (messageStepParts === undefined || messageSteps !== undefined),
  ),
);

export type CodingAgentStartFrom = typeof codingAgentStartFromSchema.Type;

/**
 * Starting an agent (POST): the request's own key, which a retry carries
 * again, and the model and effort to run on where the developer chose
 * them; both or neither, since a choice is one thing, and the context
 * window beside them where it is the standard one. A prompt, where the
 * developer wrote one, is the agent's first message in the plan's place,
 * bounded as a message is: its words, the files the developer attached to
 * it, or both. With none, the agent is handed the plan, and files go only
 * with a prompt. The MCP servers its draft switched off go with it, and none
 * is off where the Start names none. A Start `from` another agent of the
 * plan is handed that agent's brief and its transcript replayed after it,
 * so it names no prompt of its own, and it runs on that agent's choice and
 * servers where it names none. A note, bounded as a message is, goes only
 * beside such a source, written after the replay as the developer's, and
 * files go with it there as they go with a prompt. A Start `blank` hands the
 * agent nothing at all, neither the plan nor a prompt, so it names no
 * prompt, files, source, or note; its first words come later, typed or
 * spoken, and it may start on a task with no repository, where it works in
 * none. A Start `call` is one a Call opens a call into as it lands, from a
 * draft's composer: it runs where the account's routing chooses, as any
 * Start does, eve or the provider's own harness alike.
 */
export const codingAgentStartRequestFields = {
  idempotencyKey: trimmedText(CODING_AGENT_BOUNDS.MAX_KEY_CHARS),
  model: EffectSchema.optionalKey(trimmedText(CODING_AGENT_BOUNDS.MAX_CHOICE_CHARS)),
  effort: EffectSchema.optionalKey(trimmedText(CODING_AGENT_BOUNDS.MAX_CHOICE_CHARS)),
  contextWindow: EffectSchema.optionalKey(contextWindowSchema),
  prompt: EffectSchema.optionalKey(messageWordsSchema),
  attachments: EffectSchema.optionalKey(codingAgentAttachmentsSchema),
  disabledServers: EffectSchema.optionalKey(disabledServersSchema),
  from: EffectSchema.optionalKey(codingAgentStartFromSchema),
  note: EffectSchema.optionalKey(messageWordsSchema),
  blank: EffectSchema.optionalKey(EffectSchema.Boolean),
  call: EffectSchema.optionalKey(EffectSchema.Boolean),
  /** Where the agent runs: one of the starter's Macs, the one `deviceId` names; a sandbox where absent. */
  machine: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(CODING_AGENT_MACHINE))),
  /** The Mac a Start on a Mac runs on, one Start offered (`@luke/features/models-wire`'s `macOfferSchema`), which the service checks is the starter's and there before it pins the agent to it. */
  deviceId: EffectSchema.optionalKey(wireUuidSchema),
};

/** Whether `words` carry the files, as a prompt or a note does: no files without them, and words, files, or both with them. */
function carriesFiles(
  words: string | undefined,
  attachments: readonly CodingAgentAttachment[] | undefined,
): boolean {
  return words === undefined ? attachments === undefined : hasWordsOrFiles(words, attachments);
}

/** A Start's words or files: a prompt and its files afresh, never a note; from another agent, whose brief it is handed, no prompt, and a note and its files; blank, none of them. */
export const startBrief = EffectSchema.makeFilter(
  ({
    prompt,
    attachments,
    from,
    note,
    blank,
  }: {
    readonly prompt?: string;
    readonly attachments?: readonly CodingAgentAttachment[];
    readonly from?: CodingAgentStartFrom;
    readonly note?: string;
    readonly blank?: boolean;
  }) => {
    if (blank === true) {
      return [prompt, attachments, from, note].every((each) => each === undefined);
    }
    return from === undefined
      ? note === undefined && carriesFiles(prompt, attachments)
      : prompt === undefined && carriesFiles(note, attachments);
  },
);

/** The Start request as a caller holds it, before it is put on the wire. */
const codingAgentStartRequestValueSchema = EffectSchema.Struct(codingAgentStartRequestFields).check(
  startBrief,
);

/** The Start request on the wire, where the prompt travels as `task`, because a released desktop sends that key. */
export const codingAgentStartRequestSchema = EffectSchema.Struct(codingAgentStartRequestFields)
  .pipe(wireKeys({ prompt: "task" }))
  .check(startBrief);

export type CodingAgentStartRequest = typeof codingAgentStartRequestSchema.Type;

/** A Start request as it travels: read as a caller holds it, so it is trimmed and held to its bounds, then keyed as the wire spells it; a refusal where the service would refuse it by shape. */
export const codingAgentStartRequestOnWire = (request: CodingAgentStartRequest) =>
  Result.flatMap(
    readEither(codingAgentStartRequestValueSchema)(request),
    EffectSchema.encodeUnknownResult(codingAgentStartRequestSchema),
  );

/**
 * Messaging an agent (POST): the developer's words, trimmed and bounded,
 * the files they attached, words or files or both but never neither, and
 * the client's own key for
 * this one send, which a retry carries again
 * so the service answers what the first send did rather than sending the
 * words a second time. The message steers the turn under way, so the model
 * sees it at its next step and a call still generating is cut short and
 * run again with it, or opens a turn where none runs. The answer is the
 * agent's summary with its status read after the message was taken, which
 * is running.
 */
export const codingAgentMessageRequestSchema = EffectSchema.Struct({
  text: messageWordsSchema,
  clientKey: trimmedText(CODING_AGENT_BOUNDS.MAX_KEY_CHARS),
  attachments: EffectSchema.optionalKey(codingAgentAttachmentsSchema),
}).check(EffectSchema.makeFilter(({ text, attachments }) => hasWordsOrFiles(text, attachments)));

export type CodingAgentMessageRequest = typeof codingAgentMessageRequestSchema.Type;

/**
 * Rewinding an agent (POST): the developer's line it goes back to just
 * before, by its message id, dropping that line and everything after it.
 * Whatever the agent is doing stops first. Only the conversation goes back,
 * never the agent's checkout. The answer is the agent's summary as it then
 * stands.
 */
export const codingAgentRewindRequestSchema = EffectSchema.Struct({
  messageId: trimmedText(CODING_AGENT_BOUNDS.MAX_KEY_CHARS),
});

/**
 * Renaming an agent (PATCH): the title as the tab should show it, trimmed
 * and bounded; empty clears it, so the tab falls back to the model's name.
 */
export const codingAgentRenameRequestSchema = EffectSchema.Struct({
  title: EffectSchema.Trim.check(EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_TITLE_CHARS)),
});

export type CodingAgentRenameRequest = typeof codingAgentRenameRequestSchema.Type;

/**
 * Archiving an agent, or bringing it back (PATCH). Archiving one with a
 * turn running stops that turn first, as a Stop would, and the answer is
 * the agent as it then stands. One still starting, or with a message
 * awaiting its turn, has no turn to stop yet and is refused as not ready,
 * to be tried again. An archived agent takes no message.
 */
export const codingAgentArchiveRequestSchema = EffectSchema.Struct({
  archived: EffectSchema.Boolean,
});

export type CodingAgentArchiveRequest = typeof codingAgentArchiveRequestSchema.Type;

/**
 * Pinning an agent in the sidebar, or unpinning it (PATCH). The pin is the
 * asking member's own and no one else's, as a plan's is; pinning one
 * already pinned keeps the instant it was first pinned. A position, where
 * the pin stands in the sidebar's Pinned section (`pin-order.ts`), comes
 * only with a pin. The answer is the agent as it then stands.
 */
export const codingAgentPinRequestSchema = EffectSchema.Struct({
  pinned: EffectSchema.Boolean,
  position: EffectSchema.optionalKey(pinPositionSchema),
}).check(
  EffectSchema.makeFilter(
    (request: { pinned: boolean; position?: string }) =>
      request.position === undefined || request.pinned,
  ),
);

export type CodingAgentPinRequest = typeof codingAgentPinRequestSchema.Type;

/**
 * Switching the agent's MCP servers (PATCH): the whole list of those off,
 * which replaces the list standing, so two quick changes land as the later
 * one. Empty switches every server back on.
 */
export const codingAgentServersRequestSchema = EffectSchema.Struct({
  disabledServers: disabledServersSchema,
});

export type CodingAgentServersRequest = typeof codingAgentServersRequestSchema.Type;

/**
 * The task's agent list's query (GET): `archived=include` lists the
 * archived agents among the rest, each carrying its `archivedAt`. Without
 * it they are left out, which is what a build from before archiving asks.
 */
export const CODING_AGENT_LIST_QUERY = {
  ARCHIVED: "archived",
} as const;

/** The query a workspace's agents are listed by: the workspace, the repository they are narrowed to, where one is named, words their shown name (`agentName`) or task's name holds, where some are given, and `archived=include` for the archived ones among the rest, as a plan's list takes it. */
export const CODING_AGENT_WORKSPACE_QUERY = {
  WORKSPACE_ID: "workspaceId",
  REPOSITORY: "repository",
  WORDS: "words",
  ARCHIVED: CODING_AGENT_LIST_QUERY.ARCHIVED,
} as const;

/** What the list's `archived` query may say. */
export const CODING_AGENT_LIST_ARCHIVED = {
  INCLUDE: "include",
} as const;

/**
 * Who archived an agent: a member from the window, Luke on a call for the
 * member on it, or another coding agent of the workspace for the member who
 * started that agent, through its `archive_agent` tool.
 */
export const CODING_AGENT_ARCHIVER = {
  MEMBER: "member",
  LUKE: "luke",
  AGENT: "agent",
} as const;

export type CodingAgentArchiver =
  (typeof CODING_AGENT_ARCHIVER)[keyof typeof CODING_AGENT_ARCHIVER];

/**
 * Who archived an agent, as its banner and card say it: a member, or Luke or
 * another agent on a member's behalf, the member absent once their account
 * is gone, the agent by its id and its title as it stood then, and the
 * reason it was archived for where one was given. `withTask` marks an agent
 * a member archived by archiving its task, which brings it back with the
 * task; a build from before it reads the archive as the member's own.
 */
const codingAgentArchivedBySchema = EffectSchema.Struct({
  by: EffectSchema.Literals(Object.values(CODING_AGENT_ARCHIVER)),
  member: EffectSchema.optionalKey(memberRefSchema),
  agent: EffectSchema.optionalKey(
    EffectSchema.Struct({ id: wireUuidSchema, name: EffectSchema.String }),
  ),
  reason: EffectSchema.optionalKey(EffectSchema.String),
  withTask: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type CodingAgentArchivedBy = typeof codingAgentArchivedBySchema.Type;

/**
 * One agent as the tabs draw it: the task it works on, its title, what it
 * runs on, when it started, where it stands, which turn that is, and when
 * that run began. The task is null for an agent an automation started with
 * no task, which only a read naming that agent answers: a task's list holds
 * the task's own, so a build that predates agents with no task never meets
 * one.
 */
export const codingAgentSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  planId: EffectSchema.NullOr(wireUuidSchema),
  /** AI Gateway's catalog id, such as `anthropic/claude-opus-5.5`. */
  model: EffectSchema.String,
  effort: EffectSchema.String,
  /** The context window the agent runs on where it is the standard one; absent for the model's whole window. */
  contextWindow: EffectSchema.optionalKey(contextWindowSchema),
  /**
   * The provider's own harness the agent runs on, which narrows the models
   * its chip offers (`agent-runtime-models.ts`); absent for an agent on eve,
   * and from a service older than it.
   */
  runtime: EffectSchema.optionalKey(EffectSchema.Literals(NATIVE_CODING_AGENT_RUNTIMES)),
  /** The agent's title as its tab shows it; null until one is generated, and after a rename cleared it, when the tab shows the model's name. */
  title: EffectSchema.NullOr(EffectSchema.String),
  /** What kind of agent it is, said only of a member's operator, which the panel draws as Luke in a row of his own; absent for a coder, and from a service before operators. */
  kind: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(CODING_AGENT_KIND))),
  /** Where its runner runs, said only of a local agent on its starter's Mac; absent for one in a sandbox, and from a service older than it. */
  machine: EffectSchema.optionalKey(EffectSchema.Literal(CODING_AGENT_MACHINE.MAC)),
  /**
   * The Mac a local agent runs on, by its own name, and the epoch
   * milliseconds it last beat, which a reader holds against its own clock
   * (`macOnline`), so a Mac that goes quiet while the agent stands on screen
   * reads offline without another read; absent for an agent in a sandbox,
   * for one whose Mac is gone, from a read that does not name it, and from a
   * service older than it.
   */
  mac: EffectSchema.optionalKey(
    EffectSchema.Struct({ name: EffectSchema.String, seenAt: countedNumber }),
  ),
  /** Epoch milliseconds the agent was started. */
  createdAt: countedNumber,
  status: EffectSchema.Literals(Object.values(CODING_AGENT_STATUS)),
  /**
   * True where the agent is a member's operator whose newest turn's reply is
   * its quiet reply alone (`OPERATOR_QUIET_REPLY`): a heartbeat that found
   * nothing, whose end leaves no unseen dot and no notice. Absent for every
   * other turn, from the held reads, which do not read it, and from a service
   * before heartbeats.
   */
  quietTurn: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  /**
   * The newest turn the status is read from, by the service's own id for
   * it; nothing before the first turn. A message that opens a new turn moves
   * it once eve starts that turn, so a reader keying an agent's run by
   * (agent, turn) sees the run after a message as its own; while the
   * message still awaits its turn the id is the ended turn's and the status
   * is running on the message's account.
   */
  turnId: EffectSchema.NullOr(wireUuidSchema),
  /**
   * Epoch milliseconds the run the status is read from began, which is what
   * a tab counts how long the agent has been working from: the newest
   * turn's start, or its queueing where eve has not started it, and the
   * agent's own start before its first turn. Absent while a message awaits
   * its turn, whose run has not begun, and from a service older than it.
   */
  runStartedAt: EffectSchema.optionalKey(countedNumber),
  /**
   * What the agent was handed as its first message, so its tab draws a
   * plan as the plan's card, a task as the developer's own message, and,
   * for an agent started blank, its first line as any other line. Absent
   * from a service older than the task, which handed every agent the plan.
   */
  brief: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(CODING_AGENT_BRIEF))),
  /** Epoch milliseconds the agent was archived; absent while it is not, and from a service before archiving. */
  archivedAt: EffectSchema.optionalKey(countedNumber),
  /** Who archived the agent, and why where they said; absent while it is not archived, for an archive from before the record, and from a service before it. */
  archivedBy: EffectSchema.optionalKey(codingAgentArchivedBySchema),
  /** The MCP servers switched off for the agent; absent where none is, and from a service before the switch. */
  disabledServers: EffectSchema.optionalKey(disabledServersSchema),
  /**
   * The member who started the agent, whose provider key pays for it and
   * whose Mac its commands run on, whichever member messages it; absent once
   * their account is gone, and from a service before it.
   */
  startedBy: EffectSchema.optionalKey(memberRefSchema),
  /** The automation whose run started the agent; absent for one started by hand, once that automation is deleted, and from a service before it. */
  automationId: EffectSchema.optionalKey(wireUuidSchema),
  /**
   * The name of the automation whose run started the agent, as it stood when
   * the run started, kept once that automation is deleted; absent for one
   * started by hand, and from a service before it.
   */
  automationName: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * The agent this one was started from, on the same plan, and the message
   * of its it was forked at where it was forked rather than continued, and
   * how many of that message's steps it kept, and of the last of them how
   * many words and calls, where it was forked while that message was still
   * written, with
   * how many of that agent's steps its replay kept of how many there were,
   * and the branch that agent's work was copied to for this one where it
   * could be; absent for an agent started afresh, and from a service before it.
   */
  from: EffectSchema.optionalKey(
    EffectSchema.Struct({
      agentId: wireUuidSchema,
      messageId: EffectSchema.optionalKey(wireUuidSchema),
      messageSteps: EffectSchema.optionalKey(countedNumber),
      messageStepParts: EffectSchema.optionalKey(countedNumber),
      steps: countedNumber,
      totalSteps: countedNumber,
      branch: EffectSchema.optionalKey(EffectSchema.String),
    }),
  ),
  /**
   * The agents started from this one, oldest first, archived ones among
   * them: each by its id and its title, null where it has none yet, whether
   * it forked this one at a message rather than continuing it, and that
   * message where it did; absent where none was, and from a service before
   * it.
   */
  continuedBy: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.Struct({
        agentId: wireUuidSchema,
        title: EffectSchema.NullOr(EffectSchema.String),
        forked: EffectSchema.Boolean,
        messageId: EffectSchema.optionalKey(wireUuidSchema),
      }),
    ),
  ),
});

export type CodingAgentSummary = typeof codingAgentSummarySchema.Type;

/** A started, stopped, or changed agent (POST, PATCH). */
/**
 * The id of the transaction a write on the agent committed in, as Postgres
 * counts it, in decimal: present where a Start, a rename, an archive, or a
 * pin changed a row, so the desktop following the task list waits for it to
 * arrive before it confirms the write, as Neon's mutations guide says.
 */
const codingAgentTxidSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9]+$/u));

export const codingAgentAnswerSchema = EffectSchema.Struct({
  agent: codingAgentSummarySchema,
  txid: EffectSchema.optionalKey(codingAgentTxidSchema),
});

/**
 * A message handed to an agent, as the service answers it: the agent as it
 * then stands, and the transaction that wrote the message's row, where this
 * send wrote one, which the host waits to see on the transcript's live
 * subscription before it confirms the send. Absent from a send that wrote
 * nothing, and from a service older than it.
 */
export const codingAgentMessageAnswerSchema = EffectSchema.Struct({
  agent: codingAgentSummarySchema,
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

/**
 * The asking member's operator in a workspace ensured (PUT
 * `/api/workspaces/{id}/operator`): the one standing, or a fresh one made
 * blank where none stands, or, with `reset`, the standing one archived, its
 * transcript kept, and a fresh one made in its place; or, with `restore`,
 * the member's own operator a Reset archived, by its id, brought back in
 * place of the one standing, which is archived, as Reset's Undo asks.
 * `timeZone` is the
 * IANA zone the client runs in, which the heartbeat an ensure that makes the
 * operator aims at it is read in; UTC where it is absent or does not read.
 */
export const operatorEnsureRequestSchema = EffectSchema.Struct({
  reset: EffectSchema.optionalKey(EffectSchema.Boolean),
  restore: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  timeZone: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(OPERATOR_TIME_ZONE_MAX_CHARS)),
  ),
});

export type OperatorEnsureRequest = typeof operatorEnsureRequestSchema.Type;

/** The operator an ensure answers, by its id, and the transaction its row went in where this ensure made it. */
export const operatorEnsureAnswerSchema = EffectSchema.Struct({
  agentId: EffectSchema.String,
  txid: EffectSchema.optionalKey(codingAgentTxidSchema),
});

/** An agent deleted for good (DELETE), as a task's delete answers: with the transaction its row went in, which the host waits to see on the followed list. */
export const codingAgentDeleteAnswerSchema = EffectSchema.Struct({
  deleted: EffectSchema.Literal(true),
  txid: EffectSchema.optionalKey(codingAgentTxidSchema),
});

/**
 * The run of an automation that started an agent, as its page opens on it:
 * the automation's prompt alone, without the lines Luke adds of the firing,
 * then what fired it, each where the firing has one: the issue or pull
 * request a GitHub event names, a webhook call's body as its caller sent
 * it, cut as the agent was handed it, and the member who asked for a run
 * now, absent once their account is gone.
 */
const codingAgentOriginSchema = EffectSchema.Struct({
  prompt: EffectSchema.String,
  subject: EffectSchema.optionalKey(
    EffectSchema.Struct({
      number: countedNumber,
      title: EffectSchema.optionalKey(EffectSchema.String),
      url: EffectSchema.optionalKey(EffectSchema.String),
    }),
  ),
  body: EffectSchema.optionalKey(EffectSchema.String),
  runBy: EffectSchema.optionalKey(memberRefSchema),
});

export type CodingAgentOrigin = typeof codingAgentOriginSchema.Type;

/**
 * One agent as its own page reads it, which is how an agent an automation
 * started with no task is read, having no task's tab to stand in: the
 * summary the tabs draw, the automation whose run started it or none, the
 * run that did where one did, the workspace it belongs to, and the
 * repository it works in, null for one with none. An agent on a plan reads
 * so too, by the same id.
 */
const codingAgentPageSchema = EffectSchema.Struct({
  ...codingAgentSummarySchema.fields,
  automationId: EffectSchema.NullOr(wireUuidSchema),
  /** The run that started the agent; absent for one started by hand, and from a service before it. */
  origin: EffectSchema.optionalKey(codingAgentOriginSchema),
  workspaceId: EffectSchema.String,
  repository: EffectSchema.NullOr(EffectSchema.String),
});

export type CodingAgentPage = typeof codingAgentPageSchema.Type;

/** One agent read by its id (GET), on a task or with none. */
export const codingAgentPageAnswerSchema = EffectSchema.Struct({ agent: codingAgentPageSchema });

/** The task's agents (GET), in the order they were started. */
export const codingAgentListAnswerSchema = EffectSchema.Struct({
  agents: EffectSchema.Array(codingAgentSummarySchema),
});

/** Where a pull request stands on GitHub, as its pill is coloured. */
export const PULL_REQUEST_STATE = {
  OPEN: "open",
  DRAFT: "draft",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export type PullRequestState = (typeof PULL_REQUEST_STATE)[keyof typeof PULL_REQUEST_STATE];

/** The checks on a pull request's head, read as one word: still running, every one passed, one failed, or none run at all. */
export const CHECK_SUMMARY = {
  PENDING: "pending",
  PASSING: "passing",
  FAILING: "failing",
  NONE: "none",
} as const;

export type CheckSummary = (typeof CHECK_SUMMARY)[keyof typeof CHECK_SUMMARY];

/** The pull request an agent opened, as GitHub holds it now: what its pill and its summary row say. */
export const codingAgentPullRequestSchema = EffectSchema.Struct({
  number: countedNumber,
  title: EffectSchema.String,
  /** The pull request's own page on GitHub. */
  url: EffectSchema.String,
  state: EffectSchema.Literals(Object.values(PULL_REQUEST_STATE)),
  checks: EffectSchema.Literals(Object.values(CHECK_SUMMARY)),
  additions: countedNumber,
  deletions: countedNumber,
  changedFiles: countedNumber,
  /** True where the pull request is open and GitHub holds it in its base's merge queue; absent otherwise, and from a service before it was sent. */
  queued: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type CodingAgentPullRequest = typeof codingAgentPullRequestSchema.Type;

/**
 * What an agent published (GET): the repository it works in as `owner/name`,
 * null for one with none, which publishes nothing; the branch it pushed,
 * where GitHub holds one; and the pull request from it, where one is open or
 * was; null for each it has not. A pull request's branch is its head.
 */
export const codingAgentPullRequestAnswerSchema = EffectSchema.Struct({
  repository: EffectSchema.NullOr(EffectSchema.String),
  branch: EffectSchema.NullOr(EffectSchema.String),
  pullRequest: EffectSchema.NullOr(codingAgentPullRequestSchema),
});

export type CodingAgentPullRequestAnswer = typeof codingAgentPullRequestAnswerSchema.Type;

/**
 * One agent with no plan as the plan list carries it beside the plans, so
 * the sidebar lists it among them: the agent as the tabs draw it, its
 * automation's name among them, the automation, workspace, and repository
 * its own page names, and when it last moved, which orders it among the
 * plans by their last update, when the reader pinned it, where they did,
 * and the pull request it opened, where it opened one.
 * The run that started it is its page's alone, so a list of many carries no
 * prompt.
 */
export const tasklessAgentSchema = EffectSchema.Struct({
  ...codingAgentSummarySchema.fields,
  automationId: codingAgentPageSchema.fields.automationId,
  workspaceId: codingAgentPageSchema.fields.workspaceId,
  repository: codingAgentPageSchema.fields.repository,
  /** Epoch milliseconds the agent last moved: its start, its newest run's start, or that run's end, whichever is latest. */
  activityAt: countedNumber,
  /** Epoch milliseconds the reader pinned the agent, a pin being each member's own; absent while they have not, and from a service before agents were pinned. */
  pinnedAt: EffectSchema.optionalKey(countedNumber),
  /** Where the reader's pin stands in the sidebar's Pinned section once they dragged it (`pin-order.ts`); absent while it stands by `pinnedAt`. */
  pinPosition: EffectSchema.optionalKey(EffectSchema.String),
  /** The pull request it opened, as GitHub last answered the service, which its row's card shows as a task's row's card shows its own; absent while it opened none, and from a service before it was sent. */
  pullRequest: EffectSchema.optionalKey(
    EffectSchema.Struct({
      number: codingAgentPullRequestSchema.fields.number,
      title: codingAgentPullRequestSchema.fields.title,
      url: codingAgentPullRequestSchema.fields.url,
      state: codingAgentPullRequestSchema.fields.state,
      checks: codingAgentPullRequestSchema.fields.checks,
      queued: codingAgentPullRequestSchema.fields.queued,
    }),
  ),
});

export type TasklessAgent = typeof tasklessAgentSchema.Type;

/** What became of one file: made, changed in place, removed, or moved, with or without changes. */
export const CHANGED_FILE_STATUS = {
  ADDED: "added",
  MODIFIED: "modified",
  DELETED: "deleted",
  RENAMED: "renamed",
} as const;

export type ChangedFileStatus = (typeof CHANGED_FILE_STATUS)[keyof typeof CHANGED_FILE_STATUS];

/**
 * Why a changed file carries no patch: its contents are not text, or its
 * patch runs past what a read carries, which GitHub leaves out of its own
 * answer too. A file with neither is drawn from its patch.
 */
export const PATCH_OMITTED = {
  BINARY: "binary",
  TOO_LARGE: "too-large",
} as const;

export const CHANGES_BOUNDS = {
  /** The most files one read of a pull request's changes carries; a pull request with more is cut short, and says so. */
  MAX_FILES: 300,
  /** The most characters one file's patch may spell before it is left out as too large. */
  MAX_PATCH_CHARS: 100_000,
  /** The most reviewers or review comments one read names; a pull request with more names its first. */
  MAX_PEOPLE: 50,
  /** The most characters of a review comment's words a read carries. */
  MAX_EXCERPT_CHARS: 280,
} as const;

/**
 * One changed file: its path from the repository's root, and the path it
 * moved from where it was renamed; what became of it; the lines it adds
 * and removes; and its patch, every hunk of a unified diff from the first
 * `@@` header on, or null with why where it carries none.
 */
/** A commit as GitHub names it: forty hex digits. */
const commitShaSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f]{40}$/u));

/**
 * One changed file as GitHub lists it: its path, where it moved from, what
 * became of it, the lines it adds and removes, its patch or why none, and
 * the git object its contents after are (`blobSha`), which a reader of the
 * file whole checks it read the very contents the patch was made against;
 * absent from a service before it, and for a file with no contents after.
 */
const changedFileSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  previousPath: EffectSchema.NullOr(EffectSchema.String),
  status: EffectSchema.Literals(Object.values(CHANGED_FILE_STATUS)),
  additions: countedNumber,
  deletions: countedNumber,
  patch: EffectSchema.NullOr(EffectSchema.String),
  omitted: EffectSchema.NullOr(EffectSchema.Literals(Object.values(PATCH_OMITTED))),
  blobSha: EffectSchema.optionalKey(commitShaSchema),
});

export type CodingAgentChangedFile = typeof changedFileSchema.Type;

/**
 * Where a reviewer stands on a pull request, by their newest review that
 * decides: approved, asked for changes, or that review dismissed; one who
 * only commented, or one asked for a review not yet given.
 */
export const REVIEW_STATE = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  DISMISSED: "dismissed",
  COMMENTED: "commented",
  REQUESTED: "requested",
} as const;

/**
 * Someone a pull request names on GitHub: their login, their avatar where
 * GitHub's own avatar host serves it, whether they are an App's bot, and
 * the Luke account whose linked GitHub account it is, where that account is
 * a member of the agent's workspace. Luke's own App's bot is an App's bot
 * like any other.
 */
const githubPersonSchema = EffectSchema.Struct({
  login: EffectSchema.String,
  avatarUrl: EffectSchema.optionalKey(EffectSchema.String),
  bot: EffectSchema.Boolean,
  userId: EffectSchema.optionalKey(EffectSchema.String),
});

export type GitHubPerson = typeof githubPersonSchema.Type;

export type ReviewState = (typeof REVIEW_STATE)[keyof typeof REVIEW_STATE];

const reviewStateSchema = EffectSchema.Literals(Object.values(REVIEW_STATE));

/** A reviewer of a pull request, and where they stand on it. */
const pullRequestReviewerSchema = EffectSchema.Struct({
  by: githubPersonSchema,
  state: reviewStateSchema,
});

/** One review that said something: who, where it left them, the start of its words, and when. */
const reviewCommentSchema = EffectSchema.Struct({
  by: githubPersonSchema,
  state: reviewStateSchema,
  excerpt: EffectSchema.String.check(EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_EXCERPT_CHARS)),
  at: countedNumber,
});

/**
 * One agent's changes (GET): the pull request it published, as its page on
 * GitHub, its files in the order GitHub lists them now, and whether the
 * list was cut short at the bound; or null where it has opened none yet,
 * which is not the same as a pull request that changes nothing. Who opened
 * it, who the agent writes as on GitHub (`CODING_AGENT_AUTHOR`), its
 * reviewers and where each stands, and its reviews that said something
 * ride beside the files, each absent from a service before them, and who
 * the agent writes as absent too for an agent whose first session never
 * settled it. The commits a changed image is read at ride beside them too (`headSha`, the pull request's head, and
 * `baseSha`, where its head and base branch part, which GitHub's diff is
 * counted from), each absent where it could not be read, and `baseSha`
 * absent where no image the files change stood before them.
 */
export const codingAgentChangesAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(
    EffectSchema.Struct({
      url: EffectSchema.String,
      headSha: EffectSchema.optionalKey(commitShaSchema),
      baseSha: EffectSchema.optionalKey(commitShaSchema),
      files: EffectSchema.Array(changedFileSchema).check(
        EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_FILES),
      ),
      truncated: EffectSchema.Boolean,
      author: EffectSchema.optionalKey(githubPersonSchema),
      writtenAs: EffectSchema.optionalKey(
        EffectSchema.Literals(Object.values(CODING_AGENT_AUTHOR)),
      ),
      reviewers: EffectSchema.optionalKey(
        EffectSchema.Array(pullRequestReviewerSchema).check(
          EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_PEOPLE),
        ),
      ),
      comments: EffectSchema.optionalKey(
        EffectSchema.Array(reviewCommentSchema).check(
          EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_PEOPLE),
        ),
      ),
    }),
  ),
});

type CodingAgentChanges = NonNullable<(typeof codingAgentChangesAnswerSchema.Type)["pullRequest"]>;

/** Who an agent's pull request names, as its changes carry them; every key absent from a service before them, or where they could not be read. */
export type CodingAgentChangesPeople = Pick<
  CodingAgentChanges,
  "author" | "writtenAs" | "reviewers" | "comments"
>;

/**
 * Whether an open pull request would merge as it stands, as GitHub works it
 * out: ready, its checks short of passing though nothing requires them,
 * blocked by a rule (a review or a check the branch requires), behind its
 * base where the base must be merged in first, in conflict with its base, a
 * draft, or not yet worked out, which GitHub does a moment after a push.
 */
export const MERGE_STATE = {
  CLEAN: "clean",
  UNSTABLE: "unstable",
  BLOCKED: "blocked",
  BEHIND: "behind",
  CONFLICTS: "conflicts",
  DRAFT: "draft",
  UNKNOWN: "unknown",
} as const;

export type MergeState = (typeof MERGE_STATE)[keyof typeof MERGE_STATE];

/** What the reviews a branch requires say of a pull request, as GitHub sums them up. */
export const REVIEW_DECISION = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: "review-required",
} as const;

export type ReviewDecision = (typeof REVIEW_DECISION)[keyof typeof REVIEW_DECISION];

/**
 * How an open pull request may be merged, as its merge box offers it: the
 * methods the repository allows, whether it allows auto-merge, whether its
 * base is merged through a merge queue, where the pull request stands in that
 * queue or whether auto-merge is on for it, by which method, the head a merge
 * is made against, what its required reviews say, and its checks as one word.
 */
const pullRequestMergingSchema = EffectSchema.Struct({
  methods: EffectSchema.Array(mergeMethodSchema),
  autoMergeAllowed: EffectSchema.Boolean,
  queue: EffectSchema.Boolean,
  queued: EffectSchema.NullOr(EffectSchema.Struct({ position: countedNumber })),
  autoMerge: EffectSchema.NullOr(
    EffectSchema.Struct({ method: EffectSchema.NullOr(mergeMethodSchema) }),
  ),
  headSha: EffectSchema.String.check(
    EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_COMMIT_CHARS),
  ),
  review: EffectSchema.NullOr(EffectSchema.Literals(Object.values(REVIEW_DECISION))),
  checks: EffectSchema.Literals(Object.values(CHECK_SUMMARY)),
});

export type PullRequestMerging = typeof pullRequestMergingSchema.Type;

/** Where one check on a pull request's head stands: running or queued, passed, failed, or skipped or neutral, which passes nothing and fails nothing. */
export const CHECK_STATE = {
  PENDING: "pending",
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type CheckState = (typeof CHECK_STATE)[keyof typeof CHECK_STATE];

/** Where one deployment of a pull request's head stands, by its newest status: ready, still deploying, failed, or no longer serving (inactive, destroyed, or abandoned). */
export const DEPLOYMENT_STATE = {
  READY: "ready",
  PENDING: "pending",
  FAILED: "failed",
  INACTIVE: "inactive",
} as const;

export type DeploymentState = (typeof DEPLOYMENT_STATE)[keyof typeof DEPLOYMENT_STATE];

/** What one entry of a pull request's conversation is: a comment on it, or a review. */
export const CONVERSATION_ENTRY = {
  COMMENT: "comment",
  REVIEW: "review",
} as const;

export const OVERVIEW_BOUNDS = {
  /** The most checks one read lists; a head with more lists its first. */
  MAX_CHECKS: 100,
  /** The most deployments one read lists, one per environment, the newest of each kept. */
  MAX_DEPLOYMENTS: 10,
  /** The most entries of the conversation one read carries, the newest kept, the rest counted. */
  MAX_ENTRIES: 100,
  /** The most characters of a check's or a branch's name a read carries. */
  MAX_NAME_CHARS: 255,
  /** The most review threads one read carries, the newest kept, the rest counted with the earlier entries. */
  MAX_THREADS: 100,
  /** The most comments of one review thread a read carries, its first kept, the rest counted. */
  MAX_THREAD_COMMENTS: 50,
  /** The most labels one read carries; GitHub allows a hundred on a pull request. */
  MAX_LABELS: 100,
  /** The most pull requests of a stack one read names, the pull request itself among them. */
  MAX_STACK: 30,
  /** The most people one reaction names, the first GitHub lists, the rest counted. */
  MAX_REACTORS: 10,
  /** The most labels, users, or teams the reviewer and label pickers are offered, each. */
  MAX_OPTIONS: 300,
  /** The most comments of the member's own pending review one read carries, its first kept, the rest only counted. */
  MAX_PENDING_COMMENTS: 100,
} as const;

/** The side of a diff a review thread's line counts on: the old file's, or the new file's. */
export const DIFF_SIDE = {
  LEFT: "left",
  RIGHT: "right",
} as const;

export type DiffSide = (typeof DIFF_SIDE)[keyof typeof DIFF_SIDE];

/** A name GitHub gives a check or a branch, as a read carries it. */
const overviewName = EffectSchema.String.check(
  EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_NAME_CHARS),
);

/**
 * One check on a pull request's head: a check run, named by its run and the
 * App that runs it, or a commit status, named by its context and by no App;
 * where it stands; its page, where GitHub names one; and when it started and
 * ended, in epoch milliseconds, where it has. Its avatar is the picture of
 * the App that runs it, or of whoever posted the status, as GitHub's own
 * avatar host serves it; absent where GitHub names none there, or from a
 * service before it.
 */
const pullRequestCheckSchema = EffectSchema.Struct({
  name: overviewName,
  app: EffectSchema.NullOr(overviewName),
  state: EffectSchema.Literals(Object.values(CHECK_STATE)),
  url: EffectSchema.NullOr(EffectSchema.String),
  startedAt: EffectSchema.NullOr(countedNumber),
  completedAt: EffectSchema.NullOr(countedNumber),
  avatarUrl: EffectSchema.optionalKey(EffectSchema.String),
});

export type PullRequestCheck = typeof pullRequestCheckSchema.Type;

/**
 * One deployment of a pull request's head, the newest of its environment:
 * the environment it deployed to, such as a Vercel Preview; where it stands
 * by its newest status; the address it serves, an https one GitHub's
 * status names, null where it names none; and the avatar of the App that
 * deployed it on GitHub's avatar host, absent where GitHub names none.
 */
const pullRequestDeploymentSchema = EffectSchema.Struct({
  environment: overviewName,
  state: EffectSchema.Literals(Object.values(DEPLOYMENT_STATE)),
  url: EffectSchema.NullOr(EffectSchema.String),
  avatarUrl: EffectSchema.optionalKey(EffectSchema.String),
});

export type PullRequestDeployment = typeof pullRequestDeploymentSchema.Type;

/**
 * One reaction a comment wears, as GitHub draws it under the comment: which
 * it is, how many reacted with it, and, where the read names them, the first
 * of them up to the bound, in GitHub's order; and whether the member reading
 * gave it, as GitHub answers their own sign-in, absent where it was not read
 * so. A reaction nobody gave is not carried.
 */
const reactionGroupSchema = EffectSchema.Struct({
  content: EffectSchema.Literals(Object.values(REACTION)),
  count: countedNumber,
  by: EffectSchema.optionalKey(
    EffectSchema.Array(githubPersonSchema).check(
      EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_REACTORS),
    ),
  ),
  mine: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/** GitHub's GraphQL id of what wears reactions, which a reaction is added to or taken from by; absent where the read named none. */
const reactionSubjectSchema = EffectSchema.optionalKey(
  EffectSchema.String.check(EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_NAME_CHARS)),
);

export type ReactionGroup = typeof reactionGroupSchema.Type;

/** The reactions a comment wears, in GitHub's order, absent where it wears none or from a service before them. */
const reactionsSchema = EffectSchema.Array(reactionGroupSchema).check(
  EffectSchema.isMaxLength(Object.values(REACTION).length),
);

/**
 * One comment of a review thread: who; their words whole, as GitHub renders
 * them (`bodyHTML`), or, where GitHub sent no rendering, null with their
 * words as markdown in `body`; when, in epoch milliseconds; its page; and
 * the reactions it wears, with what they are added to it by (`subject`).
 */
const reviewThreadCommentSchema = EffectSchema.Struct({
  by: githubPersonSchema,
  html: EffectSchema.NullOr(EffectSchema.String),
  body: EffectSchema.String,
  at: countedNumber,
  url: EffectSchema.String,
  reactions: EffectSchema.optionalKey(reactionsSchema),
  subject: reactionSubjectSchema,
});

const diffSideSchema = EffectSchema.Literals(Object.values(DIFF_SIDE));

/**
 * One review thread: the file it is on; the line it stands on now and the
 * first of its range, each null where a later push outdated it or it is on
 * the whole file; the line and the first of its range where it was made,
 * which its `diffHunk` is counted against, and the side each counts on;
 * the hunk GitHub froze when it was made, ending at its line, empty where
 * GitHub kept none; whether it was resolved, and whether a later push
 * outdated it; its comments, oldest first, up to the bound; how many
 * more GitHub holds (`more`); and GitHub's own id for it, which a reply,
 * a resolve, or an unresolve names it by, absent from a service before
 * those.
 */
const reviewThreadSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  line: EffectSchema.NullOr(countedNumber),
  startLine: EffectSchema.NullOr(countedNumber),
  originalLine: EffectSchema.NullOr(countedNumber),
  originalStartLine: EffectSchema.NullOr(countedNumber),
  side: diffSideSchema,
  startSide: EffectSchema.NullOr(diffSideSchema),
  diffHunk: EffectSchema.String,
  resolved: EffectSchema.Boolean,
  outdated: EffectSchema.Boolean,
  comments: EffectSchema.Array(reviewThreadCommentSchema).check(
    EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_THREAD_COMMENTS),
  ),
  more: countedNumber,
  id: EffectSchema.optionalKey(EffectSchema.String),
});

export type ReviewThread = typeof reviewThreadSchema.Type;

/**
 * One comment of the member's own pending review, which nobody else sees
 * until they submit it: GitHub's own id for it, which an edit or a deletion
 * names it by; the published review thread it replies on, by GitHub's id
 * for it (`ReviewThread.id`), absent for a comment that starts a thread of
 * its own; who, the member; the file it is on; the line it stands on
 * and the first of its range, each null where it is on the whole file, and
 * the side each counts on; their words whole, as GitHub renders them, or,
 * where GitHub sent no rendering, null with their words as markdown in
 * `body`, which an edit starts from; and when, in epoch milliseconds.
 */
const pendingReviewCommentSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  threadId: EffectSchema.optionalKey(EffectSchema.String),
  by: githubPersonSchema,
  path: EffectSchema.String,
  line: EffectSchema.NullOr(countedNumber),
  startLine: EffectSchema.NullOr(countedNumber),
  side: diffSideSchema,
  startSide: EffectSchema.NullOr(diffSideSchema),
  html: EffectSchema.NullOr(EffectSchema.String),
  body: EffectSchema.String,
  at: countedNumber,
});

export type PendingReviewComment = typeof pendingReviewCommentSchema.Type;

/**
 * One entry of a pull request's conversation: a comment on it, or a review
 * and where it left its reviewer; who; their words whole, as GitHub renders
 * them (`body_html`), or, where GitHub sent no rendering, null with their
 * words as markdown in `body`, empty otherwise; when, in epoch
 * milliseconds; its page; on a review, the threads on lines it started,
 * absent where it started none or from a service before them; and the
 * reactions it wears, with what they are added to it by (`subject`).
 */
const conversationEntrySchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(CONVERSATION_ENTRY)),
  by: githubPersonSchema,
  state: EffectSchema.optionalKey(reviewStateSchema),
  html: EffectSchema.NullOr(EffectSchema.String),
  body: EffectSchema.String,
  at: countedNumber,
  url: EffectSchema.String,
  threads: EffectSchema.optionalKey(
    EffectSchema.Array(reviewThreadSchema).check(
      EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_THREADS),
    ),
  ),
  reactions: EffectSchema.optionalKey(reactionsSchema),
  subject: reactionSubjectSchema,
});

export type ConversationEntry = typeof conversationEntrySchema.Type;

/** A label on a pull request: its name, and its colour as GitHub spells it, six hex digits with no `#`. */
const pullRequestLabelSchema = EffectSchema.Struct({
  name: overviewName,
  color: EffectSchema.String,
});

export type PullRequestLabel = typeof pullRequestLabelSchema.Type;

/** A team of the repository's organization a review may be asked of: its slug, which a request names it by, and its name. */
const reviewTeamSchema = EffectSchema.Struct({
  slug: overviewName,
  name: EffectSchema.String,
});

export type PullRequestReviewTeam = typeof reviewTeamSchema.Type;

/** The agent whose pull request one of a stack is: its id, and its plan's, null for an agent on none. */
const stackAgentSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  taskId: EffectSchema.NullOr(wireUuidSchema),
});

/**
 * One open pull request of the stack a pull request stands in: its number,
 * title, and page; whether it is a draft, and whether GitHub's merge queue
 * holds it; and the agent of the workspace whose branch is its head, where
 * one is.
 */
const stackEntrySchema = EffectSchema.Struct({
  number: countedNumber,
  title: EffectSchema.String,
  url: EffectSchema.String,
  draft: EffectSchema.Boolean,
  /** True where the merge queue holds it; absent otherwise, and from a service before it was sent. */
  queued: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  agent: EffectSchema.optionalKey(stackAgentSchema),
});

export type PullRequestStackEntry = typeof stackEntrySchema.Type;

/**
 * The pull request itself as its Pull request tab's overview draws it (GET),
 * the first of the overview's three reads, each of which lands on its own:
 * where it stands, its title, number, and page; its description as
 * written and as GitHub renders it (`body_html`), each empty where it has
 * none, and whether the member reading may edit it; the branch it merges
 * into and the one it merges from, with the account whose fork that one
 * stands on where it is not the repository's own (absent from a service
 * before it); when it was opened, and merged where it
 * was; whether it would merge as it stands; who opened it, who the agent
 * writes as on GitHub, and who it still asks for a review, people and
 * teams; its labels; and,
 * while it is open, the stack it stands in, base first and itself among it,
 * empty where it stands in none. Its labels and its stack are absent from a
 * service before them. Null where the agent has opened none yet, or the
 * repository no longer holds it.
 */
export const codingAgentOverviewPullRequestAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(
    EffectSchema.Struct({
      number: countedNumber,
      title: EffectSchema.String,
      url: EffectSchema.String,
      state: EffectSchema.Literals(Object.values(PULL_REQUEST_STATE)),
      /** Its description as written, Markdown, which an edit of it begins from; absent from a service before it. */
      body: EffectSchema.optionalKey(EffectSchema.String),
      html: EffectSchema.String,
      /** Whether the member reading may edit its description on their own GitHub sign-in; absent from a service before it. */
      canEditDescription: EffectSchema.optionalKey(EffectSchema.Boolean),
      base: overviewName,
      head: overviewName,
      headOwner: EffectSchema.optionalKey(overviewName),
      createdAt: countedNumber,
      mergedAt: EffectSchema.NullOr(countedNumber),
      merge: EffectSchema.Literals(Object.values(MERGE_STATE)),
      author: EffectSchema.optionalKey(githubPersonSchema),
      writtenAs: EffectSchema.optionalKey(
        EffectSchema.Literals(Object.values(CODING_AGENT_AUTHOR)),
      ),
      requested: EffectSchema.Array(githubPersonSchema).check(
        EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_PEOPLE),
      ),
      /** How it may be merged; absent where GitHub did not say, or from a service before the merge box. */
      merging: EffectSchema.optionalKey(pullRequestMergingSchema),
      requestedTeams: EffectSchema.optionalKey(
        EffectSchema.Array(reviewTeamSchema).check(
          EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_PEOPLE),
        ),
      ),
      labels: EffectSchema.optionalKey(
        EffectSchema.Array(pullRequestLabelSchema).check(
          EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_LABELS),
        ),
      ),
      stack: EffectSchema.optionalKey(
        EffectSchema.Array(stackEntrySchema).check(
          EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_STACK),
        ),
      ),
    }),
  ),
});

/**
 * What the reviewer and label pickers of an agent's Pull request tab offer
 * (GET), read of its repository rather than its pull request: the
 * repository's labels, the users who may be asked for a review (its
 * collaborators), and its organization's teams that reach it, each up to
 * the bound; each empty where the Luke GitHub App may not read it.
 */
export const codingAgentReviewOptionsAnswerSchema = EffectSchema.Struct({
  labels: EffectSchema.Array(pullRequestLabelSchema).check(
    EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_OPTIONS),
  ),
  users: EffectSchema.Array(githubPersonSchema).check(
    EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_OPTIONS),
  ),
  teams: EffectSchema.Array(reviewTeamSchema).check(
    EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_OPTIONS),
  ),
});

export type CodingAgentReviewOptions = typeof codingAgentReviewOptionsAnswerSchema.Type;

export type CodingAgentOverviewPullRequest = NonNullable<
  (typeof codingAgentOverviewPullRequestAnswerSchema.Type)["pullRequest"]
>;

/**
 * Every check on an agent's pull request's head, as its overview draws them
 * (GET): those that failed first, then those still running, up to the
 * bound; and its head's deployments, the newest of each environment first,
 * up to theirs, absent from a service before them. Null where the agent has
 * opened no pull request yet.
 */
export const codingAgentOverviewChecksAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(
    EffectSchema.Struct({
      checks: EffectSchema.Array(pullRequestCheckSchema).check(
        EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_CHECKS),
      ),
      deployments: EffectSchema.optionalKey(
        EffectSchema.Array(pullRequestDeploymentSchema).check(
          EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_DEPLOYMENTS),
        ),
      ),
    }),
  ),
});

export type CodingAgentOverviewChecks = NonNullable<
  (typeof codingAgentOverviewChecksAnswerSchema.Type)["pullRequest"]
>;

/**
 * An agent's pull request's conversation, as its overview draws it (GET):
 * where each reviewer stands by their reviews, which the pull request's own
 * read's reviewers still asked for override; and its comments and reviews,
 * oldest first, its newest entries kept up to the bound, with how many
 * earlier ones were left on GitHub (`earlier`), review threads past their
 * bound among them; the reactions its description wears, read with the
 * conversation rather than the description itself, since they are read in
 * the same ask as the reactions of its comments; and, read beside it on the
 * reader's own token, the review they hold pending on it, by how many
 * comments it holds and those comments themselves, the first up to the
 * bound (`drafts`, absent where they could not be read, or from a service
 * before them), null where they hold none or it could not be read as
 * theirs, absent from a service before it. Null where the agent has opened
 * no pull request yet.
 */
export const codingAgentOverviewConversationAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(
    EffectSchema.Struct({
      reviewers: EffectSchema.Array(pullRequestReviewerSchema).check(
        EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_PEOPLE),
      ),
      conversation: EffectSchema.Array(conversationEntrySchema).check(
        EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_ENTRIES),
      ),
      earlier: countedNumber,
      descriptionReactions: EffectSchema.optionalKey(reactionsSchema),
      descriptionSubject: reactionSubjectSchema,
      pendingReview: EffectSchema.optionalKey(
        EffectSchema.NullOr(
          EffectSchema.Struct({
            comments: countedNumber,
            drafts: EffectSchema.optionalKey(
              EffectSchema.Array(pendingReviewCommentSchema).check(
                EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_PENDING_COMMENTS),
              ),
            ),
          }),
        ),
      ),
    }),
  ),
});

export type CodingAgentOverviewConversation = NonNullable<
  (typeof codingAgentOverviewConversationAnswerSchema.Type)["pullRequest"]
>;

/** A reviewer of a pull request, and where they stand on it. */
export type PullRequestReviewer = typeof pullRequestReviewerSchema.Type;

/**
 * The tool an agent hands a slice of its work to a subagent with, by the
 * name its tool part carries in the transcript (`tool-delegate`). The call
 * blocks the agent's turn until the worker answers; the worker reads the
 * agent's checkout and writes nothing. The part's `toolCallId` is eve's
 * id for the call, and the worker's own transcript is read under it
 * (`GET /api/agents/{id}/subagents/{callId}/messages`), so a tab can open the
 * worker's session from the moment the call is requested.
 */
export const CODING_AGENT_DELEGATE_TOOL = "delegate";

/**
 * The tool one coding agent sends another of its workspace a message with,
 * by the name its tool part carries in the sender's transcript; the line it
 * writes in the other agent's opens on `AGENT_MESSAGE_LEAD` and who sent it,
 * and closes on how to answer (`agentMessageReplyLine`).
 */
export const AGENT_MESSAGE_TOOL = "message_agent";

/** How a message another coding agent sent opens, in the line that hands it to the agent it was sent to. */
export const AGENT_MESSAGE_LEAD = "Message";

/** A message's closing line telling the agent how to answer the agent that sent it, by that agent's id. */
export function agentMessageReplyLine(agentId: string): string {
  return `Reply with ${AGENT_MESSAGE_TOOL}({ agentId: "${agentId}", text }).`;
}

/** A message's head as `agent-message.ts` writes it, whole: its lead, and who sent it. */
const AGENT_MESSAGE_HEAD = new RegExp(`^${AGENT_MESSAGE_LEAD} · .+ to you:$`, "u");

/** A message's closing line as `agentMessageReplyLine` writes it, whole. */
const AGENT_MESSAGE_REPLY = new RegExp(
  `^Reply with ${AGENT_MESSAGE_TOOL}\\(\\{ agentId: "[0-9a-f-]+", text \\}\\)\\.$`,
  "u",
);

/**
 * A message another agent sent, as a person reads it: its words, without
 * the head naming who sent it and the closing line telling the agent how to
 * answer, which are the model's alone; nothing for a text of no message's
 * shape.
 */
export function agentMessageWords(text: string): string | undefined {
  const [head, ...rest] = text.split("\n\n");
  if (head === undefined || !AGENT_MESSAGE_HEAD.test(head)) return undefined;
  const last = rest.at(-1);
  const words = last !== undefined && AGENT_MESSAGE_REPLY.test(last) ? rest.slice(0, -1) : rest;
  return words.join("\n\n").trim();
}

/** eve's id for a tool call, as the path names a subagent's transcript by it. */
export const codingAgentCallIdSchema = trimmedText(CODING_AGENT_BOUNDS.MAX_CALL_ID_CHARS);

/**
 * What a delegation's tool part carries as its input: the task in the
 * agent's words, and the model and effort the agent chose for the worker,
 * each absent where the agent left it to its own.
 */
export const codingAgentDelegationInputSchema = EffectSchema.Struct({
  task: EffectSchema.String,
  model: EffectSchema.optionalKey(EffectSchema.String),
  effort: EffectSchema.optionalKey(EffectSchema.String),
  /** Whether the agent keeps working while the worker runs rather than waiting for its answer; waiting where unset. */
  background: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/** What a settled delegation's tool part carries as its output: the model and effort the worker ran on, and its answer. */
export const codingAgentDelegationOutputSchema = EffectSchema.Struct({
  model: EffectSchema.String,
  effort: EffectSchema.String,
  result: EffectSchema.String,
});

/**
 * The tool an agent writes its to-do list with, by the name its tool part
 * carries in the transcript (`tool-write_todos`). Each call carries the
 * whole list, so the newest call's input is the list as it stands, and a
 * tab draws each call where it landed with the older ones folded. Named
 * to-dos rather than a plan, because the plan is Luke's own document.
 */
export const CODING_AGENT_TODOS_TOOL = "write_todos";

/** Where one to-do stands. */
export const CODING_AGENT_TODO_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  DONE: "done",
} as const;

export type CodingAgentTodoStatus =
  (typeof CODING_AGENT_TODO_STATUS)[keyof typeof CODING_AGENT_TODO_STATUS];

/**
 * What a to-do write's tool part carries as its input: the whole list, in
 * order, each item its words and where it stands. The model is shown this
 * schema and eve holds the call to it, and a tab reads the stored part
 * back through it, so the two read one list.
 */
export const codingAgentTodosInputSchema = EffectSchema.Struct({
  todos: EffectSchema.Array(
    EffectSchema.Struct({
      content: EffectSchema.String.check(
        EffectSchema.isNonEmpty(),
        EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_TODO_CHARS),
      ),
      status: EffectSchema.Literals(Object.values(CODING_AGENT_TODO_STATUS)),
    }),
  ).check(EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_TODOS)),
});

export type CodingAgentTodos = typeof codingAgentTodosInputSchema.Type;

/**
 * One JSON object as the row holds it, read whole: a message part or the
 * metadata beside the parts, whose fields are the AI SDK's own vocabulary
 * and not this wire's to spell. The node shown for it says only that much.
 */
export const storedObjectSchema = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/** How a turn ended where it did not simply answer: stopped, failed, or given up on by the sweep after running past its bound. */
export const TURN_ENDING = {
  STOPPED: "stopped",
  FAILED: "failed",
  ABANDONED: "abandoned",
} as const;

export type TurnEnding = (typeof TURN_ENDING)[keyof typeof TURN_ENDING];

/**
 * One turn's own tokens, as its row summed them over its steps: the input
 * the model read, the output it wrote, how much of that input its prefix
 * cache answered, and how much of it was written to that cache, both of
 * which the input counts too. The cache's writes are absent where no
 * step's provider said them, as OpenAI's do not, and on a turn from before
 * they were kept.
 */
const turnTokensSchema = EffectSchema.Struct({
  inputTokens: countedNumber,
  outputTokens: countedNumber,
  cachedInputTokens: countedNumber,
  cacheWriteTokens: EffectSchema.optionalKey(countedNumber),
});

export type TurnTokens = typeof turnTokensSchema.Type;

/** A catalog id or an effort as a turn's row recorded it. */
const recordedChoice = EffectSchema.String.check(
  EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_CHOICE_CHARS),
);

/**
 * What a finished turn ran on and spent, as its row recorded them, which a
 * turn's footer card says: the model's catalog id, the effort it ran at,
 * its tokens, how it ended where it did not simply answer, and whether a
 * fast step of it ran at standard speed. Each is
 * absent where the row recorded none and from a service older than it; the
 * tokens and the ending, too, until the turn has ended.
 */
const turnRecordFields = {
  /** The catalog id of the model the turn ran on, such as `openai/gpt-6.1-sol`. */
  model: EffectSchema.optionalKey(recordedChoice),
  effort: EffectSchema.optionalKey(recordedChoice),
  tokens: EffectSchema.optionalKey(turnTokensSchema),
  ending: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(TURN_ENDING))),
  /** Whether Anthropic refused a fast step of the turn, which ran at standard speed instead; absent where none was refused, and from a service older than it. */
  fastRefused: EffectSchema.optionalKey(EffectSchema.Boolean),
};

const turnRecordSchema = EffectSchema.Struct(turnRecordFields);

export type TurnRecord = typeof turnRecordSchema.Type;

/**
 * What sent one of the developer's lines to a coding agent: a member, from
 * the message box or an Inbox answer; Luke, from a call; an automation's
 * run, on its creator's behalf; GitHub, telling the agent of a review, a
 * comment, or a failed check on its pull request, by who caused it there;
 * or another coding agent of the workspace, through `message_agent`.
 */
export const MESSAGE_SENDER = {
  MEMBER: "member",
  LUKE: "luke",
  AUTOMATION: "automation",
  GITHUB: "github",
  AGENT: "agent",
} as const;

export type MessageSender = (typeof MESSAGE_SENDER)[keyof typeof MESSAGE_SENDER];

/** What kind of thing sent one of the developer's messages to a coding agent: a member, a member whose account is gone, Luke from a call, an automation's run, or GitHub, by the login of who caused what it tells the agent of. */
export const CODING_AGENT_SENDER = {
  MEMBER: "member",
  FORMER: "former",
  LUKE: "luke",
  AUTOMATION: "automation",
  GITHUB: "github",
} as const;

/**
 * What sent one of the developer's messages to a coding agent, by the name
 * a reader sees over it: a member by their account's id and the name it
 * holds now, a member who has left among them, and with no id what sent it
 * in a member's place or a member whose account is gone, each named as the
 * service words it, and what kind of sender it is, so the window draws Luke
 * as Luke, an automation as one, and GitHub as the login named; the kind is
 * absent from a service older than it. The window names nobody over the reader's own.
 * Another coding agent of the workspace is named with no kind and marked
 * `agent` instead, because a window reads `kind` as one of the words it
 * knows and would refuse the whole page over a word it was built before,
 * while it drops a key it does not know: an older build draws the agent as a
 * sender it cannot place, under its name, and a newer one as an agent.
 */
const codingAgentSenderSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  userId: EffectSchema.optionalKey(EffectSchema.String),
  kind: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(CODING_AGENT_SENDER))),
  /** That another coding agent of the workspace sent it, by its name; absent for any other sender and from a service older than it. */
  agent: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  /**
   * The catalog id of the model that agent ran on when it sent the line,
   * which the window reads its harness's mark off; absent for any other
   * sender, for an agent's line sent before it was kept, and from a service
   * older than it.
   */
  model: EffectSchema.optionalKey(recordedChoice),
  /**
   * That agent's id, which the window opens its tab and reads its card by;
   * absent for any other sender, for an agent's line sent before it was
   * kept, once that agent is gone, and from a service older than it.
   */
  agentId: EffectSchema.optionalKey(wireUuidSchema),
  /** The task that agent works on, where `agentId` is given and it works on one. */
  taskId: EffectSchema.optionalKey(wireUuidSchema),
});

export type CodingAgentSender = typeof codingAgentSenderSchema.Type;

/** Which field of a part a page carries cut: a tool call's output, or a reasoning's words. */
export const PART_CUT_FIELD = {
  OUTPUT: "output",
  TEXT: "text",
} as const;

export type PartCutField = (typeof PART_CUT_FIELD)[keyof typeof PART_CUT_FIELD];

/** The query a transcript read asks its heavy parts cut by, and the one word it takes. */
export const TRANSCRIPT_PARTS_QUERY = { PARTS: "parts", CUT: "cut" } as const;

/**
 * One part a page carries cut: its index among the message's `parts`, the
 * field left out of that part, the whole field's size in UTF-8 bytes, and
 * its first and last characters, a tool output as its JSON text, at most
 * half of `MAX_PART_CHARS` each. The part itself stands in `parts` without
 * the field, so nothing reads the cut words as the part's own; the message's
 * id and this index name the part to fetch whole.
 */
const codingAgentPartCutSchema = EffectSchema.Struct({
  index: countedNumber,
  field: EffectSchema.Literals(Object.values(PART_CUT_FIELD)),
  bytes: countedNumber,
  head: EffectSchema.String,
  tail: EffectSchema.String,
});

export type CodingAgentPartCut = typeof codingAgentPartCutSchema.Type;

/** One part of a transcript's message whole, as its row holds it: what a reader fetches for a part its page carried cut. */
export const codingAgentPartAnswerSchema = EffectSchema.Struct({
  part: storedObjectSchema,
});

export type CodingAgentPartAnswer = typeof codingAgentPartAnswerSchema.Type;

/**
 * One message of an agent's transcript, as the conversation's row holds it:
 * an AI SDK `UIMessage`, its parts as the SDK shapes them (text, reasoning,
 * tool calls with their input and output, step boundaries) and the stored
 * metadata beside them. The parts are carried as the JSON they are rather
 * than declared part by part, because the SDK's vocabulary is the contract
 * and the components that draw them read it directly. One of the agent's
 * turns carries beside them when the turn began and when it answered or
 * ended, so a tab says how long a finished turn worked, and once it has,
 * what it ran on and spent (`turnRecordFields`).
 */
const codingAgentMessageSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  /**
   * The turn the message is the journal of, so an agent's tab knows which
   * turn a line said on a call answers (`readFrom`); absent on any other
   * row, and from a service older than it.
   */
  turnId: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * What opened a brain turn, as its row recorded it, on the turn's
   * journal: a spoken turn is the voice's, whose words Luke says aloud
   * whether or not a line on screen asked for it, as the look around a
   * call opens with is. Absent on a coding agent's page, on any other row,
   * and from a service older than it.
   */
  origin: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(TURN_ORIGIN))),
  /** Whether older parts of a brain turn's journal than these were left out, which the turn says above its parts; absent where none were, on a coding agent's page, and from a service older than it. */
  earlierOmitted: EffectSchema.optionalKey(EffectSchema.Boolean),
  role: EffectSchema.Literals(Object.values(MESSAGE_ROLE)),
  parts: EffectSchema.Array(storedObjectSchema),
  /** The parts carried cut, each standing in `parts` without its field (`codingAgentPartCutSchema`); absent where none is, on a page not asked cut, and from a service older than it. */
  cutParts: EffectSchema.optionalKey(EffectSchema.Array(codingAgentPartCutSchema)),
  metadata: EffectSchema.optionalKey(storedObjectSchema),
  /** What sent one of the developer's messages to a coding agent (`codingAgentSenderSchema`); absent on every other row, on a message written before senders were kept, and from a service older than it. */
  sentBy: EffectSchema.optionalKey(codingAgentSenderSchema),
  /**
   * The id one of the developer's lines was written under, which a line a
   * window sent is its send key's (`sentLineId` of `@luke/wire/host-ids`), so
   * the window that sent it knows the row as it lands and draws it in the
   * place of the line it drew at once; absent on every other row, and from a
   * service older than it.
   */
  clientId: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_LINE_ID_CHARS)),
  ),
  /**
   * Epoch milliseconds one of the developer's lines was sent, which the tab
   * names under its bubble, or a line said on a call into the agent began,
   * either speaker's, its metadata naming the voice channel and its call;
   * absent on every other row, and from a service older than it.
   */
  sentAt: EffectSchema.optionalKey(countedNumber),
  /**
   * Where in a turn under way one of the developer's lines arrived: the
   * journal of the turn that took it in, by its message id, and how many
   * of that journal's steps had begun before it, so the tab draws the line
   * among the turn's work after those steps rather than ahead of the turn.
   * Absent on a line that opened its turn or still awaits one, on every
   * other row, on a line taken before places were kept, and from a service
   * older than it.
   */
  arrivedIn: EffectSchema.optionalKey(
    EffectSchema.Struct({ journalId: EffectSchema.String, afterStep: countedNumber }),
  ),
  /**
   * The turn whose work a line the agent said on a call answers: the turn
   * the ask it followed ran in, by the turn's id as its journal names it
   * (`turnId`), and where that ask joined a typed turn under way, how many
   * of the turn's steps had begun before it, so the tab folds only the work
   * after them under the line. Absent on a line that followed no ask, or
   * one whose ask has learned no turn, on every other row, and from a
   * service older than it.
   */
  readFrom: EffectSchema.optionalKey(
    EffectSchema.Struct({
      turnId: EffectSchema.String,
      afterStep: EffectSchema.optionalKey(countedNumber),
    }),
  ),
  /** Epoch milliseconds the turn began, as a working line counts it: its start, or its queueing where eve has not started it; absent on the developer's rows, and from a service older than it. */
  startedAt: EffectSchema.optionalKey(countedNumber),
  /** Epoch milliseconds the turn answered or ended; absent while it is still written, on the developer's rows, and from a service older than it. */
  finishedAt: EffectSchema.optionalKey(countedNumber),
  ...turnRecordFields,
});

export type CodingAgentMessage = typeof codingAgentMessageSchema.Type;

/**
 * Where a reader stands in the transcript: the highest message sequence it
 * has, and the conversation's journal revision it read at, joined by a
 * colon. A message is new past a cursor when its sequence is higher or it
 * was amended in place at a later revision.
 */
const CURSOR_PATTERN = /^\d+:\d+$/u;

export const codingAgentCursorSchema = EffectSchema.String.check(
  EffectSchema.isPattern(CURSOR_PATTERN),
);

/** The cursor a reader starts from: before every message. */
export const CODING_AGENT_CURSOR_START = "0:0";

/**
 * What some turns cost: the tokens the model read and wrote, how many of
 * those read its prefix cache answered, and the price in dollars where the
 * service knows one for every model they ran on; tokens alone where it
 * does not.
 */
const codingAgentUsageSchema = EffectSchema.Struct({
  inputTokens: countedNumber,
  outputTokens: countedNumber,
  cachedInputTokens: EffectSchema.optionalKey(countedNumber),
  costUsd: EffectSchema.optionalKey(countedNumber),
  /**
   * Who paid for the turns (`CODING_AGENT_PAYER`), on the agent's own
   * transcript where its row records one: a plan's turns are drawn as the
   * plan's usage rather than in dollars, since a subscription has no bill
   * per token. Absent on a worker's, an agent from before payers were
   * recorded, and from a service older than it.
   */
  payer: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(CODING_AGENT_PAYER))),
});

export type CodingAgentUsage = typeof codingAgentUsageSchema.Type;

/**
 * What the agent's own conversation holds in its model's context, as its
 * newest model step left it: the tokens that step's provider counted as
 * read, how many of those its prefix cache answered and how many it wrote
 * to the cache, and what the step wrote; the window of the model the agent
 * runs on now, and the count past which eve compacts the conversation
 * against it. Beside the counts, the estimates of what the step read that
 * no provider counts apart, each made from the text the service composed
 * at about four bytes a token, which is eve's own estimate: the
 * instructions, the tool definitions, and the plan or task the agent was
 * handed, which is absent once eve has compacted the conversation, since
 * a compaction's summary may have folded it in. When that step ended, and
 * when eve last compacted the conversation, where it has.
 */
const codingAgentContextSchema = EffectSchema.Struct({
  windowTokens: countedNumber,
  compactionThresholdTokens: countedNumber,
  inputTokens: countedNumber,
  outputTokens: countedNumber,
  cachedInputTokens: EffectSchema.optionalKey(countedNumber),
  cacheWriteTokens: EffectSchema.optionalKey(countedNumber),
  estimated: EffectSchema.Struct({
    systemPromptTokens: countedNumber,
    toolDefinitionTokens: countedNumber,
    briefTokens: EffectSchema.optionalKey(countedNumber),
  }),
  /** Epoch milliseconds the step ended. */
  measuredAt: countedNumber,
  /** Epoch milliseconds eve last compacted the conversation. */
  compactedAt: EffectSchema.optionalKey(countedNumber),
});

export type CodingAgentContext = typeof codingAgentContextSchema.Type;

/** One delegation under way: the call that started it, and when its worker began, in epoch milliseconds. */
const codingAgentDelegationStartSchema = EffectSchema.Struct({
  callId: codingAgentCallIdSchema,
  startedAt: countedNumber,
});

export type CodingAgentDelegationStart = typeof codingAgentDelegationStartSchema.Type;

/**
 * Where one of an agent's workers stands, by the call that started it: the
 * status its own session's newest turn reads as, the pair it runs on as its
 * delegation recorded it, and when it began.
 */
const codingAgentSubagentStandingSchema = EffectSchema.Struct({
  callId: codingAgentCallIdSchema,
  status: EffectSchema.Literals(Object.values(CODING_AGENT_STATUS)),
  model: EffectSchema.String,
  effort: EffectSchema.String,
  startedAt: countedNumber,
});

export type CodingAgentSubagentStanding = typeof codingAgentSubagentStandingSchema.Type;

/** One worker's short title, generated from the task it was handed, by the call that started it. */
const codingAgentSubagentTitleSchema = EffectSchema.Struct({
  callId: codingAgentCallIdSchema,
  title: EffectSchema.String,
});

export type CodingAgentSubagentTitle = typeof codingAgentSubagentTitleSchema.Type;

/**
 * The messages past a cursor (GET), the cursor to read on from, and where
 * the agent stood as the page was read, so a reader held on a running agent
 * learns from the page that ends the hold that there is nothing more to
 * wait for, and why, as one fixed word, where the newest turn failed. With
 * them, what the agent has cost over every turn it and its workers have
 * settled, and what its newest turn cost once settled; neither before a
 * turn has.
 * The page carries the agent's title too, since the title generated as the
 * agent starts lands a moment after the list that opened its tab was read,
 * and what its model's context holds once a step has ended; a worker's
 * page carries no context, and its `title` is the worker's own.
 */
export const codingAgentMessagesAnswerSchema = EffectSchema.Struct({
  messages: EffectSchema.Array(codingAgentMessageSchema),
  cursor: codingAgentCursorSchema,
  /**
   * The turn the page before the oldest message here is read before, on a
   * task conversation's page read from its newest turns or before one;
   * absent where no older turn stands, on a coding agent's page, and from a
   * service older than it.
   */
  earlier: EffectSchema.optionalKey(EffectSchema.String),
  status: EffectSchema.Literals(Object.values(CODING_AGENT_STATUS)),
  /** When the run that status is read from began, as the agent's summary says it, so a tab following the transcript counts the run a new turn opened. */
  runStartedAt: EffectSchema.optionalKey(countedNumber),
  /**
   * The delegations the agent's newest turn still waits on, each by the
   * call that started it with when its worker began, so a running
   * subagent's row counts how long it has worked; absent on a worker's
   * page, while none runs, and from a service older than it.
   */
  delegations: EffectSchema.optionalKey(EffectSchema.Array(codingAgentDelegationStartSchema)),
  /**
   * Every worker of the agent's whose title has landed, by the call that
   * started it, whichever page carried the call: a title is generated
   * beside the worker's start and lands a page or more after it. Absent on a
   * worker's page, while no worker has a title, and from a service older
   * than it.
   */
  subagentTitles: EffectSchema.optionalKey(EffectSchema.Array(codingAgentSubagentTitleSchema)),
  /**
   * Where every worker of the agent's stands, by the call that started it,
   * read from the worker's own session rather than the call, whose own state
   * says only that the delegation was made. Absent on a worker's page, while
   * the agent has delegated nothing, and from a service older than it.
   */
  subagents: EffectSchema.optionalKey(EffectSchema.Array(codingAgentSubagentStandingSchema)),
  title: EffectSchema.NullOr(EffectSchema.String),
  failureReason: EffectSchema.optionalKey(
    EffectSchema.Literals(Object.values(CODING_AGENT_FAILURE)),
  ),
  usage: EffectSchema.optionalKey(codingAgentUsageSchema),
  /**
   * Who pays for the agent (`CODING_AGENT_PAYER`), as its row recorded it at
   * Start, before any turn settled too, so the chip says whose plan pays,
   * or none, from the first. Absent on a worker's page, for an agent from
   * before payers were recorded, and from a service older than it.
   */
  payer: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(CODING_AGENT_PAYER))),
  /**
   * What the newest turn alone cost. No service sends it any more, since a
   * price the window draws means the whole run's (`usage`); it stays an
   * optional key so the answer's shape is the one older desktops read.
   */
  turnUsage: EffectSchema.optionalKey(codingAgentUsageSchema),
  context: EffectSchema.optionalKey(codingAgentContextSchema),
  /**
   * The journal revision the agent's transcript was last rewound at, on
   * its own transcript once it has been: a reader whose transcript was read
   * at another reads it afresh from its newest page rather than joining
   * this one to what it holds, since a rewind dropped messages a join would
   * keep. Absent on a worker's page, on one never rewound, and from a
   * service older than it.
   */
  rewound: EffectSchema.optionalKey(countedNumber),
});

export type CodingAgentMessagesAnswer = typeof codingAgentMessagesAnswerSchema.Type;

/**
 * Where a reader of a transcript read back from its end stands: the lowest
 * message sequence it holds, in decimal. The next older page is the
 * messages below it.
 */
export const codingAgentBeforeSchema = EffectSchema.String.check(EffectSchema.isPattern(/^\d+$/u));

/**
 * The transcript's newest page, read at once: the newest messages, oldest
 * first, with everything the page past a cursor carries, its `cursor` the
 * one a reader follows on from with nothing written meanwhile missed, and
 * `before` the place the next older page is read below; absent where
 * nothing older stands.
 */
export const codingAgentNewestAnswerSchema = EffectSchema.Struct({
  ...codingAgentMessagesAnswerSchema.fields,
  before: EffectSchema.optionalKey(codingAgentBeforeSchema),
});

export type CodingAgentNewestAnswer = typeof codingAgentNewestAnswerSchema.Type;

/**
 * An older page of the transcript, read below `before`: its messages,
 * oldest first, and where the page older still is read below; absent where
 * nothing older stands. It carries nothing of the agent as a whole, which
 * the newest page told.
 */
export const codingAgentOlderAnswerSchema = EffectSchema.Struct({
  messages: EffectSchema.Array(codingAgentMessageSchema),
  before: EffectSchema.optionalKey(codingAgentBeforeSchema),
});

export type CodingAgentOlderAnswer = typeof codingAgentOlderAnswerSchema.Type;

/**
 * A page of an agent's messages joined to the ones held: a message heard
 * again that says something new replaces the one held under its id, in
 * place, and a new one joins at the end, so a journal that grows in place is
 * redrawn where it stands. A message heard again keeps every part of it that
 * is unchanged, the whole message where nothing is (`keepIdentity`), and a
 * page that changes nothing answers what was held, because a transcript
 * followed afresh is heard again whole, and what draws a message by its
 * identity then draws only what changed. The agent's tab and the
 * host's read of a task's conversation join pages the same way, so both
 * draw one transcript from the same answers.
 */
export function applyMessagesPage(
  held: readonly CodingAgentMessage[],
  page: readonly CodingAgentMessage[],
): readonly CodingAgentMessage[] {
  if (page.length === 0) return held;
  const heard = new Map(page.map((message) => [message.id, message]));
  const joined = held.map((message) => {
    const again = heard.get(message.id);
    return again === undefined ? message : keepIdentity(message, again);
  });
  const known = new Set(held.map((message) => message.id));
  const appended = page.filter((message) => !known.has(message.id));
  const unchanged =
    appended.length === 0 && joined.every((message, index) => message === held[index]);
  return unchanged ? held : [...joined, ...appended];
}
