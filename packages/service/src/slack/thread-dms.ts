/**
 * thread-dms.ts -- our Slack bot writing a member the threads that wait on them, and rewriting each once its ask settles.
 *
 * An agent's post that opens a thread, or asks anew on one, is written by
 * the bot to the member it waits on (`WAITS_ON`: the member it is addressed
 * to, else its task's assignee, else the agent's starter), where the
 * workspace's bot is connected, the member's email matches someone in its
 * team, and the member's own switch is on (`slackNotificationsOn`). A
 * follow-up that asks nothing new on a thread still open writes nothing.
 * The DM says the thread's title, the post's words as plain text, and an
 * open button to the thread; a decide ask's options are not
 * buttons yet, so every ask is the link alone.
 *
 * The DM is kept on the agent's message (`inbox_message.slack_dm`). Once
 * the message's ask is answered, withdrawn, or replaced, `settleThreadDms`
 * rewrites the DM to say so and forgets it, so it is rewritten once.
 *
 * Every call here waits on Slack, so each is handed to `afterResponse` by
 * its caller and never yielded inside a transaction; a runtime that holds
 * no bot, a test's or an eve root's, writes nothing.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { Database } from "@repo/database/core/query";
import { slackNotificationsOn } from "@repo/database/models/slack-installation-store";
import { organization } from "@repo/database/schemas/auth";
import { inboxItem } from "@repo/database/schemas/inbox";
import { inboxMessage } from "@repo/database/schemas/inbox-message";
import {
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
} from "@repo/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@repo/features/link-grammar";
import { linkLabels } from "@repo/features/mention-link";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { type SlackBlock, SlackBot, type SlackMessageContent } from "./slack-bot.js";

/** Slack's own limits a DM's parts are clipped to: a header's text and a section's. */
const SLACK_TEXT_BOUND = { HEADER: 150, SECTION: 3_000 } as const;

/** What a settled DM says in its button's place, by where its ask now stands. */
const SETTLED_LINE = {
  [INBOX_ASK_STATUS.ANSWERED]: `Answered in ${PRODUCT_NAME}`,
  [INBOX_ASK_STATUS.WITHDRAWN]: "Withdrawn",
  [INBOX_ASK_STATUS.REPLACED]: "Replaced by a newer ask",
} as const;

/** Where a settled ask stands: every status but open. */
type SettledAskStatus = keyof typeof SETTLED_LINE;

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

/** The words clipped to the bound, an ellipsis where they ran past it. */
function clipped(words: string, bound: number): string {
  return words.length <= bound ? words : `${words.slice(0, bound - 1)}…`;
}

/**
 * The DM a thread is written as: its title as the header, the agent's words
 * as plain text with each link written as its name, and the open
 * button; a settled one says where its ask stands above the button.
 */
function threadDmContent(
  view: ThreadDmView,
  settled?: SettledAskStatus,
): SlackMessageContent {
  const title = clipped(view.title, SLACK_TEXT_BOUND.HEADER);
  const words = clipped(linkLabels(view.text).trim(), SLACK_TEXT_BOUND.SECTION);
  const line = settled === undefined ? undefined : SETTLED_LINE[settled];
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: title } },
    ...(words === "" ? [] : [{ type: "section", text: { type: "plain_text", text: words } }]),
    ...(line === undefined
      ? []
      : [{ type: "context", elements: [{ type: "plain_text", text: line }] }]),
    {
      type: "actions",
      elements: [
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

/** What an item's DMs are drawn with beside a message's words: its title, its agent, and its workspace's slug, which its links are written under. */
const findItemPlace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ title: Schema.String, agentId: Schema.String, step: Schema.String }),
  execute: (itemId) =>
    Database.use((db) =>
      db
        .select({ title: inboxItem.title, agentId: inboxItem.agentId, step: organization.slug })
        .from(inboxItem)
        .innerJoin(organization, eq(organization.id, inboxItem.organizationId))
        .where(eq(inboxItem.id, itemId)),
    ),
});

const SlackDmSchema = Schema.Struct({ channel: Schema.String, ts: Schema.String });

const recordDm = SqlSchema.void({
  Request: Schema.Struct({ messageId: Schema.String, dm: SlackDmSchema }),
  execute: ({ messageId, dm }) =>
    Database.use((db) =>
      db.update(inboxMessage).set({ slackDm: dm }).where(eq(inboxMessage.id, messageId)),
    ),
});

/**
 * The DMs of the item's messages whose ask has settled, each forgotten as it
 * is read, with the message's words and where its ask stands. Note that the
 * outer statement asks again that a DM stands, because a second caller
 * blocked on the row rechecks it once the first commits and so takes none,
 * and no DM is rewritten twice.
 */
const claimSettledDms = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
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
            isNotNull(inboxMessage.slackDm),
            sql`${inboxMessage.ask} ->> 'status' <> ${INBOX_ASK_STATUS.OPEN}`,
          ),
        )
        .as("settled");
      return db
        .update(inboxMessage)
        .set({ slackDm: null })
        .from(settled)
        .where(and(eq(inboxMessage.id, settled.id), isNotNull(inboxMessage.slackDm)))
        .returning({
          dm: settled.dm,
          text: inboxMessage.text,
          status: sql<string>`${inboxMessage.ask} ->> 'status'`,
        });
    }),
});

/** The item's link under its agent, whichever task that works on, as its other links name it. */
function threadLink(itemId: string, place: { readonly agentId: string; readonly step: string }) {
  return linkOf({ kind: LINK_PLACE.INBOX_ITEM, agentId: place.agentId, itemId }, place.step);
}

/** Whether the agent's item under the key stands open, read before a post so the post's DM tells a follow-up from a thread opened. */
export function threadStandsOpen(
  agent: { readonly userId: string; readonly agentId: string },
  key: string,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.map(findOpenItem({ ...agent, key }), Option.isSome);
}

/**
 * Rewrites every DM of the item whose ask has settled to say where it
 * stands, as `threadDmContent` draws it, and forgets it; nothing where the
 * runtime holds no bot.
 */
export function settleThreadDms(
  itemId: string,
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
      ({ dm, text, status }) =>
        bot.value.update(dm.channel, dm.ts, threadDmContent({ title, text, link }, status)),
      { discard: true },
    );
  });
}

/**
 * Writes the member the post's thread waits on, where the post opened the
 * thread or asks anew on it, and keeps the DM on the post's message; first
 * rewrites the DMs of the asks the post replaced. Nothing where the
 * runtime holds no bot, the post is a follow-up, the thread waits on
 * nobody, or the member turned their switch off.
 */
export function dmThreadPost(
  post: ThreadDmPost,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const bot = yield* Effect.serviceOption(SlackBot);
    if (Option.isNone(bot) || !bot.value.configured) return;
    const { item, organizationId } = post;
    yield* settleThreadDms(item.id);
    const message = openingMessage(item);
    // A post opens the thread where it asks anew or none stood open; a follow-up does neither.
    if ((post.wasOpen && !post.asked) || message === undefined) return;
    const recipient = item.waitsOn?.userId;
    if (recipient === undefined || !(yield* slackNotificationsOn(recipient))) return;
    const place = yield* findItemPlace(item.id);
    if (Option.isNone(place)) return;
    const view = { title: item.title, text: message.text, link: threadLink(item.id, place.value) };
    const sent = yield* bot.value.dm(organizationId, recipient, threadDmContent(view));
    if (Option.isSome(sent)) yield* recordDm({ messageId: message.id, dm: sent.value });
  });
}
