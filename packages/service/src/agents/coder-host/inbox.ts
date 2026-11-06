import { posix } from "node:path";
import type { DatabaseServices } from "@repo/database/core/query";
import { inboxSandboxPicturePaths } from "@repo/features/inbox-attachment-link";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_CLOSE_LEAD,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_TOOL,
  type InboxAnswers,
  type InboxAskInput,
  type InboxField,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  type InboxThreadPostInput,
  inboxReadInputSchema,
  inboxThreadPostInputSchema,
  inboxWithdrawInputSchema,
  keptInboxAsk,
  recommendedLabels,
} from "@repo/features/inbox-wire";
import { LINK_PLACE, linkOf, mentionMarkdownLink } from "@repo/features/link-grammar";
import { decodeMention, MENTION_KIND, mentionLinksIn } from "@repo/features/mention-link";
import { PAGE_OWNER, type PageOwner } from "@repo/features/page-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { readEither } from "@repo/wire/effect";
import { Effect, Option, Result } from "effect";
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "../../core.js";
import { afterResponse } from "../../http/after-response.js";
import { logStoreFailure } from "../../http/store-failure.js";
import {
  agentInboxItems,
  closeInboxItem,
  INBOX_POST_REFUSAL,
  type InboxAgent,
  type InboxBodyPicture,
  type InboxPostRefusal,
  postInboxThread,
} from "../../inbox/inbox-store.js";
import { dmThreadPost, settleThreadDms, threadStandsOpen } from "../../slack/thread-dms.js";
import { pageStepOf } from "../written-mentions.js";
import { CODER } from "./bounds.js";
import {
  type InboxSandboxDoor,
  readSandboxMedia,
  type SandboxImageRefusals,
} from "./inbox-image.js";

const MAX_PICTURE_MB = (INBOX_BOUNDS.MAX_IMAGE_BYTES / 1_000_000).toFixed(1);

const MAX_VIDEO_MB = (INBOX_BOUNDS.MAX_VIDEO_BYTES / 1_000_000).toFixed(1);

const POST_THREAD_WORDS =
  "Post a message on a thread in the inbox, apart from your transcript. " +
  "Each post is one message on a thread under key, your own short lowercase slug such as branch-protection. " +
  "The first post under a key opens its thread and must name its title; a later post under the same key adds a message to that thread, never a second one, " +
  "and a title it names renames the thread only where the post asks. " +
  "to is the member the thread's ask is addressed to, by their mention link, the [@Name](link) you name a member by, and the ask waits on them; " +
  "without it, it waits on the task's assignee, or on the developer who started you. " +
  `body is the message, one Markdown body of at most ${INBOX_BOUNDS.MAX_MESSAGE_CHARS} characters. ` +
  `Write a file, a pull request, or an issue in it as a mention, such as [@store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), so ${PRODUCT_NAME} draws it as a chip. ` +
  "Put a link alone on its own line to show it as a card: a pull request, an issue, a page such as the GitHub settings page a to-do is done on, " +
  "or the exact lines a decision is about, as a blob link into your repository at the full 40-character commit you read them at, one already on GitHub, " +
  `ending #L<start>-L<end>, at most ${INBOX_BOUNDS.MAX_CODE_LINES} lines, which they see as GitHub holds them at that commit. ` +
  "Each link alone on its line is a card of its own, so give a thing one: its mention alone on its line is its card, never followed by its bare address. " +
  `Draw a picture where it belongs, such as a screenshot of a UI you rendered, as ![alt](<path> "caption"): path is the file's path in your sandbox, ` +
  `relative to the checkout or absolute, a PNG, JPEG, or WebP of at most ${MAX_PICTURE_MB} MB, or a WebM video of at most ${MAX_VIDEO_MB} MB, such as a recording of a flow, which plays there, ` +
  `at most ${INBOX_BOUNDS.MAX_MESSAGE_PICTURES} a message; ` +
  "alt says in a sentence what it shows, and pictures written next to each other stand side by side. " +
  "A picture the message is about is drawn in it, never pointed at in a transcript, yours or another agent's, which the thread's reader does not see. " +
  "ask is what the message asks of them, which ends it: " +
  `decide (two to ${INBOX_BOUNDS.MAX_OPTIONS} options, each a short label and an optional detail; name the label you recommend; multiple lets them pick several, and recommended then takes a list of the labels you recommend; ` +
  "for a go-ahead on one step you propose, two short options such as Approve and Request changes), " +
  "do (a to-do: something only they can do by hand, such as changing a GitHub setting, adding a secret, or testing by hand what you could not test yourself; " +
  `its steps, at most ${INBOX_BOUNDS.MAX_STEPS}, say exactly what to do, a command to run in a fenced block in its step, after the words saying where to run it, which they copy whole, and they tick each before they mark it done, or say they couldn't), ` +
  `or answer (one to ${INBOX_BOUNDS.MAX_FIELDS} typed fields, text, number, select with its options and the one you recommend, or boolean, each named by its label and required where it must be filled; ` +
  "or no fields for an answer in their own words); never end an answer with an optional free-text field, because the reply box under every ask already takes a note; " +
  "never ask for a credential or a secret in a form, since the answer reaches your transcript: " +
  "that is a do the developer does by hand. A post without ask asks nothing: something they should only know, or your reply on the thread. " +
  "It waits until they acknowledge it, which never reaches you unless they write something; " +
  `you may have at most ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} such posts waiting to be acknowledged, apart from your open asks. ` +
  "A thread holds one open ask, and a newer ask replaces it. " +
  "An answer to any ask, decide, do, or answer, always reaches you as a message. " +
  `You may hold at most ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} open asks. The call answers with your threads as they stand, each with the mention you name it by.`;

export const INBOX_TOOLS = {
  POST: {
    name: INBOX_TOOL.POST,
    description: POST_THREAD_WORDS,
    inputSchema: inboxThreadPostInputSchema,
  },
  WITHDRAW: {
    name: INBOX_TOOL.WITHDRAW,
    description:
      "Withdraw the open ask of one of your threads, by its key, with why: you no longer need it, you found the answer yourself, " +
      "or you checked that the to-do is done. The thread and its messages stay; refused where it holds no open ask, such as one already answered. " +
      "The call answers with your threads as they stand.",
    inputSchema: inboxWithdrawInputSchema,
  },
  READ: {
    name: INBOX_TOOL.READ,
    description:
      "Read your threads as they stand now, each with the mention you name it by: every one still asking, whole, and the latest settled ones by their last messages and their latest ask and answer; " +
      `a thread longer than ${INBOX_BOUNDS.MAX_MESSAGES_READ} messages reads its first, its open ask, and its latest ${INBOX_BOUNDS.MAX_MESSAGES_READ}. ` +
      "Each message reads in order with who wrote it, you or a member by name, the ask it ends with and where that stands " +
      "(open, answered, replaced by a newer ask, or withdrawn, with your reason), and the answer a member's message carries. " +
      "A member may close a thread without answering, which withdraws its ask with no reason, and closedBy names them; " +
      `where it held an ask open, that reaches you as a developer's message whose first line starts "${INBOX_CLOSE_LEAD}" and names the key: ` +
      "take it as their not wanting what the ask asked.",
    inputSchema: inboxReadInputSchema,
  },
} as const;

export type AgentAskLine =
  | InboxReadAsk
  | (Pick<InboxReadAsk, "type" | "status" | "withdrawnReason"> & {
      readonly steps?: readonly string[];
    });

interface AgentThreadLine {
  readonly from: string;
  readonly text: string;
  readonly files?: readonly string[];
  readonly ask?: AgentAskLine;
  readonly answers?: Omit<InboxAnswers, "ask">;
}

interface AgentInboxLine {
  readonly key: string;
  readonly title: string;
  readonly mention?: string;
  readonly status: InboxItem["status"];
  readonly earlier?: number;
  readonly thread: readonly AgentThreadLine[];
  readonly closedBy?: string;
  readonly closedReason?: string;
}

export interface ThreadPoster extends InboxAgent {
  readonly organizationId: string;
}

export type InboxToolResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly inbox: readonly AgentInboxLine[];
    }
  | {
      readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
      readonly reason: string;
      readonly inbox?: readonly AgentInboxLine[];
    };

export const INBOX_REFUSAL = {
  UNREADABLE_POST:
    "Not posted: the post does not read. key is a lowercase slug of letters, digits, dots, dashes, and underscores; " +
    `body is Markdown of at most ${INBOX_BOUNDS.MAX_MESSAGE_CHARS} characters; title is one line of at most ${INBOX_BOUNDS.MAX_TITLE_CHARS}; ` +
    `ask is decide with two to ${INBOX_BOUNDS.MAX_OPTIONS} options, do with at most ${INBOX_BOUNDS.MAX_STEPS} steps, ` +
    `or answer with one to ${INBOX_BOUNDS.MAX_FIELDS} fields or none.`,
  NO_TITLE:
    "Not posted: you have no thread under that key, and the first post under a key names its title.",
  TOO_MANY: `Not posted: you hold ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} open asks already. Withdraw one you no longer need first.`,
  TOO_MANY_NOTICES: `Not posted: the developer has ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} notices of yours to acknowledge. Follow up on one under its key, or wait until they do.`,
  TOO_MANY_PICTURES: `Not posted: a message draws at most ${INBOX_BOUNDS.MAX_MESSAGE_PICTURES} pictures from your sandbox.`,
  NO_OPTIONS: "Not posted: a decide's options each stand under a label of their own.",
  UNKNOWN_RECOMMENDATION: "Not posted: recommended names a label no option has.",
  SEVERAL_RECOMMENDED:
    "Not posted: recommended names each label once, and several only where multiple lets them pick several.",
  FIELD_LABELS: "Not posted: an answer names each field by a label of its own.",
  SELECT_OPTIONS:
    "Not posted: a select field offers its options, each once, and no other field offers options.",
  SELECT_RECOMMENDATION:
    "Not posted: a select field's recommended names one of its options, and no other field recommends one.",
  UNREADABLE_WITHDRAW: "Not withdrawn: name the thread's key and why you withdraw its ask.",
  NO_OPEN_ASK: "Not withdrawn: you have no thread under that key with an open ask.",
  NO_MEMBER:
    "Not posted: to names no member; write a member of your workspace by their mention link, [@Name](link), as a person's chip is written.",
  NO_ADDRESSEE: "Not posted: the member you addressed is not in your workspace.",
  ADDRESSEE_CANNOT_SEE:
    "Not posted: the member you addressed cannot see your task, so they would never see the thread; address someone who can, or leave to out.",
  NO_AGENT: "Not done: this conversation is no agent's.",
  UNAVAILABLE: "Not done: the service could not reach its store.",
} as const;

const SETTLED_MESSAGES_TOLD = 3;

const readPost = readEither(inboxThreadPostInputSchema, { excess: EXCESS_KEYS.DROP });
const readWithdraw = readEither(inboxWithdrawInputSchema, { excess: EXCESS_KEYS.DROP });

const PICTURE_REFUSALS: SandboxImageRefusals = {
  NO_FILE: "Not posted: a picture names no file in your sandbox:",
  NOT_IMAGE:
    "Not posted: a picture names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size:",
  TOO_LARGE: `Not posted: a picture names a file larger than ${MAX_PICTURE_MB} MB, or a video larger than ${MAX_VIDEO_MB} MB; render it smaller, or record a shorter flow:`,
  UNREADABLE: "Not posted: a picture's file could not be read from your sandbox:",
};

function writerOf(message: InboxMessage): string {
  if (message.author === INBOX_MESSAGE_AUTHOR.AGENT) return "you";
  return message.member?.name ?? "a former member";
}

export function askLineOf(ask: InboxReadAsk): AgentAskLine {
  if (ask.status === INBOX_ASK_STATUS.OPEN) return ask;
  return {
    type: ask.type,
    status: ask.status,
    ...(ask.withdrawnReason === undefined ? undefined : { withdrawnReason: ask.withdrawnReason }),
    ...(ask.status === INBOX_ASK_STATUS.ANSWERED && ask.type === INBOX_ASK.DO && "steps" in ask
      ? { steps: ask.steps }
      : undefined),
  };
}

export function answersLineOf(answers: InboxAnswers): Omit<InboxAnswers, "ask"> {
  const { ask: _ask, ...answered } = answers;
  return answered;
}

function threadLineOf(message: InboxMessage): AgentThreadLine {
  return {
    from: writerOf(message),
    text: message.text,
    ...(message.files === undefined
      ? undefined
      : { files: message.files.map((file) => file.name) }),
    ...(message.ask === undefined ? undefined : { ask: askLineOf(message.ask) }),
    ...(message.answers === undefined ? undefined : { answers: answersLineOf(message.answers) }),
  };
}

function closerOf(item: InboxItem): Pick<AgentInboxLine, "closedBy"> {
  if (item.status !== INBOX_STATUS.CLOSED) return {};
  if (item.closedBy !== undefined) return { closedBy: item.closedBy.name };
  return item.closedReason === undefined ? { closedBy: "a former member" } : {};
}

function settlementOf(item: InboxItem, messages: readonly InboxMessage[]): Partial<AgentInboxLine> {
  if (messages.some((message) => message.ask !== undefined || message.answers !== undefined)) {
    return {};
  }
  return item.closedReason === undefined ? {} : { closedReason: item.closedReason };
}

export function settledMessages(messages: readonly InboxMessage[]): readonly InboxMessage[] {
  const latest = (has: (message: InboxMessage) => boolean) => messages.findLast(has);
  const kept = new Set<InboxMessage | undefined>([
    latest((message) => message.ask !== undefined),
    latest((message) => message.answers !== undefined),
    ...messages.slice(-SETTLED_MESSAGES_TOLD),
  ]);
  return messages.filter((message) => kept.has(message));
}

function lineOf(item: InboxItem, mention: string | undefined): AgentInboxLine {
  const messages = item.thread ?? [];
  const open = item.status === INBOX_STATUS.OPEN;
  const told = open ? messages : settledMessages(messages);
  const earlier = messages.length - told.length;
  return {
    key: item.key,
    title: item.title,
    ...(mention === undefined ? undefined : { mention }),
    status: item.status,
    ...(earlier > 0 ? { earlier } : undefined),
    thread: told.map(threadLineOf),
    ...closerOf(item),
    ...settlementOf(item, messages),
  };
}

function inboxOf(
  items: readonly InboxItem[],
  mention: (item: InboxItem) => string | undefined,
): readonly AgentInboxLine[] {
  const order = [INBOX_STATUS.OPEN, INBOX_STATUS.ANSWERED, INBOX_STATUS.CLOSED];
  return order.flatMap((status) =>
    items.filter((item) => item.status === status).map((item) => lineOf(item, mention(item))),
  );
}

function inboxOwner(agent: InboxAgent): PageOwner {
  return agent.taskId === null
    ? { kind: PAGE_OWNER.AGENT, agentId: agent.agentId }
    : { kind: PAGE_OWNER.TASK, taskId: agent.taskId };
}

function itemMention(step: string, item: InboxItem): string {
  return mentionMarkdownLink(
    item.title,
    linkOf({ kind: LINK_PLACE.INBOX_ITEM, itemId: item.id }, step),
  );
}

function accepted(agent: InboxAgent): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  return Effect.zipWith(
    agentInboxItems(agent),
    pageStepOf(agent.userId, inboxOwner(agent)),
    (items, step) => ({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      inbox: inboxOf(items, (item) =>
        Option.isNone(step) ? undefined : itemMention(step.value, item),
      ),
    }),
  ).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

export function inboxRejected(reason: string): InboxToolResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

function distinct(labels: readonly string[]): boolean {
  return new Set(labels).size === labels.length;
}

function fieldsRefusal(fields: readonly InboxField[]): string | undefined {
  if (!distinct(fields.map((field) => field.label))) return INBOX_REFUSAL.FIELD_LABELS;
  for (const field of fields) {
    const options = field.options;
    const select = field.type === INBOX_FIELD.SELECT;
    if (select ? options === undefined || !distinct(options) : options !== undefined) {
      return INBOX_REFUSAL.SELECT_OPTIONS;
    }
    if (
      field.recommended !== undefined &&
      !(select && options?.includes(field.recommended) === true)
    ) {
      return INBOX_REFUSAL.SELECT_RECOMMENDATION;
    }
  }
  return undefined;
}

function askRefusal(ask: InboxAskInput | undefined): string | undefined {
  switch (ask?.type) {
    case INBOX_ASK.DECIDE: {
      const labels = ask.options.map((option) => option.label);
      if (!distinct(labels)) return INBOX_REFUSAL.NO_OPTIONS;
      const recommended = recommendedLabels(ask);
      if (!recommended.every((label) => labels.includes(label))) {
        return INBOX_REFUSAL.UNKNOWN_RECOMMENDATION;
      }
      if (!distinct(recommended) || (recommended.length > 1 && ask.multiple !== true)) {
        return INBOX_REFUSAL.SEVERAL_RECOMMENDED;
      }
      return undefined;
    }
    case INBOX_ASK.ANSWER:
      return ask.fields === undefined ? undefined : fieldsRefusal(ask.fields);
    default:
      return undefined;
  }
}

function storeRefusal(refusal: InboxPostRefusal): string {
  switch (refusal) {
    case INBOX_POST_REFUSAL.TOO_MANY_OPEN:
      return INBOX_REFUSAL.TOO_MANY;
    case INBOX_POST_REFUSAL.TOO_MANY_NOTICES:
      return INBOX_REFUSAL.TOO_MANY_NOTICES;
    case INBOX_POST_REFUSAL.NO_TITLE:
      return INBOX_REFUSAL.NO_TITLE;
    case INBOX_POST_REFUSAL.NO_AGENT:
      return INBOX_REFUSAL.NO_AGENT;
    case INBOX_POST_REFUSAL.NO_ADDRESSEE:
      return INBOX_REFUSAL.NO_ADDRESSEE;
    case INBOX_POST_REFUSAL.ADDRESSEE_CANNOT_SEE:
      return INBOX_REFUSAL.ADDRESSEE_CANNOT_SEE;
  }
}

function bodyPictures(
  body: string,
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<readonly InboxBodyPicture[], string>> {
  const paths = inboxSandboxPicturePaths(body);
  if (paths.length > INBOX_BOUNDS.MAX_MESSAGE_PICTURES) {
    return Effect.succeed(Result.fail(INBOX_REFUSAL.TOO_MANY_PICTURES));
  }
  return Effect.gen(function* () {
    const read: InboxBodyPicture[] = [];
    for (const path of paths) {
      const image = yield* readSandboxMedia(sandbox, CODER.CHECKOUT_PATH, path, PICTURE_REFUSALS);
      if (Result.isFailure(image)) return Result.fail(image.failure);
      read.push({ ...image.success, path, name: posix.basename(path) || path });
    }
    return Result.succeed(read);
  });
}

interface ThreadPlace {
  readonly addresseeId?: string;
}

function threadPost(post: InboxThreadPostInput, place: ThreadPlace) {
  const { ask, to: _to, ...written } = post;
  if (ask === undefined) return { ...written, ...place };
  return { ...written, ...place, ask: keptInboxAsk(ask), needsReply: true };
}

function addresseeOf(to: string): string | undefined {
  const [link] = mentionLinksIn(to);
  const whole = link !== undefined && link.start === 0 && link.end === to.length;
  const mention = decodeMention(whole ? link.target : to, null);
  return mention?.kind === MENTION_KIND.PERSON ? mention.userId : undefined;
}

function placeOf(post: InboxThreadPostInput): Result.Result<ThreadPlace, string> {
  if (post.to === undefined) return Result.succeed({});
  const addresseeId = addresseeOf(post.to.trim());
  return addresseeId === undefined
    ? Result.fail(INBOX_REFUSAL.NO_MEMBER)
    : Result.succeed({ addresseeId });
}

export function postToInbox(
  agent: ThreadPoster,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  const read = readPost(input);
  if (Result.isFailure(read)) return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_POST));
  const post = read.success;
  if (post.body.trim() === "") return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_POST));
  const refused = askRefusal(post.ask);
  if (refused !== undefined) return Effect.succeed(inboxRejected(refused));
  const place = placeOf(post);
  if (Result.isFailure(place)) return Effect.succeed(inboxRejected(place.failure));
  return Effect.gen(function* () {
    const pictures = yield* bodyPictures(post.body, sandbox);
    if (Result.isFailure(pictures)) return inboxRejected(pictures.failure);
    const thread = threadPost(post, place.success);
    const wasOpen = yield* threadStandsOpen(agent, thread.key);
    const posted = yield* postInboxThread(agent, thread, pictures.success);
    if (Result.isFailure(posted)) return inboxRejected(storeRefusal(posted.failure));
    const { organizationId } = agent;
    yield* afterResponse(
      "a thread's Slack DM",
      dmThreadPost({
        organizationId,
        item: posted.success,
        asked: post.ask !== undefined,
        wasOpen,
      }),
    );
    return yield* accepted(agent);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

export function withdrawAsk(
  agent: InboxAgent,
  input: UnparsedWireValue,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  const read = readWithdraw(input);
  if (Result.isFailure(read)) {
    return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_WITHDRAW));
  }
  const { key, reason } = read.success;
  return Effect.gen(function* () {
    const withdrawn = yield* closeInboxItem(agent, key, reason);
    if (Option.isNone(withdrawn)) return inboxRejected(INBOX_REFUSAL.NO_OPEN_ASK);
    yield* afterResponse("a withdrawn thread's Slack DM", settleThreadDms(withdrawn.value.id));
    return yield* accepted(agent);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

export function readOwnInbox(
  agent: InboxAgent,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  return accepted(agent);
}
