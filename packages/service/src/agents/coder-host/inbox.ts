import { posix } from "node:path";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  archiveChannel,
  CHANNEL_NAME_REFUSAL,
  CHANNEL_WRITE_REFUSAL,
  type ChannelRow,
  type ChannelWriteRefusal,
  createChannel,
  editChannel,
  listArchivedChannels,
  openChannels,
  resolveChannel,
  unarchiveChannel,
} from "@luke/database/models/channel-store";
import { GENERAL_CHANNEL } from "@luke/database/schemas/channel";
import { OPERATOR_NOTICE_KIND } from "@luke/database/storage-vocabulary";
import { isWireUuid } from "@luke/features";
import {
  CHANNEL_BOUNDS,
  CHANNEL_TOOL,
  type ChannelUpdateInput,
  channelCreateInputSchema,
  channelUpdateInputSchema,
  threadMoveInputSchema,
} from "@luke/features/channel-wire";
import { inboxSandboxPicturePaths } from "@luke/features/inbox-attachment-link";
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
} from "@luke/features/inbox-wire";
import { LINK_PLACE, linkOf, mentionMarkdownLink } from "@luke/features/link-grammar";
import { decodeMention, MENTION_KIND, mentionLinksIn } from "@luke/features/mention-link";
import { PAGE_OWNER, type PageOwner } from "@luke/features/page-wire";
import { readEither } from "@luke/wire/effect";
import { Data, DateTime, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "../../core.js";
import { logStoreFailure, type StoreFailure } from "../../http/store-failure.js";
import {
  agentInboxItems,
  agentThreadId,
  CHANNEL_MOVE_REFUSAL,
  closeInboxItem,
  INBOX_POST_REFUSAL,
  type InboxAgent,
  type InboxBodyPicture,
  type InboxPostRefusal,
  moveChannelThread,
  postInboxThread,
} from "../../inbox/inbox-store.js";
import { noticedForOperator } from "../operator-notice.js";
import { pageStepOf } from "../written-mentions.js";
import { CODER } from "./bounds.js";
import {
  type InboxSandboxDoor,
  readSandboxMedia,
  type SandboxImageRefusals,
} from "./inbox-image.js";

/**
 * inbox.ts -- the coding agent's thread and channel tools: post a message on a thread in one of its workspace's channels, withdraw a thread's open ask, read every thread back, make or change a channel, and move a thread into one.
 *
 * What an agent cannot do or decide alone, a product choice, an approval
 * of a risky step, a question, or something only the developer can do by
 * hand such as a setting on GitHub, and whatever is ready for the developer
 * to look at, review, or test by hand, such as a pull request, goes in a
 * thread rather than in a message, where it is lost in the transcript: a
 * thread of its own on the service (`inbox-store.ts`), posted to one of its
 * workspace's open channels, which every member reads, and drawn on the
 * agent's task as well. The agent chooses the channel per thread by
 * the purposes its tool's words list (`postThreadDescription`), names it
 * by name, `#` or not, and may address the thread's ask to a member by
 * their mention link; a name no open channel goes by and a link naming no
 * member are refused before the store is asked, and a thread naming none
 * goes to #general. The agent names each thread by a key of its own. A post is one
 * message on it, one Markdown body with its chips, its cards, and its
 * pictures where they belong, which may end with an ask, `decide`, `do`, or
 * `answer` (`@luke/features/inbox-wire`); the first post under a key opens
 * the thread and names its title, and a later one adds a message, its ask
 * replacing the one open. A picture is drawn in the body by the path of
 * its file in the agent's sandbox, a screenshot of what it rendered, which
 * a post reads there first (`inbox-image.ts`) and the store keeps as a file
 * of the message, writing its address in the path's place; a file that is
 * not there, not an image, or past the bound refuses the whole post with
 * the path named. A post that asks nothing is a note, or the agent's reply
 * on the thread, since replying never answers: a member's message on the
 * thread reaches the agent as one of the developer's messages, and so does
 * an answer it waits on. No call holds the turn, since a coder session
 * takes no input mid-turn (`brain-host/eve-sessions.ts`'s `requestInput`).
 * Every call answers with the agent's whole inbox as it stands, each
 * thread's messages in order with their asks and answers, so the model
 * holds its threads whatever its context has lost to compaction. A worker
 * gets none of these tools, because the developer answers the agent it
 * works for.
 *
 * An agent keeps its workspace's channels as a member does, on the
 * developer's account, and is refused as they are (`channel-store.ts`): it
 * makes one, renames it, edits its purpose, archives or unarchives it, each
 * naming the channel by its name rather than its id, and moves any thread
 * it may read into an open one, one of its own by its key, the same move a
 * member makes and a later post naming a channel makes
 * (`inbox-store.ts`'s `moveChannelThread`). Their words steer it to post
 * in the channels that stand, since a channel made per task is the noise
 * Chat was: a new one only for a lasting topic or a project of weeks no
 * open one covers, its purpose one line, and a project's archived once it
 * ships. A write answers the open channels as they then stand, and a move
 * the thread and where it now lives.
 */

/** The inbox's picture bound in megabytes, as the words the model reads say it. */
const MAX_PICTURE_MB = (INBOX_BOUNDS.MAX_IMAGE_BYTES / 1_000_000).toFixed(1);

/** The inbox's video bound in megabytes, as the words the model reads say it. */
const MAX_VIDEO_MB = (INBOX_BOUNDS.MAX_VIDEO_BYTES / 1_000_000).toFixed(1);

/** What `post_thread`'s words say before the workspace's channels. */
const POST_THREAD_WORDS =
  "Post a message on a thread in one of your workspace's channels, apart from your transcript. " +
  "Each post is one message on a thread under key, your own short lowercase slug such as branch-protection. " +
  "The first post under a key opens its thread and must name its title; a later post under the same key adds a message to that thread, never a second one, " +
  "and a title it names renames the thread only where the post asks. " +
  "channel is the open channel the thread goes to, by its name, such as general: choose one for each thread by what belongs in it. " +
  "A thread that names none goes to #general, and a later post under its key that names none leaves it where it stands; " +
  "a name no open channel of your workspace goes by, or an archived channel's, is refused. " +
  "to is the member the thread's ask is addressed to, by their mention link, the [@Name](link) you name a member by, and the ask waits on them; " +
  "without it, it waits on the task's assignee, or on the developer who started you. " +
  `body is the message, one Markdown body of at most ${INBOX_BOUNDS.MAX_MESSAGE_CHARS} characters. ` +
  "Write a file, a pull request, or an issue in it as a mention, such as [@store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), so Luke draws it as a chip. " +
  "Put a link alone on its own line to show it as a card: a pull request, an issue, a page such as the GitHub settings page a to-do is done on, " +
  "or the exact lines a decision is about, as a blob link into your repository at the full 40-character commit you read them at, one already on GitHub, " +
  `ending #L<start>-L<end>, at most ${INBOX_BOUNDS.MAX_CODE_LINES} lines, which they see as GitHub holds them at that commit. ` +
  `Draw a picture where it belongs, such as a screenshot of a UI you rendered, as ![alt](<path> "caption"): path is the file's path in your sandbox, ` +
  `relative to the checkout or absolute, a PNG, JPEG, or WebP of at most ${MAX_PICTURE_MB} MB, or a WebM video of at most ${MAX_VIDEO_MB} MB, such as a recording of a flow, which plays there, ` +
  `at most ${INBOX_BOUNDS.MAX_MESSAGE_PICTURES} a message; ` +
  "alt says in a sentence what it shows, and pictures written next to each other stand side by side. " +
  "ask is what the message asks of them, which ends it: " +
  `decide (two to ${INBOX_BOUNDS.MAX_OPTIONS} options, each a short label and an optional detail; name the label you recommend; multiple lets them pick several, and recommended then takes a list of the labels you recommend; ` +
  "for a go-ahead on one step you propose, two short options such as Approve and Request changes), " +
  "do (a to-do: something only they can do by hand, such as changing a GitHub setting, adding a secret, or testing by hand what you could not test yourself; " +
  `its steps, at most ${INBOX_BOUNDS.MAX_STEPS}, say exactly what to do, and they tick each before they mark it done, or say they couldn't), ` +
  `or answer (one to ${INBOX_BOUNDS.MAX_FIELDS} typed fields, text, number, select with its options and the one you recommend, or boolean, each named by its label and required where it must be filled; ` +
  "or no fields for an answer in their own words); never end an answer with an optional free-text field, because the reply box under every ask already takes a note; " +
  "never ask for a credential or a secret in a form, since the answer reaches your transcript: " +
  "that is a do the developer does by hand. A post without ask asks nothing: something they should only know, or your reply on the thread. " +
  "It waits until they acknowledge it, which never reaches you unless they write something; " +
  `you may have at most ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} such posts waiting to be acknowledged, apart from your open asks. ` +
  "A thread holds one open ask, and a newer ask replaces it. " +
  "An answer to decide or answer always reaches you as a message. " +
  "waits is for a do alone: whether you need to hear it is done as a message, only where you set it true; " +
  "a do you do not wait on is kept for you to read, though an answer carrying their words or a file still reaches you as a message. " +
  `You may hold at most ${INBOX_BOUNDS.MAX_OPEN_PER_AGENT} open asks. The call answers with your threads as they stand, each with the mention you name it by.`;

/** One open channel as the tool's words list it: its name and what belongs in it. */
type ListedChannel = Pick<ChannelRow, "name" | "purpose">;

/** What `create_channel`'s words say. */
const CREATE_CHANNEL_WORDS =
  "Make an open channel in your workspace, which every member reads and every agent may post to, as a member makes one. " +
  `Prefer a channel that stands: ${INBOX_TOOL.POST}'s words list the open ones with what belongs in each, and a thread goes in the one it fits best, or #general. ` +
  "Make a channel only for a lasting topic, or a project of several weeks, that none of them covers: never one per task, pull request, or thread, " +
  "and never one an open channel already covers under another name. " +
  `name is a lowercase slug of words joined by hyphens, such as release-notes, at most ${CHANNEL_BOUNDS.MAX_NAME_CHARS} characters, which no open channel goes by. ` +
  `purpose is one plain line of at most ${CHANNEL_BOUNDS.MAX_PURPOSE_CHARS} characters saying what belongs in it, which members and agents choose it by. ` +
  `project is true for one project's channel, which you archive with ${CHANNEL_TOOL.UPDATE} once the project ships; leave it out for a standing topic. ` +
  "The call answers with your workspace's open channels as they then stand.";

/** What `update_channel`'s words say. */
const UPDATE_CHANNEL_WORDS =
  "Change one channel of your workspace, open or archived, as a member does; what you leave out stands. " +
  "channel names it by its name, # or not; where an open channel and an archived one go by the same name, it names the open one, " +
  "so rename that first to reach the archived one. name renames it, to a lowercase slug no open channel goes by; " +
  "purpose replaces what belongs in it, in one plain line. " +
  "archived true archives it: its threads stay where they are, still readable, and its name is freed; archived false opens an archived channel again under its own name, " +
  "and an archived channel is renamed or given a purpose only in the call that opens it again. " +
  "Archive a project's channel once the project ships, and a channel nobody needs any more, rather than leaving it open. " +
  "#general, where every thread that names no channel goes, is never renamed or archived; its purpose may be edited. " +
  "The call answers with your workspace's open channels as they then stand.";

/** What `move_thread`'s words say. */
const MOVE_THREAD_WORDS =
  "Move a thread into another open channel of your workspace, where it belongs better, as a member moves one; its messages and asks stay as they are. " +
  `thread is one of your own threads by its key, or any thread you may read by its id, which ${INBOX_TOOL.READ} answers for each of yours and a thread's mention link ends with. ` +
  "channel names the open channel by its name, # or not. " +
  `A later ${INBOX_TOOL.POST} under your own thread's key that names a channel moves it too. ` +
  "The call answers with the thread and the channel it now lives in.";

/**
 * The words `post_thread` is shown with: how to post, then the workspace's
 * open channels with their purposes, for the agent to choose one by, where
 * any are listed. Note that the list is the one part that differs between
 * workspaces, and it closes the words, so what comes before it stays one
 * text for every agent.
 */
function postThreadDescription(channels: readonly ListedChannel[]): string {
  const listed =
    channels.length === 0
      ? ""
      : ` Your workspace's open channels, each with what belongs in it:\n${channels
          .map((channel) => `#${channel.name}: ${channel.purpose}`)
          .join("\n")}`;
  return `${POST_THREAD_WORDS}${listed}`;
}

/**
 * The tools as the model is shown them (`apps/dev/tools/`): each one's name,
 * words, and input. `post_thread`'s words here list no channel; an agent is
 * shown them with its workspace's (`postThreadDescription`).
 */
export const INBOX_TOOLS = {
  POST: {
    name: INBOX_TOOL.POST,
    description: postThreadDescription([]),
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
      "Read your threads, in whichever channel each was posted to, as they stand now, each with the mention you name it by: every one still asking, whole, and the latest settled ones by their last messages and their latest ask and answer; " +
      `a thread longer than ${INBOX_BOUNDS.MAX_MESSAGES_READ} messages reads its first, its open ask, and its latest ${INBOX_BOUNDS.MAX_MESSAGES_READ}. ` +
      "Each message reads in order with who wrote it, you or a member by name, the ask it ends with and where that stands " +
      "(open, answered, replaced by a newer ask, or withdrawn, with your reason), and the answer a member's message carries. " +
      "A member may close a thread without answering, which withdraws its ask with no reason, and closedBy names them; " +
      `where you waited on it, that reaches you as a developer's message whose first line starts "${INBOX_CLOSE_LEAD}" and names the key: ` +
      "take it as their not wanting what the ask asked. Read it before you rely on a do you posted without waits being done.",
    inputSchema: inboxReadInputSchema,
  },
  CREATE_CHANNEL: {
    name: CHANNEL_TOOL.CREATE,
    description: CREATE_CHANNEL_WORDS,
    inputSchema: channelCreateInputSchema,
  },
  UPDATE_CHANNEL: {
    name: CHANNEL_TOOL.UPDATE,
    description: UPDATE_CHANNEL_WORDS,
    inputSchema: channelUpdateInputSchema,
  },
  MOVE_THREAD: {
    name: CHANNEL_TOOL.MOVE,
    description: MOVE_THREAD_WORDS,
    inputSchema: threadMoveInputSchema,
  },
} as const;

/**
 * An ask as the agent reads it back: whole while it is open, since the
 * agent still acts on it, and once settled its type and where it stands,
 * and an answered `do`'s steps, which the answer names by their places alone.
 */
type AgentAskLine =
  | InboxReadAsk
  | (Pick<InboxReadAsk, "type" | "status" | "withdrawnReason"> & {
      readonly steps?: readonly string[];
    });

/** One message of a thread as the agent reads it back: who wrote it, you or a member by name, its words, its files by name, its ask, and the answer it carries. */
interface AgentThreadLine {
  readonly from: string;
  readonly text: string;
  readonly files?: readonly string[];
  readonly ask?: AgentAskLine;
  readonly answers?: Omit<InboxAnswers, "ask">;
}

/** One thread as the agent reads it back: its id and key, title, its mention, where it stands, whether the agent waits on its open ask, and its messages in order. */
interface AgentInboxLine {
  /** The thread's id, which `move_thread` names it by as well as by its key. */
  readonly id: string;
  readonly key: string;
  readonly title: string;
  /** The thread as the agent names it in its words, `[@title](link)`, which Luke draws as its chip; none where the member reads its workspace no longer. */
  readonly mention?: string;
  readonly status: InboxItem["status"];
  /** Whether an answer to the open ask reaches the agent as a message, on a thread still asking. */
  readonly waits?: boolean;
  /** How many earlier messages a settled thread's read leaves out. */
  readonly earlier?: number;
  readonly thread: readonly AgentThreadLine[];
  /** The member who closed the thread without answering, by name: a former member's where their account is gone. */
  readonly closedBy?: string;
  /** Why a thread whose messages ask nothing, a notice, was closed. */
  readonly closedReason?: string;
}

/** The agent a post is made as: its account, task, and id, and the workspace whose channels and members the post names. */
export interface ThreadPoster extends InboxAgent {
  readonly organizationId: string;
}

/** What a call answers, as the model reads it: the agent's inbox as it stands, or why the call did nothing beside it. */
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

/** One open channel as a channel tool answers it: its name, what belongs in it, and whether it is one project's. */
type AgentChannelLine = Pick<ChannelRow, "name" | "purpose" | "project">;

/** A thread a move answers: its id and title, and the channel it now lives in, by name. */
interface MovedThreadLine {
  readonly id: string;
  readonly title: string;
  readonly channel: string;
}

/** What a channel tool's call answers, as the model reads it: the open channels as they then stand, the thread a move moved, or why the call did nothing. */
export type ChannelToolResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly channels: readonly AgentChannelLine[];
    }
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly thread: MovedThreadLine;
    }
  | {
      readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
      readonly reason: string;
    };

/** Why a call did nothing, in the words the model reads. */
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
  NO_CHANNEL: "Not posted: that channel is archived, or not one of your workspace's.",
  UNKNOWN_CHANNEL: `Not posted: no open channel of your workspace goes by that name; name one ${INBOX_TOOL.POST}'s words list, or none for #general.`,
  ARCHIVED_CHANNEL: `Not posted: that channel is archived; name an open one ${INBOX_TOOL.POST}'s words list, or none for #general.`,
  NO_MEMBER:
    "Not posted: to names no member; write a member of your workspace by their mention link, [@Name](link), as a person's chip is written.",
  NO_ADDRESSEE: "Not posted: the member you addressed is not in your workspace.",
  NO_AGENT: "Not done: this conversation is no coding agent's.",
  UNAVAILABLE: "Not done: the service could not reach its store.",
} as const;

/** Why a channel tool's call did nothing, in the words the model reads. Nothing was written. */
export const CHANNEL_REFUSAL = {
  UNREADABLE_CREATE:
    `Not made: name is a lowercase slug of words joined by hyphens, such as release-notes, of at most ${CHANNEL_BOUNDS.MAX_NAME_CHARS} characters, ` +
    `and purpose one line of at most ${CHANNEL_BOUNDS.MAX_PURPOSE_CHARS}.`,
  UNREADABLE_UPDATE:
    "Not changed: channel names the channel by its name; name is a lowercase slug of words joined by hyphens, " +
    `purpose one line of at most ${CHANNEL_BOUNDS.MAX_PURPOSE_CHARS} characters, and archived true or false.`,
  NO_CHANGE: "Not changed: name, purpose, or archived says what changes.",
  UNREADABLE_MOVE:
    "Not moved: thread is your own thread's key or a thread's id, and channel an open channel's name.",
  NAME_TAKEN:
    "Not done: an open channel of your workspace already goes by that name; post to it, or choose another name.",
  UNKNOWN_CHANNEL: `Not done: no channel of your workspace goes by that name; ${INBOX_TOOL.POST}'s words list the open ones.`,
  ARCHIVED_CHANNEL: `Not changed: that channel is archived; set archived false in the same call to open it again.`,
  MOVE_ARCHIVED: `Not moved: that channel is archived; name an open one ${INBOX_TOOL.POST}'s words list, or open it again with ${CHANNEL_TOOL.UPDATE} first.`,
  GENERAL: `Not changed: #${GENERAL_CHANNEL.NAME} is never renamed or archived; only its purpose may be edited.`,
  NO_THREAD: "Not moved: no thread you may read goes by that key or id.",
  OTHER_WORKSPACE:
    "Not moved: that thread is another workspace's, and moves only between that workspace's channels.",
  NO_WORKSPACE: "Not done: the developer is no longer a member of this workspace.",
} as const;

/** How many of a settled thread's latest messages its read carries: enough to see what came of it. */
const SETTLED_MESSAGES_TOLD = 3;

const readPost = readEither(inboxThreadPostInputSchema, { excess: EXCESS_KEYS.DROP });
const readWithdraw = readEither(inboxWithdrawInputSchema, { excess: EXCESS_KEYS.DROP });

/** Why a post's picture was not read from the sandbox, in a post's own words; each is followed by the path. */
const PICTURE_REFUSALS: SandboxImageRefusals = {
  NO_FILE: "Not posted: a picture names no file in your sandbox:",
  NOT_IMAGE:
    "Not posted: a picture names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size:",
  TOO_LARGE: `Not posted: a picture names a file larger than ${MAX_PICTURE_MB} MB, or a video larger than ${MAX_VIDEO_MB} MB; render it smaller, or record a shorter flow:`,
  UNREADABLE: "Not posted: a picture's file could not be read from your sandbox:",
};

/** Who wrote a message, as the agent reads it: itself, or the member by name, or a former member whose account is gone. */
function writerOf(message: InboxMessage): string {
  if (message.author === INBOX_MESSAGE_AUTHOR.AGENT) return "you";
  return message.member?.name ?? "a former member";
}

/** An ask as the agent reads it back: whole while open, and its type and standing, with why it was withdrawn, once settled. */
function askLineOf(ask: InboxReadAsk): AgentAskLine {
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

/** An answer as the agent reads it back: how the member answered, without the id of the message it answers, which is the ask before it. */
function answersLineOf(answers: InboxAnswers): Omit<InboxAnswers, "ask"> {
  const { ask: _ask, ...answered } = answers;
  return answered;
}

/** One message of a thread as the agent reads it back, its files by name, since a member's reached it with their message and its own it sent. */
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

/**
 * Who closed an item without answering it, as the agent reads it: the
 * member by name. Note that the agent's own withdrawal always says why, so
 * a closed item without a reason or a member is one a member closed whose
 * account is gone.
 */
function closerOf(item: InboxItem): Pick<AgentInboxLine, "closedBy"> {
  if (item.status !== INBOX_STATUS.CLOSED) return {};
  if (item.closedBy !== undefined) return { closedBy: item.closedBy.name };
  return item.closedReason === undefined ? { closedBy: "a former member" } : {};
}

/**
 * Whether the item is a notice still open: a post that asked nothing,
 * waiting on the developer's nod alone, which the agent never hears, so it
 * reads as no ask of the agent's.
 */
function openNotice(item: InboxItem): boolean {
  return (
    item.status === INBOX_STATUS.OPEN &&
    !(item.thread ?? []).some((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)
  );
}

/**
 * What a thread no message asks or answers, a notice's, carries on itself
 * rather than on a message: why it was closed. Note that a thread that asks
 * carries it on its withdrawn ask, so it is not repeated there, and that a
 * notice's nod is its answered status alone.
 */
function settlementOf(item: InboxItem, messages: readonly InboxMessage[]): Partial<AgentInboxLine> {
  if (messages.some((message) => message.ask !== undefined || message.answers !== undefined)) {
    return {};
  }
  return item.closedReason === undefined ? {} : { closedReason: item.closedReason };
}

/**
 * The messages a settled thread's read carries: its latest few, and its
 * latest ask and latest answer however long ago, which say what came of it
 * once later words push them out, each in the thread's order.
 */
function settledMessages(messages: readonly InboxMessage[]): readonly InboxMessage[] {
  const latest = (has: (message: InboxMessage) => boolean) => messages.findLast(has);
  const kept = new Set<InboxMessage | undefined>([
    latest((message) => message.ask !== undefined),
    latest((message) => message.answers !== undefined),
    ...messages.slice(-SETTLED_MESSAGES_TOLD),
  ]);
  return messages.filter((message) => kept.has(message));
}

/**
 * A thread as the agent reads it back. Note that one still asking carries
 * its messages whole, as the read holds them, because compaction may have
 * taken the call that posted its ask out of the model's context and the
 * agent still acts on it; a settled one carries what `settledMessages`
 * keeps, and how many it leaves out.
 */
function lineOf(item: InboxItem, mention: string | undefined): AgentInboxLine {
  const messages = item.thread ?? [];
  const open = item.status === INBOX_STATUS.OPEN;
  const told = open ? messages : settledMessages(messages);
  const earlier = messages.length - told.length;
  return {
    id: item.id,
    key: item.key,
    title: item.title,
    ...(mention === undefined ? undefined : { mention }),
    status: item.status,
    ...(open && !openNotice(item) ? { waits: item.needsReply } : undefined),
    ...(earlier > 0 ? { earlier } : undefined),
    thread: told.map(threadLineOf),
    ...closerOf(item),
    ...settlementOf(item, messages),
  };
}

/**
 * The agent's inbox as it reads it: what is open first, then what was
 * answered, then what was closed, each the latest changed first. Note that
 * closed threads are read last, because they are settled without an answer
 * and the open and answered ones are what it acts on.
 */
function inboxOf(
  items: readonly InboxItem[],
  mention: (item: InboxItem) => string | undefined,
): readonly AgentInboxLine[] {
  const order = [INBOX_STATUS.OPEN, INBOX_STATUS.ANSWERED, INBOX_STATUS.CLOSED];
  return order.flatMap((status) =>
    items.filter((item) => item.status === status).map((item) => lineOf(item, mention(item))),
  );
}

/** What the agent's items stand on, as their links name it: its task, or the agent itself where it works on none. */
function inboxOwner(agent: InboxAgent): PageOwner {
  return agent.taskId === null
    ? { kind: PAGE_OWNER.AGENT, agentId: agent.agentId }
    : { kind: PAGE_OWNER.TASK, taskId: agent.taskId };
}

/** An item's mention under the workspace step given, by its link under its task, or under its agent where that works on no task. */
function itemMention(agent: InboxAgent, step: string, item: InboxItem): string {
  const place =
    agent.taskId === null
      ? { kind: LINK_PLACE.INBOX_ITEM, agentId: agent.agentId, itemId: item.id }
      : { kind: LINK_PLACE.INBOX_ITEM, planId: agent.taskId, itemId: item.id };
  return mentionMarkdownLink(item.title, linkOf(place, step));
}

/** The agent's inbox as the call answers it, each thread by the mention the agent writes it as. */
function accepted(agent: InboxAgent): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  return Effect.zipWith(
    agentInboxItems(agent),
    pageStepOf(agent.userId, inboxOwner(agent)),
    (items, step) => ({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      inbox: inboxOf(items, (item) =>
        Option.isNone(step) ? undefined : itemMention(agent, step.value, item),
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

/** Whether every label stands once. */
function distinct(labels: readonly string[]): boolean {
  return new Set(labels).size === labels.length;
}

/** An answer's fields' own refusal: a label used twice, a select with no options or one twice, options on a field that takes none, or a recommendation naming none of a select's options. */
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

/** An ask's own refusal, before the store is asked: a decide's label used twice, a recommendation naming none, one twice, or several where one may be picked, or an answer's fields. */
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

/** What the store's refusal of a post reads as to the model. */
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
    case INBOX_POST_REFUSAL.NO_CHANNEL:
      return INBOX_REFUSAL.NO_CHANNEL;
    case INBOX_POST_REFUSAL.NO_ADDRESSEE:
      return INBOX_REFUSAL.NO_ADDRESSEE;
  }
}

/**
 * Whether the agent hears the answer to an ask as a message: a decision or
 * an answer it asked for always, whatever the post says, since an agent
 * whose turn has ended reads nothing kept for it until something wakes it,
 * and the developer who answered would wait on it for ever; a to-do, which
 * it mostly needs only done, only where the post says it waits.
 */
function heardAnswer(ask: InboxAskInput, waits: boolean | undefined): boolean {
  return ask.type !== INBOX_ASK.DO || waits === true;
}

/**
 * The pictures the body draws from the sandbox, each read there under the
 * path it is written by and named by its file's own name, or the first
 * refusal among them. Each path is read once, in the order first drawn,
 * and the first path refused ends the reading, so a post with a picture to
 * mend reads no further file for it.
 */
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

/** A channel's name as an agent writes it, its ends trimmed and a leading `#` dropped. */
function channelNameOf(written: string): string {
  return written.trim().replace(/^#/u, "");
}

/** Where a post goes and whom it waits on, as the store takes them: the channel's id and the member's account, each absent where the post names none. */
interface ThreadPlace {
  readonly channelId?: string;
  readonly addresseeId?: string;
}

/** The post as the store writes it: its key, title, words, and ask as a message keeps it, whether the agent hears the answer (`heardAnswer`), and where it goes. */
function threadPost(post: InboxThreadPostInput, place: ThreadPlace) {
  const { waits, ask, channel: _channel, to: _to, ...written } = post;
  if (ask === undefined) return { ...written, ...place };
  return { ...written, ...place, ask: keptInboxAsk(ask), needsReply: heardAnswer(ask, waits) };
}

/** The member a post's `to` names by their mention link written whole, or its address alone, by account; nothing where it names no person, such as an agent or a task. */
function addresseeOf(to: string): string | undefined {
  const [link] = mentionLinksIn(to);
  const whole = link !== undefined && link.start === 0 && link.end === to.length;
  const mention = decodeMention(whole ? link.target : to, null);
  return mention?.kind === MENTION_KIND.PERSON ? mention.userId : undefined;
}

/**
 * Where a post goes and whom it waits on, or why it goes nowhere: the open
 * channel of the agent's workspace its name names, a leading `#` dropped,
 * refused where only an archived one goes by it or none does; and the
 * member its mention link names, refused where it names no person. Note
 * that whether that person is of the workspace is the store's to say, under
 * the lock it writes the post under (`postInboxThread`).
 */
function placeOf(
  agent: ThreadPoster,
  post: InboxThreadPostInput,
): Effect.Effect<Result.Result<ThreadPlace, string>, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const addresseeId = post.to === undefined ? undefined : addresseeOf(post.to.trim());
    if (post.to !== undefined && addresseeId === undefined) {
      return Result.fail(INBOX_REFUSAL.NO_MEMBER);
    }
    const addressed = addresseeId === undefined ? {} : { addresseeId };
    if (post.channel === undefined) return Result.succeed(addressed);
    const found = yield* resolveChannel(
      agent.userId,
      agent.organizationId,
      channelNameOf(post.channel),
    );
    if (Result.isFailure(found)) {
      return Result.fail(
        found.failure === CHANNEL_NAME_REFUSAL.ARCHIVED
          ? INBOX_REFUSAL.ARCHIVED_CHANNEL
          : INBOX_REFUSAL.UNKNOWN_CHANNEL,
      );
    }
    return Result.succeed({ ...addressed, channelId: found.success.id });
  });
}

/** Runs one post: where it goes, its pictures read from the sandbox, the message written on the thread under its key, and the agent's threads answered, or why not. */
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
  return Effect.gen(function* () {
    // A place refused is said before any picture is read, since mending it reads them again.
    const place = yield* placeOf(agent, post);
    if (Result.isFailure(place)) return inboxRejected(place.failure);
    const pictures = yield* bodyPictures(post.body, sandbox);
    if (Result.isFailure(pictures)) return inboxRejected(pictures.failure);
    const thread = threadPost(post, place.success);
    return yield* Effect.flatMap(postInboxThread(agent, thread, pictures.success), (posted) => {
      if (Result.isFailure(posted)) {
        return Effect.succeed(inboxRejected(storeRefusal(posted.failure)));
      }
      // A new ask waits on the member, so their operator is told of it once it is kept.
      const noticed =
        post.ask === undefined
          ? Effect.void
          : noticedForOperator(agent.agentId, OPERATOR_NOTICE_KIND.INBOX_ASK);
      return Effect.andThen(noticed, accepted(agent));
    });
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one withdrawal: the open ask of the thread under the key withdrawn with why, and the agent's inbox answered, or why not. */
export function withdrawAsk(
  agent: InboxAgent,
  input: UnparsedWireValue,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  const read = readWithdraw(input);
  if (Result.isFailure(read)) {
    return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_WITHDRAW));
  }
  const { key, reason } = read.success;
  return Effect.flatMap(closeInboxItem(agent, key, reason), (withdrawn) =>
    Option.isNone(withdrawn)
      ? Effect.succeed(inboxRejected(INBOX_REFUSAL.NO_OPEN_ASK))
      : accepted(agent),
  ).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/**
 * `post_thread`'s words as the agent is shown them: with its workspace's
 * open channels and their purposes, #general minted first where it has none
 * yet; without them where they cannot be read, which is logged, so the
 * agent is still offered the tool.
 */
export function postThreadWordsFor(
  agent: Pick<ThreadPoster, "userId" | "organizationId">,
): Effect.Effect<string, never, DatabaseServices> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const channels = yield* openChannels(agent.userId, agent.organizationId, now);
    return postThreadDescription(channels);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(INBOX_TOOLS.POST.description)),
  );
}

/** Runs one read: the agent's inbox as it stands. */
export function readOwnInbox(
  agent: InboxAgent,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  return accepted(agent);
}

const readCreate = readEither(channelCreateInputSchema, { excess: EXCESS_KEYS.DROP });
const readUpdate = readEither(channelUpdateInputSchema, { excess: EXCESS_KEYS.DROP });
const readMove = readEither(threadMoveInputSchema, { excess: EXCESS_KEYS.DROP });

/** A channel change refused inside its transaction, its words for the model, which takes every write of the change back. */
class ChannelChangeRefused extends Data.TaggedError("ChannelChangeRefused")<{
  readonly reason: string;
}> {}

function channelRejected(reason: string): ChannelToolResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** What the store's refusal of a channel write reads as to the model. */
function writeRefusal(refusal: ChannelWriteRefusal): string {
  switch (refusal) {
    case CHANNEL_WRITE_REFUSAL.NOT_FOUND:
      return CHANNEL_REFUSAL.UNKNOWN_CHANNEL;
    case CHANNEL_WRITE_REFUSAL.NAME_TAKEN:
      return CHANNEL_REFUSAL.NAME_TAKEN;
    case CHANNEL_WRITE_REFUSAL.GENERAL:
      return CHANNEL_REFUSAL.GENERAL;
  }
}

/** A store write's outcome inside a change, its refusal failing the change so nothing of it stands. */
function written<A>(
  outcome: Result.Result<A, ChannelWriteRefusal>,
): Effect.Effect<A, ChannelChangeRefused> {
  return Result.isFailure(outcome)
    ? Effect.fail(new ChannelChangeRefused({ reason: writeRefusal(outcome.failure) }))
    : Effect.succeed(outcome.success);
}

/** The workspace's open channels as a channel tool answers them, #general minted first where it has none yet. */
function channelsAnswered(
  agent: ThreadPoster,
): Effect.Effect<ChannelToolResult, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const rows = yield* openChannels(agent.userId, agent.organizationId, now);
    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      channels: rows.map(({ name, purpose, project }) => ({ name, purpose, project })),
    };
  });
}

/** A channel tool's run with its refusals answered as the model reads them, and a store failure as the service's own. */
function settled(
  run: Effect.Effect<ChannelToolResult, StoreFailure | ChannelChangeRefused, DatabaseServices>,
): Effect.Effect<ChannelToolResult, never, DatabaseServices> {
  return run.pipe(
    Effect.catchTag("ChannelChangeRefused", (refused) =>
      Effect.succeed(channelRejected(refused.reason)),
    ),
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(channelRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one `create_channel`: the channel made in the agent's workspace, and its open channels answered, or why not. */
export function createAgentChannel(
  agent: ThreadPoster,
  input: UnparsedWireValue,
): Effect.Effect<ChannelToolResult, never, DatabaseServices> {
  const read = readCreate(input);
  if (Result.isFailure(read)) {
    return Effect.succeed(channelRejected(CHANNEL_REFUSAL.UNREADABLE_CREATE));
  }
  const { name, purpose, project = false } = read.success;
  return settled(
    Effect.gen(function* () {
      const now = yield* DateTime.nowAsDate;
      const draft = { name, purpose, project };
      const made = yield* createChannel(agent.userId, agent.organizationId, draft, now);
      if (Result.isFailure(made)) {
        return channelRejected(
          made.failure === CHANNEL_WRITE_REFUSAL.NOT_FOUND
            ? CHANNEL_REFUSAL.NO_WORKSPACE
            : writeRefusal(made.failure),
        );
      }
      return yield* channelsAnswered(agent);
    }),
  );
}

/** A channel of the agent's workspace by the name it wrote: its id, and whether it is archived, the latest archived where only archived ones go by it; nothing where none does. */
function namedChannel(
  agent: ThreadPoster,
  name: string,
): Effect.Effect<
  Option.Option<{ readonly id: string; readonly archived: boolean }>,
  StoreFailure,
  DatabaseServices
> {
  return Effect.gen(function* () {
    const open = yield* resolveChannel(agent.userId, agent.organizationId, name);
    if (Result.isSuccess(open)) return Option.some({ id: open.success.id, archived: false });
    if (open.failure === CHANNEL_NAME_REFUSAL.UNKNOWN) return Option.none();
    const archived = yield* listArchivedChannels(agent.userId, agent.organizationId);
    const latest = archived.find((channel) => channel.name === name);
    return latest === undefined ? Option.none() : Option.some({ id: latest.id, archived: true });
  });
}

/**
 * Every change an update asks of the channel, written in one transaction,
 * so either all of it stands or none does: an archived channel opened
 * first, where it asks, since only an open one is edited, then its name and
 * purpose, then its archive. Note that an edit of an archived channel the
 * call does not open is refused, and so is an archive of #general before
 * its edit is written.
 */
function changeChannel(
  agent: ThreadPoster,
  channel: { readonly id: string; readonly archived: boolean; readonly name: string },
  update: ChannelUpdateInput,
): Effect.Effect<void, StoreFailure | ChannelChangeRefused, DatabaseServices> {
  const { userId, organizationId } = agent;
  const { name, purpose, archived } = update;
  const edits = name !== undefined || purpose !== undefined;
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (channel.archived && archived !== false) {
          if (edits) {
            return yield* new ChannelChangeRefused({ reason: CHANNEL_REFUSAL.ARCHIVED_CHANNEL });
          }
          return;
        }
        if (archived === true && channel.name === GENERAL_CHANNEL.NAME) {
          return yield* new ChannelChangeRefused({ reason: CHANNEL_REFUSAL.GENERAL });
        }
        if (channel.archived) {
          yield* written(yield* unarchiveChannel(userId, organizationId, channel.id));
        }
        if (edits) {
          yield* written(yield* editChannel(userId, organizationId, channel.id, { name, purpose }));
        }
        if (archived === true) {
          const now = yield* DateTime.nowAsDate;
          yield* written(yield* archiveChannel(userId, organizationId, channel.id, now));
        }
      }),
    ),
  );
}

/** Runs one `update_channel`: the channel the name names, open or archived, renamed, given a purpose, archived, or opened again, and the open channels answered, or why not. */
export function updateAgentChannel(
  agent: ThreadPoster,
  input: UnparsedWireValue,
): Effect.Effect<ChannelToolResult, never, DatabaseServices> {
  const read = readUpdate(input);
  if (Result.isFailure(read)) {
    return Effect.succeed(channelRejected(CHANNEL_REFUSAL.UNREADABLE_UPDATE));
  }
  const update = read.success;
  if (update.name === undefined && update.purpose === undefined && update.archived === undefined) {
    return Effect.succeed(channelRejected(CHANNEL_REFUSAL.NO_CHANGE));
  }
  const name = channelNameOf(update.channel);
  return settled(
    Effect.gen(function* () {
      const found = yield* namedChannel(agent, name);
      if (Option.isNone(found)) return channelRejected(CHANNEL_REFUSAL.UNKNOWN_CHANNEL);
      yield* changeChannel(agent, { ...found.value, name }, update);
      return yield* channelsAnswered(agent);
    }),
  );
}

/**
 * The id of the thread a move names: the agent's own under the key, or else
 * the thread the words name by its id, whether the agent may read it being
 * the move's own to say; nothing where the words are neither. Note that an
 * id is held to a UUID's shape, since the id column refuses any other text.
 */
function movedThreadId(
  agent: ThreadPoster,
  written: string,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  const thread = written.trim();
  return Effect.map(agentThreadId(agent, thread), (own) => {
    if (Option.isSome(own)) return own;
    const id = thread.toLowerCase();
    return isWireUuid(id) ? Option.some(id) : Option.none();
  });
}

/** Runs one `move_thread`: the thread the agent may read moved into the open channel the name names, and the thread answered where it now lives, or why not. */
export function moveAgentThread(
  agent: ThreadPoster,
  input: UnparsedWireValue,
): Effect.Effect<ChannelToolResult, never, DatabaseServices> {
  const read = readMove(input);
  if (Result.isFailure(read)) {
    return Effect.succeed(channelRejected(CHANNEL_REFUSAL.UNREADABLE_MOVE));
  }
  const name = channelNameOf(read.success.channel);
  return settled(
    Effect.gen(function* () {
      const channel = yield* resolveChannel(agent.userId, agent.organizationId, name);
      if (Result.isFailure(channel)) {
        return channelRejected(
          channel.failure === CHANNEL_NAME_REFUSAL.ARCHIVED
            ? CHANNEL_REFUSAL.MOVE_ARCHIVED
            : CHANNEL_REFUSAL.UNKNOWN_CHANNEL,
        );
      }
      const itemId = yield* movedThreadId(agent, read.success.thread);
      if (Option.isNone(itemId)) return channelRejected(CHANNEL_REFUSAL.NO_THREAD);
      const moved = yield* moveChannelThread(agent.userId, itemId.value, channel.success.id);
      if (Result.isFailure(moved)) {
        // Note that the channel was found open in the agent's workspace, so one the move refuses is not the thread's.
        return channelRejected(
          moved.failure === CHANNEL_MOVE_REFUSAL.NO_THREAD
            ? CHANNEL_REFUSAL.NO_THREAD
            : CHANNEL_REFUSAL.OTHER_WORKSPACE,
        );
      }
      const thread = { id: moved.success.id, title: moved.success.title, channel: name };
      return { status: ACTION_RESULT_STATUS.ACCEPTED, thread };
    }),
  );
}
