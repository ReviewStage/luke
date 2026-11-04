/**
 * thread-dms.ts -- our Slack bot writing a member the threads that wait on them, and rewriting each once its ask settles.
 *
 * An agent's post that opens a thread, or asks anew on one, is written by
 * the bot to the member it waits on (`WAITS_ON`: the member it is addressed
 * to, else its task's assignee, else the agent's starter), where the
 * workspace's bot is connected, the member's email matches someone in its
 * team, and the member's own switch is on (`slackNotificationsOn`). The bot
 * writes them a DM that says the thread's title alone, and the post as the
 * first reply in that DM's Slack thread; every later post of the agent's on
 * it that waits on the same member is another reply there, whether it asks
 * or not, so the title is said once. Before the thread has a DM, a follow-up
 * that asks nothing new on a thread still open writes nothing. A member's
 * reply in a DM's Slack thread is found back to its thread by that DM
 * (`threadDmAt`) and posted there as their own reply
 * (`slack-agent-starts.ts`).
 * Each reply says the post's words as Slack draws Markdown
 * (`slackMarkdownBlock`), and an
 * open button to the thread; a decide ask that takes one option offers each
 * as a button beside it (`SlackChoice`), and one that takes several offers
 * them as checkboxes with a Submit button, whose press names the ticked ones
 * by their place among the options (`SLACK_PICKS_ACTION`); a do ask's steps
 * are listed under the words, numbered, with Mark done, which ticks every
 * step, and Couldn't do it beside the open button. Our Slack route answers
 * the ask with any of these (`slack-events-app.ts`), and every other ask is
 * the link alone.
 *
 * Each reply is kept on the agent's message it said
 * (`inbox_message.slack_dm`), with the member it went to and the title DM
 * whose thread it stands in; a DM written before the title stood alone kept
 * the post's words itself, and no thread. The pictures and recordings the post
 * carried follow it as files shared under that DM's Slack thread
 * (`SlackBot.upload`), each read as the member it went to reads it. Once
 * the message's ask is answered, withdrawn, or replaced, `settleThreadDms` rewrites the DM to say so and
 * marks it settled, so it is rewritten once and still found as the thread's.
 *
 * Every call here waits on Slack, so each is handed to `afterResponse` by
 * its caller and never yielded inside a transaction; a runtime that holds
 * no bot, a test's or an eve root's, writes nothing.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { Database } from "@repo/database/core/query";
import { slackNotificationsOn } from "@repo/database/models/slack-installation-store";
import { organization } from "@repo/database/schemas/auth";
import { inboxItem } from "@repo/database/schemas/inbox";
import { inboxMessage } from "@repo/database/schemas/inbox-message";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  knownAsk,
} from "@repo/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@repo/features/link-grammar";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { readInboxAttachment } from "../inbox/inbox-store.js";
import {
  type SlackBlock,
  SlackBot,
  type SlackMessage,
  type SlackMessageContent,
  type SlackUpload,
} from "./slack-bot.js";
import { slackClipped, slackMarkdownBlock } from "./slack-markdown.js";

/** Slack's own limits a DM's parts are clipped to: a header's text, a button's, and a checkbox's. */
const SLACK_TEXT_BOUND = { HEADER: 150, BUTTON: 75, OPTION: 75 } as const;

/** What a checkbox says after its label, in parentheses, where the agent recommends it. */
const RECOMMENDED_NOTE = " (Recommended)";

/** The words on the button that answers an ask taking several options with the ones ticked. */
const SUBMIT_LABEL = "Submit";

/**
 * The action id of the checkboxes an ask taking several options is drawn
 * with, which the route reads the ticked ones under in a press's state;
 * each checkbox's value is its option's place among the ask's options.
 */
export const SLACK_PICKS_ACTION = "picks";

/** The answers a do ask's buttons give: Mark done and Couldn't do it. */
const SLACK_DO_REPLIES = [INBOX_REPLY.DONE, INBOX_REPLY.NOT_DONE] as const;

/** A do ask's answer as its button gives it. */
type SlackDoReply = (typeof SLACK_DO_REPLIES)[number];

/** The words on a do ask's buttons, by the answer each gives, as the app words them. */
const DO_BUTTON = {
  [INBOX_REPLY.DONE]: "Mark done",
  [INBOX_REPLY.NOT_DONE]: "Couldn't do it",
} as const satisfies Record<SlackDoReply, string>;

/** What a settled DM says once its member answered its do ask from it, by the answer. */
const DO_LINE = {
  [INBOX_REPLY.DONE]: "You marked it done",
  [INBOX_REPLY.NOT_DONE]: "You couldn't do it",
} as const satisfies Record<SlackDoReply, string>;

/** The indent that keeps a step's later lines, a fenced block's among them, inside its numbered item. */
const STEP_INDENT = "   ";

/** What a settled DM says in its button's place, by where its ask now stands. */
const SETTLED_LINE = {
  [INBOX_ASK_STATUS.ANSWERED]: `Answered in ${PRODUCT_NAME}`,
  [INBOX_ASK_STATUS.WITHDRAWN]: "Withdrawn",
  [INBOX_ASK_STATUS.REPLACED]: "Replaced by a newer ask",
} as const;

/** Where a settled ask stands: every status but open. */
type SettledAskStatus = keyof typeof SETTLED_LINE;

/** What a settled DM says once its member chose options from it. */
export function chosenLine(labels: readonly string[]): string {
  return `You chose ${labels.join(", ")}`;
}

/** What a settled DM says once its member answered its do ask from it. */
export function doneLine(reply: SlackDoReply): string {
  return DO_LINE[reply];
}

/**
 * What a button carries back when pressed: the item, the message whose ask
 * it answers, and an option's label, or a do ask's answer, or neither for
 * the Submit of an ask taking several, whose picks the press's checkboxes
 * hold; as JSON in the button's value, which Slack bounds at 2,000
 * characters, far past two ids and a label.
 */
export const SlackChoiceSchema = Schema.fromJsonString(
  Schema.Struct({
    item: Schema.String,
    ask: Schema.String,
    choice: Schema.optionalKey(Schema.String),
    reply: Schema.optionalKey(Schema.Literals(SLACK_DO_REPLIES)),
  }),
);

/** A press of an option's button, a do ask's, or a Submit, as `SlackChoiceSchema` reads it. */
export type SlackChoice = typeof SlackChoiceSchema.Type;

/** What an open ask is drawn with in its DM: blocks of their own above the buttons, and buttons beside the open one. */
interface AskControls {
  readonly blocks: readonly SlackBlock[];
  readonly buttons: readonly SlackBlock[];
}

const NO_CONTROLS: AskControls = { blocks: [], buttons: [] };

const SETTLED_STATUSES = [
  INBOX_ASK_STATUS.ANSWERED,
  INBOX_ASK_STATUS.WITHDRAWN,
  INBOX_ASK_STATUS.REPLACED,
] as const satisfies readonly SettledAskStatus[];

/** What a reply about a thread is drawn from: its title, which Slack's notification says, the agent's words in Markdown, the thread's link, and whether it stands alone, a DM from before the title did, so says the title as its header. */
interface ThreadDmView {
  readonly title: string;
  readonly text: string;
  readonly link: string;
  readonly titled?: boolean;
}

/** A post as `dmThreadPost` reads it: the agent's workspace, the item as the post wrote it, whether the post asked, and whether its thread stood open before it (`threadStandsOpen`). */
interface ThreadDmPost {
  readonly organizationId: string;
  readonly item: InboxItem;
  readonly asked: boolean;
  readonly wasOpen: boolean;
}

/**
 * The agent's message a post that opens a thread wrote: the one whose ask
 * the item holds open, or for a notice, the agent's latest. Note that the
 * ask is looked for first, because two messages written in one millisecond
 * read in no order of their own.
 */
function openingMessage(item: InboxItem): InboxMessage | undefined {
  const thread = item.thread ?? [];
  const asking = thread.find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN);
  return asking ?? thread.findLast((message) => message.author === INBOX_MESSAGE_AUTHOR.AGENT);
}

/** The agent's message the post wrote: the ask it opened where it asked, else the agent's latest. */
function postedMessage(item: InboxItem, asked: boolean): InboxMessage | undefined {
  return asked
    ? openingMessage(item)
    : item.thread?.findLast((message) => message.author === INBOX_MESSAGE_AUTHOR.AGENT);
}

/** A do ask's steps, as the message's ask names them; none for any other ask. */
function askSteps(ask: InboxReadAsk | undefined): readonly string[] {
  const known = ask === undefined ? undefined : knownAsk(ask);
  return known?.type === INBOX_ASK.DO ? known.steps : [];
}

/** The agent's words with a do ask's steps listed under them, numbered, each step's later lines kept inside its item. */
function wordsWithSteps(text: string, steps: readonly string[]): string {
  if (steps.length === 0) return text;
  const list = steps.map(
    (step, at) => `${at + 1}. ${step.trim().replaceAll("\n", `\n${STEP_INDENT}`)}`,
  );
  return [text.trim(), ...list].filter((part) => part !== "").join("\n\n");
}

/**
 * The controls of an open decide ask: a button per option where it takes
 * one, the recommended ones primary, each under an action id of its own,
 * which the route answers the ask under, so a press Slack sends again is the
 * same answer; where it takes several, a checkbox per option, the
 * recommended ones saying so in parentheses after the label, and a Submit
 * button under an action id of its own on the same terms. An open do ask's
 * Mark done and Couldn't do it, each under an action id of its own. None for
 * any other ask.
 */
function askControls(itemId: string, message: InboxMessage): AskControls {
  if (message.ask === undefined || message.ask.status !== INBOX_ASK_STATUS.OPEN) {
    return NO_CONTROLS;
  }
  const ask = knownAsk(message.ask);
  if (ask?.type === INBOX_ASK.DO) {
    const buttons = SLACK_DO_REPLIES.map((reply) => ({
      type: "button",
      text: { type: "plain_text", text: DO_BUTTON[reply] },
      action_id: randomUUID(),
      value: Schema.encodeSync(SlackChoiceSchema)({ item: itemId, ask: message.id, reply }),
      ...(reply === INBOX_REPLY.DONE ? { style: "primary" } : undefined),
    }));
    return { blocks: [], buttons };
  }
  if (ask?.type !== INBOX_ASK.DECIDE) return NO_CONTROLS;
  const recommended = new Set([
    ...(ask.recommended === undefined ? [] : [ask.recommended]),
    ...(ask.recommendations ?? []),
  ]);
  const value = (choice?: string) =>
    Schema.encodeSync(SlackChoiceSchema)({
      item: itemId,
      ask: message.id,
      ...(choice === undefined ? undefined : { choice }),
    });
  if (ask.multiple !== true) {
    const buttons = ask.options.map(({ label }) => ({
      type: "button",
      text: { type: "plain_text", text: slackClipped(label, SLACK_TEXT_BOUND.BUTTON) },
      action_id: randomUUID(),
      value: value(label),
      ...(recommended.has(label) ? { style: "primary" } : undefined),
    }));
    return { blocks: [], buttons };
  }
  // Note that a recommended label is clipped short of its note, so the note always shows.
  const options = ask.options.map(({ label }, index) => {
    const note = recommended.has(label) ? RECOMMENDED_NOTE : "";
    const text = `${slackClipped(label, SLACK_TEXT_BOUND.OPTION - note.length)}${note}`;
    return { text: { type: "plain_text", text }, value: String(index) };
  });
  return {
    blocks: [
      {
        type: "actions",
        elements: [{ type: "checkboxes", action_id: SLACK_PICKS_ACTION, options }],
      },
    ],
    buttons: [
      {
        type: "button",
        text: { type: "plain_text", text: SUBMIT_LABEL },
        action_id: randomUUID(),
        value: value(),
        style: "primary",
      },
    ],
  };
}

/** The DM a thread's Slack thread stands under: its title alone, as the header. */
function titleDmContent(title: string): SlackMessageContent {
  const header = slackClipped(title, SLACK_TEXT_BOUND.HEADER);
  return { text: title, blocks: [{ type: "header", text: { type: "plain_text", text: header } }] };
}

/**
 * The reply a post is written as under its thread's title DM: the agent's
 * words in a `markdown` block, any checkboxes of its ask, and the open
 * button after any other button of its ask; a settled one says where its ask
 * stands, in the line given, above the button. Note that the title is left
 * out of the blocks, since the DM above says it, and kept in the text Slack
 * notifies with, which says no thread of its own; a DM that stands alone
 * keeps it as its header.
 */
function threadDmContent(
  view: ThreadDmView,
  line?: string,
  controls: AskControls = NO_CONTROLS,
): SlackMessageContent {
  const words = view.text.trim();
  const blocks: SlackBlock[] = [
    ...(view.titled === true ? titleDmContent(view.title).blocks : []),
    ...(words === "" ? [] : [slackMarkdownBlock(words)]),
    ...(line === undefined
      ? []
      : [{ type: "context", elements: [{ type: "plain_text", text: line }] }]),
    ...controls.blocks,
    {
      type: "actions",
      elements: [
        ...controls.buttons,
        {
          type: "button",
          text: { type: "plain_text", text: `Open in ${PRODUCT_NAME}` },
          url: view.link,
        },
      ],
    },
  ];
  return { text: line === undefined ? view.title : `${view.title} · ${line}`, blocks };
}

/** Whether the agent's item under the key stands open: an ask waiting, or a notice waiting on the nod. */
const findOpenItem = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, key: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId, key }) =>
    Database.use((db) =>
      db
        .select({ id: inboxItem.id })
        .from(inboxItem)
        .where(
          and(
            eq(inboxItem.userId, userId),
            eq(inboxItem.agentId, agentId),
            eq(inboxItem.key, key),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
          ),
        ),
    ),
});

/** What an item's DMs are drawn with beside a message's words: its title, its agent, and its workspace, by id and by the slug its links are written under. */
const findItemPlace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({
    title: Schema.String,
    agentId: Schema.String,
    organizationId: Schema.String,
    step: Schema.String,
  }),
  execute: (itemId) =>
    Database.use((db) =>
      db
        .select({
          title: inboxItem.title,
          agentId: inboxItem.agentId,
          organizationId: inboxItem.organizationId,
          step: organization.slug,
        })
        .from(inboxItem)
        .innerJoin(organization, eq(organization.id, inboxItem.organizationId))
        .where(eq(inboxItem.id, itemId)),
    ),
});

/** A DM as a message keeps it: where it is, the member it went to, the DM whose thread a reply stands in, and whether its ask has settled. */
const SlackDmSchema = Schema.Struct({
  channel: Schema.String,
  ts: Schema.String,
  to: Schema.optionalKey(Schema.String),
  thread: Schema.optionalKey(Schema.String),
  settled: Schema.optionalKey(Schema.Boolean),
});

/** The DM kept on a message, by the message's id; nothing where none was written. */
const findMessageDm = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ dm: SlackDmSchema }),
  execute: (messageId) =>
    Database.use((db) =>
      db
        .select({ dm: inboxMessage.slackDm })
        .from(inboxMessage)
        .where(and(eq(inboxMessage.id, messageId), isNotNull(inboxMessage.slackDm))),
    ),
});

const recordDm = SqlSchema.void({
  Request: Schema.Struct({ messageId: Schema.String, dm: SlackDmSchema }),
  execute: ({ messageId, dm }) =>
    Database.use((db) =>
      db.update(inboxMessage).set({ slackDm: dm }).where(eq(inboxMessage.id, messageId)),
    ),
});

/** Whether a message holds a DM its ask has not yet settled. */
function unsettledDm() {
  return and(
    isNotNull(inboxMessage.slackDm),
    sql`coalesce((${inboxMessage.slackDm} ->> 'settled')::boolean, false) = false`,
  );
}

/** The item's newest DM, settled or not, whose Slack thread a later post replies in. */
const findLatestDm = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ dm: SlackDmSchema }),
  execute: (itemId) =>
    Database.use((db) =>
      db
        .select({ dm: inboxMessage.slackDm })
        .from(inboxMessage)
        .where(and(eq(inboxMessage.itemId, itemId), isNotNull(inboxMessage.slackDm)))
        .orderBy(desc(inboxMessage.createdAt))
        .limit(1),
    ),
});

/** The DM that opened a DM's Slack thread: the one its reply stands under, or the DM itself where it stood alone. */
function threadRoot(dm: typeof SlackDmSchema.Type) {
  return { channel: dm.channel, ts: dm.thread ?? dm.ts, to: dm.to };
}

/** A DM of the item's in the Slack thread under the DM that opened it, by that DM's conversation and timestamp: its item, that item's workspace, and the DM as kept. */
const findDmAt = SqlSchema.findOneOption({
  Request: Schema.Struct({ channel: Schema.String, ts: Schema.String }),
  Result: Schema.Struct({
    itemId: Schema.String,
    organizationId: Schema.String,
    dm: SlackDmSchema,
  }),
  execute: ({ channel, ts }) =>
    Database.use((db) =>
      db
        .select({
          itemId: inboxMessage.itemId,
          organizationId: inboxItem.organizationId,
          dm: inboxMessage.slackDm,
        })
        .from(inboxMessage)
        .innerJoin(inboxItem, eq(inboxItem.id, inboxMessage.itemId))
        .where(
          and(
            sql`${inboxMessage.slackDm} ->> 'channel' = ${channel}`,
            sql`coalesce(${inboxMessage.slackDm} ->> 'thread', ${inboxMessage.slackDm} ->> 'ts') = ${ts}`,
          ),
        )
        .orderBy(desc(inboxMessage.createdAt))
        .limit(1),
    ),
});

/**
 * The DMs of the item's messages whose ask has settled, each marked settled
 * as it is read, with the message's words, a do ask's steps, and where its ask stands. Note
 * that the outer statement asks again that a DM is unsettled, because a
 * second caller blocked on the row rechecks it once the first commits and
 * so takes none, and no DM is rewritten twice.
 */
const claimSettledDms = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    id: Schema.String,
    dm: SlackDmSchema,
    text: Schema.String,
    steps: Schema.NullOr(Schema.Array(Schema.String)),
    status: Schema.Literals(SETTLED_STATUSES),
  }),
  execute: (itemId) =>
    Database.use((db) => {
      const settled = db
        .select({ id: inboxMessage.id, dm: inboxMessage.slackDm })
        .from(inboxMessage)
        .where(
          and(
            eq(inboxMessage.itemId, itemId),
            unsettledDm(),
            sql`${inboxMessage.ask} ->> 'status' <> ${INBOX_ASK_STATUS.OPEN}`,
          ),
        )
        .as("settled");
      return db
        .update(inboxMessage)
        .set({ slackDm: sql`${inboxMessage.slackDm} || '{"settled":true}'::jsonb` })
        .from(settled)
        .where(and(eq(inboxMessage.id, settled.id), unsettledDm()))
        .returning({
          id: inboxMessage.id,
          dm: settled.dm,
          text: inboxMessage.text,
          steps: sql<unknown>`case when ${inboxMessage.ask} ->> 'type' = ${INBOX_ASK.DO} then ${inboxMessage.ask} -> 'steps' end`,
          status: sql<string>`${inboxMessage.ask} ->> 'status'`,
        });
    }),
});

/** The files the agent's message carried, its pictures and recordings, read as the member it went to reads them, in the order they were attached; one gone since is left out. */
function messageUploads(
  userId: string,
  itemId: string,
  message: InboxMessage,
): Effect.Effect<readonly SlackUpload[], StoreFailure, DatabaseServices> {
  return Effect.map(
    Effect.forEach(message.files ?? [], (file) =>
      Effect.map(
        readInboxAttachment(userId, itemId, file.attachmentId),
        Option.map((read): SlackUpload => ({ name: file.name, bytes: read.bytes })),
      ),
    ),
    (read) => read.flatMap((one) => (Option.isSome(one) ? [one.value] : [])),
  );
}

/** The item's link by its id alone, whose agent and task a reader asks the service for. */
function threadLink(itemId: string, place: { readonly step: string }) {
  return linkOf({ kind: LINK_PLACE.INBOX_ITEM, itemId }, place.step);
}

/** Whether the agent's item under the key stands open, read before a post so the post's DM tells a follow-up from a thread opened. */
export function threadStandsOpen(
  agent: { readonly userId: string; readonly agentId: string },
  key: string,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.map(findOpenItem({ ...agent, key }), Option.isSome);
}

/** The workspace an item is in, which a press from Slack finds its member under; nothing for an item that is gone. */
export function itemWorkspace(
  itemId: string,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return Effect.map(
    findItemPlace(itemId),
    Option.map((place) => place.organizationId),
  );
}

/**
 * The thread a Slack thread stands under where its first message is a DM
 * the bot wrote about one: the item, its workspace, and the member the DM
 * went to, where it was kept; nothing for any other Slack thread.
 */
export function threadDmAt(
  channel: string,
  threadTs: string,
): Effect.Effect<
  Option.Option<{
    readonly itemId: string;
    readonly organizationId: string;
    readonly to: string | undefined;
  }>,
  StoreFailure,
  DatabaseServices
> {
  return Effect.map(
    findDmAt({ channel, ts: threadTs }),
    Option.map(({ itemId, organizationId, dm }) => ({ itemId, organizationId, to: dm.to })),
  );
}

/**
 * Rewrites one DM the bot wrote about the item's message to say the line
 * given in its buttons' place, as a press on an ask already settled is
 * told, keeping the title of one that stands alone; nothing where the
 * runtime holds no bot or the item is gone.
 */
export function rewriteThreadDm(
  dm: SlackMessage,
  itemId: string,
  message: {
    readonly id: string;
    readonly text: string;
    readonly ask?: InboxReadAsk | undefined;
  },
  line: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const bot = yield* Effect.serviceOption(SlackBot);
    if (Option.isNone(bot) || !bot.value.configured) return;
    const place = yield* findItemPlace(itemId);
    if (Option.isNone(place)) return;
    const kept = yield* findMessageDm(message.id);
    const view = {
      title: place.value.title,
      text: wordsWithSteps(message.text, askSteps(message.ask)),
      link: threadLink(itemId, place.value),
      titled: Option.isSome(kept) && kept.value.dm.thread === undefined,
    };
    yield* bot.value.update(dm.channel, dm.ts, threadDmContent(view, line));
  });
}

/** Where the ask a press named stands, as its DM says it: settled as the line says, or no longer the thread's open ask. */
export function settledLine(
  status: (typeof INBOX_ASK_STATUS)[keyof typeof INBOX_ASK_STATUS] | undefined,
): string {
  return status === undefined || status === INBOX_ASK_STATUS.OPEN
    ? `No longer open in ${PRODUCT_NAME}`
    : SETTLED_LINE[status];
}

/**
 * Rewrites every DM of the item whose ask has settled to say where it
 * stands, as `threadDmContent` draws it, and forgets it; nothing where the
 * runtime holds no bot. The message `chosen` names, the one a press from
 * Slack answered, says its own line instead, the option chosen.
 */
export function settleThreadDms(
  itemId: string,
  chosen?: { readonly messageId: string; readonly line: string },
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const bot = yield* Effect.serviceOption(SlackBot);
    if (Option.isNone(bot) || !bot.value.configured) return;
    const claimed = yield* claimSettledDms(itemId);
    if (claimed.length === 0) return;
    const place = yield* findItemPlace(itemId);
    if (Option.isNone(place)) return;
    const { title } = place.value;
    const link = threadLink(itemId, place.value);
    yield* Effect.forEach(
      claimed,
      ({ id, dm, text, steps, status }) =>
        bot.value.update(
          dm.channel,
          dm.ts,
          threadDmContent(
            {
              title,
              text: wordsWithSteps(text, steps ?? []),
              link,
              titled: dm.thread === undefined,
            },
            id === chosen?.messageId ? chosen.line : SETTLED_LINE[status],
          ),
        ),
      { discard: true },
    );
  });
}

/**
 * Writes the member the post's thread waits on, as a reply in the thread's
 * DM to them where it has one, else, where the post opened the thread or
 * asks anew on it, as the first reply under a new DM saying the thread's
 * title; keeps the reply on the post's message, and first rewrites the DMs
 * of the asks the post replaced. Nothing where the runtime holds no bot,
 * the post is a follow-up on a thread with no DM to that member, the thread
 * waits on nobody, or the member turned their switch off.
 */
export function dmThreadPost(
  post: ThreadDmPost,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const bot = yield* Effect.serviceOption(SlackBot);
    if (Option.isNone(bot) || !bot.value.configured) return;
    const { item, organizationId } = post;
    yield* settleThreadDms(item.id);
    const message = postedMessage(item, post.asked);
    const recipient = item.waitsOn?.userId;
    if (message === undefined || recipient === undefined) return;
    if (!(yield* slackNotificationsOn(recipient))) return;
    const kept = Option.getOrUndefined(
      Option.filter(
        Option.map(yield* findLatestDm(item.id), ({ dm }) => threadRoot(dm)),
        (root) => root.to === recipient,
      ),
    );
    // A post opens a DM where it asks anew or none stood open; a follow-up does neither, but replies in a DM there is.
    if (kept === undefined && post.wasOpen && !post.asked) return;
    const place = yield* findItemPlace(item.id);
    if (Option.isNone(place)) return;
    const opened =
      kept === undefined
        ? yield* bot.value.dm(organizationId, recipient, titleDmContent(item.title))
        : Option.some(kept);
    if (Option.isNone(opened)) return;
    const thread = { channel: opened.value.channel, ts: opened.value.ts };
    // Note that a new title DM is kept settled until its reply takes its place, so a failed reply leaves it the thread's, never rewritten.
    if (kept === undefined) {
      yield* recordDm({ messageId: message.id, dm: { ...thread, to: recipient, settled: true } });
    }
    const view = {
      title: item.title,
      text: wordsWithSteps(message.text, askSteps(message.ask)),
      link: threadLink(item.id, place.value),
    };
    const content = threadDmContent(view, undefined, askControls(item.id, message));
    const sent = yield* bot.value.dm(organizationId, recipient, content, thread);
    if (Option.isNone(sent)) return;
    yield* recordDm({
      messageId: message.id,
      dm: { ...sent.value, to: recipient, thread: thread.ts },
    });
    const uploads = yield* messageUploads(recipient, item.id, message);
    yield* bot.value.upload(thread.channel, thread.ts, uploads);
  });
}
