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
  type SlackBotService,
  type SlackMessage,
  type SlackMessageContent,
  type SlackUpload,
} from "./slack-bot.js";
import { slackClipped, slackMarkdownBlock } from "./slack-markdown.js";

const SLACK_TEXT_BOUND = { HEADER: 150, BUTTON: 75, OPTION: 75 } as const;

const TITLE_PREFIX = "📥 ";

const OPEN_ASK_PREVIEW_CHARS = 500;

const RECOMMENDED_NOTE = " (Recommended)";

const SUBMIT_LABEL = "Submit";

export const SLACK_PICKS_ACTION = "picks";

const SLACK_DO_REPLIES = [INBOX_REPLY.DONE, INBOX_REPLY.NOT_DONE] as const;

type SlackDoReply = (typeof SLACK_DO_REPLIES)[number];

const DO_BUTTON = {
  [INBOX_REPLY.DONE]: "Mark done",
  [INBOX_REPLY.NOT_DONE]: "Couldn't do it",
} as const satisfies Record<SlackDoReply, string>;

const DO_LINE = {
  [INBOX_REPLY.DONE]: "You marked it done",
  [INBOX_REPLY.NOT_DONE]: "You couldn't do it",
} as const satisfies Record<SlackDoReply, string>;

const STEP_INDENT = "   ";

const SETTLED_LINE = {
  [INBOX_ASK_STATUS.ANSWERED]: `Answered in ${PRODUCT_NAME}`,
  [INBOX_ASK_STATUS.WITHDRAWN]: "Withdrawn",
  [INBOX_ASK_STATUS.REPLACED]: "Replaced by a newer ask",
} as const;

type SettledAskStatus = keyof typeof SETTLED_LINE;

export function chosenLine(labels: readonly string[]): string {
  return `You chose ${labels.join(", ")}`;
}

export function doneLine(reply: SlackDoReply): string {
  return DO_LINE[reply];
}

export const SlackChoiceSchema = Schema.fromJsonString(
  Schema.Struct({
    item: Schema.String,
    ask: Schema.String,
    choice: Schema.optionalKey(Schema.String),
    reply: Schema.optionalKey(Schema.Literals(SLACK_DO_REPLIES)),
  }),
);

export type SlackChoice = typeof SlackChoiceSchema.Type;

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

interface ThreadDmView {
  readonly title: string;
  readonly text: string;
  readonly link: string;
  readonly titled?: boolean;
}

interface ThreadDmPost {
  readonly organizationId: string;
  readonly item: InboxItem;
  readonly asked: boolean;
  readonly wasOpen: boolean;
}

function openingMessage(item: InboxItem): InboxMessage | undefined {
  const thread = item.thread ?? [];
  const asking = thread.find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN);
  return asking ?? thread.findLast((message) => message.author === INBOX_MESSAGE_AUTHOR.AGENT);
}

function postedMessage(item: InboxItem, asked: boolean): InboxMessage | undefined {
  return asked
    ? openingMessage(item)
    : item.thread?.findLast((message) => message.author === INBOX_MESSAGE_AUTHOR.AGENT);
}

function askSteps(ask: InboxReadAsk | undefined): readonly string[] {
  const known = ask === undefined ? undefined : knownAsk(ask);
  return known?.type === INBOX_ASK.DO ? known.steps : [];
}

function wordsWithSteps(text: string, steps: readonly string[]): string {
  if (steps.length === 0) return text;
  const list = steps.map(
    (step, at) => `${at + 1}. ${step.trim().replaceAll("\n", `\n${STEP_INDENT}`)}`,
  );
  return [text.trim(), ...list].filter((part) => part !== "").join("\n\n");
}

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

function titleDmContent(title: string, openAsk = ""): SlackMessageContent {
  const text = `${TITLE_PREFIX}${title}`;
  const header = slackClipped(text, SLACK_TEXT_BOUND.HEADER);
  const words = openAsk.trim();
  return {
    text,
    blocks: [
      { type: "header", text: { type: "plain_text", text: header } },
      ...(words === "" ? [] : [slackMarkdownBlock(words, OPEN_ASK_PREVIEW_CHARS)]),
    ],
  };
}

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

const SlackDmSchema = Schema.Struct({
  channel: Schema.String,
  ts: Schema.String,
  to: Schema.optionalKey(Schema.String),
  thread: Schema.optionalKey(Schema.String),
  settled: Schema.optionalKey(Schema.Boolean),
});

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

function unsettledDm() {
  return and(
    isNotNull(inboxMessage.slackDm),
    sql`coalesce((${inboxMessage.slackDm} ->> 'settled')::boolean, false) = false`,
  );
}

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

interface TitleDm {
  readonly channel: string;
  readonly ts: string;
}

const findOpenAskAt = SqlSchema.findOneOption({
  Request: Schema.Struct({ itemId: Schema.String, channel: Schema.String, ts: Schema.String }),
  Result: Schema.Struct({
    text: Schema.String,
    steps: Schema.NullOr(Schema.Array(Schema.String)),
  }),
  execute: ({ itemId, channel, ts }) =>
    Database.use((db) =>
      db
        .select({
          text: inboxMessage.text,
          steps: sql<unknown>`case when ${inboxMessage.ask} ->> 'type' = ${INBOX_ASK.DO} then ${inboxMessage.ask} -> 'steps' end`,
        })
        .from(inboxMessage)
        .where(
          and(
            eq(inboxMessage.itemId, itemId),
            sql`${inboxMessage.slackDm} ->> 'channel' = ${channel}`,
            sql`${inboxMessage.slackDm} ->> 'thread' = ${ts}`,
            sql`${inboxMessage.ask} ->> 'status' = ${INBOX_ASK_STATUS.OPEN}`,
          ),
        )
        .orderBy(desc(inboxMessage.createdAt))
        .limit(1),
    ),
});

function threadRoot(dm: typeof SlackDmSchema.Type) {
  return { channel: dm.channel, ts: dm.thread ?? dm.ts, to: dm.to };
}

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

function titleDmsOf(dms: readonly (typeof SlackDmSchema.Type)[]): readonly TitleDm[] {
  const titles: TitleDm[] = [];
  for (const { channel, thread } of dms) {
    if (thread === undefined) continue;
    if (titles.some((title) => title.channel === channel && title.ts === thread)) continue;
    titles.push({ channel, ts: thread });
  }
  return titles;
}

function redrawTitleDms(
  bot: SlackBotService,
  itemId: string,
  title: string,
  titles: readonly TitleDm[],
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.forEach(
    titles,
    (at) =>
      Effect.flatMap(findOpenAskAt({ itemId, ...at }), (open) => {
        const words = Option.match(open, {
          onNone: () => "",
          onSome: ({ text, steps }) => wordsWithSteps(text, steps ?? []),
        });
        return bot.update(at.channel, at.ts, titleDmContent(title, words));
      }),
    { discard: true },
  );
}

function threadLink(itemId: string, place: { readonly step: string }) {
  return linkOf({ kind: LINK_PLACE.INBOX_ITEM, itemId }, place.step);
}

export function threadStandsOpen(
  agent: { readonly userId: string; readonly agentId: string },
  key: string,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.map(findOpenItem({ ...agent, key }), Option.isSome);
}

export function itemWorkspace(
  itemId: string,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return Effect.map(
    findItemPlace(itemId),
    Option.map((place) => place.organizationId),
  );
}

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

export function settledLine(
  status: (typeof INBOX_ASK_STATUS)[keyof typeof INBOX_ASK_STATUS] | undefined,
): string {
  return status === undefined || status === INBOX_ASK_STATUS.OPEN
    ? `No longer open in ${PRODUCT_NAME}`
    : SETTLED_LINE[status];
}

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
    yield* redrawTitleDms(bot.value, itemId, title, titleDmsOf(claimed.map(({ dm }) => dm)));
  });
}

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
    if (kept === undefined && post.wasOpen && !post.asked) return;
    const place = yield* findItemPlace(item.id);
    if (Option.isNone(place)) return;
    const opened =
      kept === undefined
        ? yield* bot.value.dm(organizationId, recipient, titleDmContent(item.title))
        : Option.some(kept);
    if (Option.isNone(opened)) return;
    const thread = { channel: opened.value.channel, ts: opened.value.ts };
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
    if (message.ask?.status === INBOX_ASK_STATUS.OPEN) {
      yield* redrawTitleDms(bot.value, item.id, item.title, [thread]);
    }
    const uploads = yield* messageUploads(recipient, item.id, message);
    yield* bot.value.upload(thread.channel, thread.ts, uploads);
  });
}
