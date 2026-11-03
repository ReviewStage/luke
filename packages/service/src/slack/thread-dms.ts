/**
 * thread-dms.ts -- our Slack bot writing a member the threads that wait on them, and rewriting each once its ask settles.
 *
 * An agent's post that opens a thread, or asks anew on one, is written by
 * the bot to the member it waits on (`WAITS_ON`: the member it is addressed
 * to, else its task's assignee, else the agent's starter), where the
 * workspace's bot is connected, the member's email matches someone in its
 * team, and the member's own switch is on (`slackNotificationsOn`). Once a
 * thread has a DM, every later post of the agent's on it that waits on the
 * same member is a reply in that DM's Slack thread, whether it asks or not;
 * before then, a follow-up that asks nothing new on a thread still open
 * writes nothing. Nothing written back in Slack reaches the thread.
 * The DM says the thread's title, the post's words as Slack draws
 * Markdown (`slackMarkdownBlock`), and an
 * open button to the thread; a decide ask that takes one option offers each
 * as a button beside it (`SlackChoice`), which our Slack route answers the
 * ask with (`slack-events-app.ts`), and every other ask is the link alone.
 *
 * Each DM, a reply among them, is kept on the agent's message it said
 * (`inbox_message.slack_dm`), with the member it went to and, for a reply,
 * the DM whose thread it stands in. Once the message's ask is answered,
 * withdrawn, or replaced, `settleThreadDms` rewrites the DM to say so and
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
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
  knownAsk,
} from "@repo/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@repo/features/link-grammar";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import {
  type SlackBlock,
  SlackBot,
  type SlackMessage,
  type SlackMessageContent,
} from "./slack-bot.js";
import { slackClipped, slackMarkdownBlock } from "./slack-markdown.js";

/** Slack's own limits a DM's parts are clipped to: a header's text and a button's. */
const SLACK_TEXT_BOUND = { HEADER: 150, BUTTON: 75 } as const;

/** What a settled DM says in its button's place, by where its ask now stands. */
const SETTLED_LINE = {
  [INBOX_ASK_STATUS.ANSWERED]: `Answered in ${PRODUCT_NAME}`,
  [INBOX_ASK_STATUS.WITHDRAWN]: "Withdrawn",
  [INBOX_ASK_STATUS.REPLACED]: "Replaced by a newer ask",
} as const;

/** Where a settled ask stands: every status but open. */
type SettledAskStatus = keyof typeof SETTLED_LINE;

/** What a settled DM says once its member chose an option from it. */
export function chosenLine(label: string): string {
  return `You chose ${label}`;
}

/**
 * What an option's button carries back when pressed: the item, the message
 * whose ask it answers, and the option's label, as JSON in the button's
 * value, which Slack bounds at 2,000 characters, far past two ids and a label.
 */
export const SlackChoiceSchema = Schema.fromJsonString(
  Schema.Struct({ item: Schema.String, ask: Schema.String, choice: Schema.String }),
);

/** A press of an option's button, as `SlackChoiceSchema` reads it. */
export type SlackChoice = typeof SlackChoiceSchema.Type;

const SETTLED_STATUSES = [
  INBOX_ASK_STATUS.ANSWERED,
  INBOX_ASK_STATUS.WITHDRAWN,
  INBOX_ASK_STATUS.REPLACED,
] as const satisfies readonly SettledAskStatus[];

/** What a DM about a thread is drawn from: its title, the agent's words in Markdown, and the thread's link. */
interface ThreadDmView {
  readonly title: string;
  readonly text: string;
  readonly link: string;
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

/**
 * A button per option of an open decide ask that takes one, the recommended
 * ones primary, each under an action id of its own, which the route answers
 * the ask under, so a press Slack sends again is the same answer; none for
 * any other ask, or one that takes several, which the app alone answers.
 */
function choiceButtons(itemId: string, message: InboxMessage): SlackBlock[] {
  if (message.ask === undefined || message.ask.status !== INBOX_ASK_STATUS.OPEN) return [];
  const ask = knownAsk(message.ask);
  if (ask?.type !== INBOX_ASK.DECIDE || ask.multiple === true) return [];
  const recommended = new Set([
    ...(ask.recommended === undefined ? [] : [ask.recommended]),
    ...(ask.recommendations ?? []),
  ]);
  return ask.options.map(({ label }) => ({
    type: "button",
    text: { type: "plain_text", text: slackClipped(label, SLACK_TEXT_BOUND.BUTTON) },
    action_id: randomUUID(),
    value: Schema.encodeSync(SlackChoiceSchema)({ item: itemId, ask: message.id, choice: label }),
    ...(recommended.has(label) ? { style: "primary" } : undefined),
  }));
}

/**
 * The DM a thread is written as: its title as the header, the agent's words
 * in a `markdown` block, and the open
 * button after any option's; a settled one says where its ask stands, in
 * the line given, above the button.
 */
function threadDmContent(
  view: ThreadDmView,
  line?: string,
  choices: readonly SlackBlock[] = [],
): SlackMessageContent {
  const title = slackClipped(view.title, SLACK_TEXT_BOUND.HEADER);
  const words = view.text.trim();
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: title } },
    ...(words === "" ? [] : [slackMarkdownBlock(words)]),
    ...(line === undefined
      ? []
      : [{ type: "context", elements: [{ type: "plain_text", text: line }] }]),
    {
      type: "actions",
      elements: [
        ...choices,
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

/** The item's newest DM that opened a Slack thread, a reply's own left out, settled or not. */
const findThreadDm = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ dm: SlackDmSchema }),
  execute: (itemId) =>
    Database.use((db) =>
      db
        .select({ dm: inboxMessage.slackDm })
        .from(inboxMessage)
        .where(
          and(
            eq(inboxMessage.itemId, itemId),
            isNotNull(inboxMessage.slackDm),
            sql`${inboxMessage.slackDm} ->> 'thread' is null`,
          ),
        )
        .orderBy(desc(inboxMessage.createdAt))
        .limit(1),
    ),
});

/**
 * The DMs of the item's messages whose ask has settled, each marked settled
 * as it is read, with the message's words and where its ask stands. Note
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
          status: sql<string>`${inboxMessage.ask} ->> 'status'`,
        });
    }),
});

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
 * Rewrites one DM the bot wrote about the item's message to say the line
 * given in its buttons' place, as a press on an ask already settled is
 * told; nothing where the runtime holds no bot or the item is gone.
 */
export function rewriteThreadDm(
  dm: SlackMessage,
  itemId: string,
  message: { readonly text: string },
  line: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const bot = yield* Effect.serviceOption(SlackBot);
    if (Option.isNone(bot) || !bot.value.configured) return;
    const place = yield* findItemPlace(itemId);
    if (Option.isNone(place)) return;
    const view = {
      title: place.value.title,
      text: message.text,
      link: threadLink(itemId, place.value),
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
      ({ id, dm, text, status }) =>
        bot.value.update(
          dm.channel,
          dm.ts,
          threadDmContent(
            { title, text, link },
            id === chosen?.messageId ? chosen.line : SETTLED_LINE[status],
          ),
        ),
      { discard: true },
    );
  });
}

/**
 * Writes the member the post's thread waits on, as a reply in the thread's
 * DM to them where it has one, else where the post opened the thread or
 * asks anew on it, and keeps the DM on the post's message; first rewrites
 * the DMs of the asks the post replaced. Nothing where the runtime holds
 * no bot, the post is a follow-up on a thread with no DM to that member,
 * the thread waits on nobody, or the member turned their switch off.
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
    const thread = Option.getOrUndefined(
      Option.filter(yield* findThreadDm(item.id), ({ dm }) => dm.to === recipient),
    )?.dm;
    // A post opens a DM where it asks anew or none stood open; a follow-up does neither, but replies in a DM there is.
    if (thread === undefined && post.wasOpen && !post.asked) return;
    const place = yield* findItemPlace(item.id);
    if (Option.isNone(place)) return;
    const view = { title: item.title, text: message.text, link: threadLink(item.id, place.value) };
    const content = threadDmContent(view, undefined, choiceButtons(item.id, message));
    const sent = yield* bot.value.dm(organizationId, recipient, content, thread);
    if (Option.isNone(sent)) return;
    const dm = {
      ...sent.value,
      to: recipient,
      ...(thread === undefined ? {} : { thread: thread.ts }),
    };
    yield* recordDm({ messageId: message.id, dm });
  });
}
