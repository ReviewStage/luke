/**
 * slack-bot.ts -- our own Slack bot: the team its token answers for, and a member written to directly.
 *
 * The bot is one Slack app whose token Vercel Connect holds under the
 * connector `SLACK_BOT_CONNECTOR_UID` names, under an app subject, never a
 * member's, so it is apart from the Slack each member connects for their
 * agents (`integrations.ts`). Its token is asked for at the moment a call is
 * made and kept in the SDK's own cache, never stored.
 *
 * A workspace's owner or admin connects the bot, which reads the team the
 * token answers for (`auth.test`) and keeps it
 * (`@repo/database/models/slack-installation-store`). Writing to a member
 * finds their Slack user id the first time and keeps it: through a Slack
 * account they connected themselves under Settings › Integrations, whose own
 * token `auth.test` answers their user id and team for, the first in the
 * bot's team taken; else by their email (`users.lookupByEmail`), a miss
 * kept and asked again only after `SLACK_MEMBER_MISS_LIFETIME`. A member
 * with no match is written nothing.
 *
 * A member who writes to the bot is found by the id kept for them, else
 * through the Slack accounts the workspace's members connected themselves
 * whose ids are not kept yet (`memberOf`); the caller falls back to the
 * email Slack holds for them (`users.info`). The bot replies in the thread
 * they wrote in (`chat.postMessage` with `thread_ts`), reading the thread's
 * earlier messages (`conversations.replies`) and its link
 * (`chat.getPermalink`). Settings lists the team's channels
 * (`conversations.list`), and an owner or admin puts the bot in a public one
 * (`conversations.join`) or takes it out of one (`conversations.leave`).
 *
 * `dm`, `update`, and those reads, replies, joins, and leaves are best-effort: whatever fails, Slack, Connect, or the
 * store, is logged by a fixed line and Slack's own error code, never Slack's
 * words or the token, and answers nothing. Note that neither is to be
 * yielded inside a transaction, because each waits on Slack.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { INTEGRATION_ROW_STATUS } from "@repo/database/integration-vocabulary";
import {
  recordSlackMemberLookup,
  slackMemberLookup,
  slackMemberOf,
  slackUnresolvedConnections,
  workspaceSlackInstallation,
} from "@repo/database/models/slack-installation-store";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { getToken } from "@vercel/connect";
import {
  Config,
  Context,
  Data,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { readAccountPerson } from "../accounts/account-person.js";
import { text } from "../core.js";
import { type ConnectorService, IntegrationConnect } from "../integrations/integration-connect.js";
import { readIntegrationConnections } from "../integrations/integration-store.js";

/** The variable this deployment names the bot's connector by; a blank value is absent. */
export const SLACK_BOT_ENVIRONMENT = { CONNECTOR: "SLACK_BOT_CONNECTOR_UID" } as const;

/** How long a member whose email matched no one in the team is written nothing before Slack is asked again. */
export const SLACK_MEMBER_MISS_LIFETIME = Duration.days(1);

/** Where Slack's Web API answers. */
const SLACK_API_ORIGIN = "https://slack.com";

/** The Web API methods the bot calls. */
const SLACK_METHOD = {
  AUTH_TEST: "auth.test",
  USERS_LOOKUP_BY_EMAIL: "users.lookupByEmail",
  CHAT_POST_MESSAGE: "chat.postMessage",
  CHAT_UPDATE: "chat.update",
  CHAT_GET_PERMALINK: "chat.getPermalink",
  CONVERSATIONS_REPLIES: "conversations.replies",
  USERS_INFO: "users.info",
  CONVERSATIONS_LIST: "conversations.list",
  CONVERSATIONS_JOIN: "conversations.join",
  CONVERSATIONS_LEAVE: "conversations.leave",
  REACTIONS_ADD: "reactions.add",
} as const;

type SlackMethod = (typeof SLACK_METHOD)[keyof typeof SLACK_METHOD];

/** Slack's error code for an email that matches no member of the team. */
const SLACK_USERS_NOT_FOUND = "users_not_found";

/** Slack's error code as a log line may keep it: a short slug, and nothing shaped like a sentence or a token. */
const SLACK_CODE_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** One Block Kit block, as Slack's own docs spell it. */
export type SlackBlock = Readonly<Record<string, unknown>>;

/** What the bot writes: Block Kit blocks, and the plain text Slack shows in a notification and wherever blocks are not drawn. */
export interface SlackMessageContent {
  readonly text: string;
  readonly blocks: readonly SlackBlock[];
}

/** A message the bot wrote, by the conversation it is in and its timestamp, which is what `update` names it by. */
export interface SlackMessage {
  readonly channel: string;
  readonly ts: string;
}

/** One message of a Slack thread as the bot reads it: who wrote it, a member by user id or a bot, and its words. */
export interface SlackThreadMessage {
  readonly ts: string;
  readonly user?: string;
  readonly bot: boolean;
  readonly text: string;
}

/** A channel of the team as the bot sees it: its name, whether it is private, and whether the bot is in it. */
export interface SlackChannel {
  readonly id: string;
  readonly name: string;
  readonly private: boolean;
  readonly member: boolean;
}

/** The Slack team the bot's token answers for. */
export interface SlackTeam {
  readonly id: string;
  readonly name: string;
}

/** Why Slack answered nothing usable: the deployment names no connector, or Connect or Slack refused, keeping Slack's code where it is a slug. */
export class SlackBotFailure extends Data.TaggedError("SlackBotFailure")<{
  readonly method: SlackMethod;
  readonly code?: string;
}> {
  override get message(): string {
    return this.code === undefined
      ? `Slack could not be asked ${this.method}`
      : `Slack answered ${this.method} with ${this.code}`;
  }
}

/**
 * One Web API call: the method, its arguments, and Slack's answer as JSON,
 * an answer Slack marked not ok refused by its code. It is made on the
 * bot's token, or on the token of a member's own Slack account where
 * `memberSubject` names the subject Connect holds that account under.
 */
export type SlackWebApi = (
  method: SlackMethod,
  args: Readonly<Record<string, string>>,
  memberSubject?: string,
) => Effect.Effect<unknown, SlackBotFailure>;

/** our Slack bot as this deployment holds it. */
export interface SlackBotService {
  /** Whether the deployment names the bot's connector; one that does not writes nothing. */
  readonly configured: boolean;
  /** The team the bot's token answers for, as `auth.test` says. */
  readonly team: Effect.Effect<SlackTeam, SlackBotFailure>;
  /** Writes to the member directly, in the thread under the DM `thread` names where given, where the workspace's bot is connected and their email matches someone in its team; nothing otherwise, or where anything failed. */
  readonly dm: (
    organizationId: string,
    userId: string,
    content: SlackMessageContent,
    thread?: SlackMessage,
  ) => Effect.Effect<Option.Option<SlackMessage>, never, DatabaseServices>;
  /** The member of the workspace a Slack user of its connected team is, by the id kept for them or through a Slack account a member connected themselves; nothing where neither finds one. */
  readonly memberOf: (
    organizationId: string,
    teamId: string,
    slackUserId: string,
  ) => Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices>;
  /** Rewrites a message the bot wrote; a failure is logged and answers nothing. */
  readonly update: (
    channel: string,
    ts: string,
    content: SlackMessageContent,
  ) => Effect.Effect<void>;
  /** Replies in the thread under the message `threadTs` names; nothing where it failed. */
  readonly reply: (
    channel: string,
    threadTs: string,
    content: SlackMessageContent,
  ) => Effect.Effect<Option.Option<SlackMessage>>;
  /** The thread's messages, oldest first, as far as Slack's first page holds them; none where the read failed. */
  readonly threadMessages: (
    channel: string,
    threadTs: string,
  ) => Effect.Effect<readonly SlackThreadMessage[]>;
  /** The message's link in Slack; nothing where the read failed. */
  readonly permalink: (channel: string, ts: string) => Effect.Effect<Option.Option<string>>;
  /** The email Slack holds for the user; nothing where it holds none, or the read failed. */
  readonly userEmail: (slackUserId: string) => Effect.Effect<Option.Option<string>>;
  /** The team's public channels and the private ones the bot is in, archived ones left out, as far as Slack's first page holds them; nothing where the read failed. */
  readonly channels: Effect.Effect<Option.Option<readonly SlackChannel[]>>;
  /** Puts the bot in a public channel; false where Slack refused. */
  readonly join: (channel: string) => Effect.Effect<boolean>;
  /** Takes the bot out of a channel; false where Slack refused. */
  readonly leave: (channel: string) => Effect.Effect<boolean>;
  /** Reacts to a message with the emoji Slack names `emoji`; a failure is logged and answers nothing. */
  readonly react: (channel: string, ts: string, emoji: string) => Effect.Effect<void>;
}

export class SlackBot extends Context.Service<SlackBot, SlackBotService>()("SlackBot") {}

/** `auth.test`'s answer, as far as it is read. */
const AuthTestSchema = Schema.Struct({ team_id: Schema.String, team: Schema.String });

/** `auth.test`'s answer on a member's own token, as far as it is read: who they are, and in which team. */
const MemberAuthSchema = Schema.Struct({ team_id: Schema.String, user_id: Schema.String });

/** `users.lookupByEmail`'s answer, as far as it is read. */
const LookupSchema = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) });

/** `chat.postMessage`'s answer, as far as it is read. */
const PostedSchema = Schema.Struct({ channel: Schema.String, ts: Schema.String });

/** `conversations.replies`' answer, as far as it is read. */
const RepliesSchema = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({
      ts: Schema.String,
      user: Schema.optional(Schema.String),
      bot_id: Schema.optional(Schema.String),
      text: Schema.optional(Schema.String),
    }),
  ),
});

/** `chat.getPermalink`'s answer, as far as it is read. */
const PermalinkSchema = Schema.Struct({ permalink: Schema.String });

/** `users.info`'s answer, as far as it is read. */
const UserInfoSchema = Schema.Struct({
  user: Schema.Struct({
    profile: Schema.optional(Schema.Struct({ email: Schema.optional(Schema.String) })),
  }),
});

/** `conversations.list`'s answer, as far as it is read. */
const ChannelsSchema = Schema.Struct({
  channels: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      is_private: Schema.optional(Schema.Boolean),
      is_member: Schema.optional(Schema.Boolean),
    }),
  ),
});

/** The most channels read, Slack's own bound for one page; a team with more is read by its first page. */
const CHANNELS_READ = "1000";

/** The kinds of conversation the channel list reads. */
const CHANNEL_TYPES = "public_channel,private_channel";

/** The most of a thread's messages read; a thread longer than this is read by its first page. */
const THREAD_MESSAGES_READ = "200";

/** Any Web API answer: whether Slack did it, and its code where it did not. */
const AnswerSchema = Schema.Struct({ ok: Schema.Boolean, error: Schema.optional(Schema.String) });

/** A Slack code as a failure keeps it. */
function codeOf(code: string | undefined): string | undefined {
  return code !== undefined && SLACK_CODE_PATTERN.test(code) ? code : undefined;
}

/** An answer read as the schema says, a shape not read refused. */
function readAnswer<A>(
  method: SlackMethod,
  schema: Schema.Codec<A, unknown>,
  answer: unknown,
): Effect.Effect<A, SlackBotFailure> {
  return Schema.decodeUnknownEffect(schema)(answer).pipe(
    Effect.mapError(() => new SlackBotFailure({ method })),
  );
}

/** A message's arguments as the Web API takes them, its blocks as the JSON Slack reads them from. */
function contentArgs(content: SlackMessageContent): Record<string, string> {
  return { text: content.text, blocks: JSON.stringify(content.blocks) };
}

/**
 * A new message's arguments: its content, with Slack's link and media
 * previews off. Note that we turn them off, because an agent's words name
 * many pull requests, and a preview of each buries the message itself.
 */
function postArgs(content: SlackMessageContent): Record<string, string> {
  return { ...contentArgs(content), unfurl_links: "false", unfurl_media: "false" };
}

/** Logs a failure by its fixed line, and answers nothing. */
function swallowed<A>(what: string) {
  return (cause: { readonly message: string }) =>
    Effect.as(
      Effect.logWarning(`The Slack bot could not ${what}`, cause.message),
      Option.none<A>(),
    );
}

/** The user id one of a member's own Slack accounts is in the team, as `auth.test` on its token says; nothing for an account in another team, or one whose token failed. */
function connectedSlackId(
  api: SlackWebApi,
  teamId: string,
  connectSubject: string,
): Effect.Effect<Option.Option<string>> {
  return api(SLACK_METHOD.AUTH_TEST, {}, connectSubject).pipe(
    Effect.flatMap((answer) => readAnswer(SLACK_METHOD.AUTH_TEST, MemberAuthSchema, answer)),
    Effect.map((answer) =>
      answer.team_id === teamId ? Option.some(answer.user_id) : Option.none<string>(),
    ),
    Effect.catch(swallowed<string>("read a member's own Slack account")),
  );
}

/** The member's Slack user id in the team through the Slack accounts they connected themselves, the first in the team taken and kept; nothing where none is. */
const connectedMemberSlackId = Effect.fnUntraced(function* (
  api: SlackWebApi,
  organizationId: string,
  teamId: string,
  userId: string,
) {
  const connections = yield* readIntegrationConnections(userId);
  for (const connection of connections) {
    if (connection.provider !== INTEGRATION_PROVIDER.SLACK) continue;
    if (connection.status !== INTEGRATION_ROW_STATUS.CONNECTED) continue;
    const found = yield* connectedSlackId(api, teamId, connection.connectSubject);
    if (Option.isNone(found)) continue;
    yield* recordSlackMemberLookup(organizationId, userId, found.value);
    return found;
  }
  return Option.none<string>();
});

/**
 * The member's Slack user id in the team: kept, or found through a Slack
 * account they connected themselves, or looked up by their email, and
 * kept; an email miss within its lifetime answers nothing. Note that a
 * kept miss still asks their own accounts, so a member who connects Slack
 * after a miss is found on the next write.
 */
const memberSlackId = Effect.fn("web/slackMemberId")(function* (
  api: SlackWebApi,
  organizationId: string,
  teamId: string,
  userId: string,
) {
  const kept = yield* slackMemberLookup(organizationId, userId);
  if (Option.isSome(kept) && kept.value.slackUserId !== null) {
    return Option.some(kept.value.slackUserId);
  }
  const connected = yield* connectedMemberSlackId(api, organizationId, teamId, userId);
  if (Option.isSome(connected)) return connected;
  if (Option.isSome(kept)) {
    const { lookedUpAt } = kept.value;
    const askedAgainAt = DateTime.addDuration(
      DateTime.fromDateUnsafe(lookedUpAt),
      SLACK_MEMBER_MISS_LIFETIME,
    );
    if (DateTime.isLessThan(yield* DateTime.now, askedAgainAt)) return Option.none<string>();
  }
  const email = (yield* readAccountPerson(userId))?.email;
  if (email === undefined) return Option.none<string>();
  const found = yield* api(SLACK_METHOD.USERS_LOOKUP_BY_EMAIL, { email }).pipe(
    Effect.flatMap((answer) =>
      readAnswer(SLACK_METHOD.USERS_LOOKUP_BY_EMAIL, LookupSchema, answer),
    ),
    Effect.map((answer) => Option.some(answer.user.id)),
    Effect.catchIf(
      (failure) => failure.code === SLACK_USERS_NOT_FOUND,
      () => Effect.succeed(Option.none<string>()),
    ),
  );
  yield* recordSlackMemberLookup(organizationId, userId, Option.getOrNull(found));
  return found;
});

/**
 * The member a Slack user of the workspace's team is: the one kept under
 * that id, or else one found by asking Slack, through each Slack account a
 * member whose id is not kept connected themselves, who that account is in
 * the team; each member found so is kept, and the asking stops at the
 * Slack user sought.
 */
const memberOfSlackUser = Effect.fn("web/slackMemberOf")(function* (
  api: SlackWebApi,
  organizationId: string,
  teamId: string,
  slackUserId: string,
) {
  const kept = yield* slackMemberOf(organizationId, teamId, slackUserId);
  if (Option.isSome(kept)) return kept;
  const installation = yield* workspaceSlackInstallation(organizationId);
  if (Option.isNone(installation) || installation.value.teamId !== teamId) {
    return Option.none<string>();
  }
  const resolved = new Set<string>();
  for (const { userId, connectSubject } of yield* slackUnresolvedConnections(organizationId)) {
    if (resolved.has(userId)) continue;
    const found = yield* connectedSlackId(api, teamId, connectSubject);
    if (Option.isNone(found)) continue;
    resolved.add(userId);
    yield* recordSlackMemberLookup(organizationId, userId, found.value);
    if (found.value === slackUserId) return Option.some(userId);
  }
  return Option.none<string>();
});

/** The bot over one Web API, or over none where the deployment names no connector. */
export function slackBotOver(api: SlackWebApi | undefined): SlackBotService {
  if (api === undefined) {
    return {
      configured: false,
      team: Effect.fail(new SlackBotFailure({ method: SLACK_METHOD.AUTH_TEST })),
      dm: () => Effect.succeedNone,
      memberOf: slackMemberOf,
      update: () => Effect.void,
      reply: () => Effect.succeedNone,
      threadMessages: () => Effect.succeed([]),
      permalink: () => Effect.succeedNone,
      userEmail: () => Effect.succeedNone,
      channels: Effect.succeedNone,
      join: () => Effect.succeed(false),
      leave: () => Effect.succeed(false),
      react: () => Effect.void,
    };
  }
  return {
    configured: true,
    team: api(SLACK_METHOD.AUTH_TEST, {}).pipe(
      Effect.flatMap((answer) => readAnswer(SLACK_METHOD.AUTH_TEST, AuthTestSchema, answer)),
      Effect.map((answer) => ({ id: answer.team_id, name: answer.team })),
    ),
    dm: (organizationId, userId, content, thread) =>
      Effect.gen(function* () {
        const installation = yield* workspaceSlackInstallation(organizationId);
        if (Option.isNone(installation)) return Option.none<SlackMessage>();
        const slackId = yield* memberSlackId(
          api,
          organizationId,
          installation.value.teamId,
          userId,
        );
        if (Option.isNone(slackId)) return Option.none<SlackMessage>();
        // Note that a user id as the channel writes to the bot's own conversation with them.
        const posted = yield* api(SLACK_METHOD.CHAT_POST_MESSAGE, {
          ...(thread === undefined
            ? { channel: slackId.value }
            : { channel: thread.channel, thread_ts: thread.ts }),
          ...postArgs(content),
        });
        const message = yield* readAnswer(SLACK_METHOD.CHAT_POST_MESSAGE, PostedSchema, posted);
        return Option.some<SlackMessage>({ channel: message.channel, ts: message.ts });
      }).pipe(Effect.catch(swallowed<SlackMessage>("write to a member"))),
    memberOf: (organizationId, teamId, slackUserId) =>
      memberOfSlackUser(api, organizationId, teamId, slackUserId),
    update: (channel, ts, content) =>
      api(SLACK_METHOD.CHAT_UPDATE, { channel, ts, ...contentArgs(content) }).pipe(
        Effect.asVoid,
        Effect.catch(swallowed<void>("update a message")),
        Effect.asVoid,
      ),
    reply: (channel, threadTs, content) =>
      api(SLACK_METHOD.CHAT_POST_MESSAGE, {
        channel,
        thread_ts: threadTs,
        ...postArgs(content),
      }).pipe(
        Effect.flatMap((answer) =>
          readAnswer(SLACK_METHOD.CHAT_POST_MESSAGE, PostedSchema, answer),
        ),
        Effect.map((message) =>
          Option.some<SlackMessage>({ channel: message.channel, ts: message.ts }),
        ),
        Effect.catch(swallowed<SlackMessage>("reply in a thread")),
      ),
    threadMessages: (channel, threadTs) =>
      api(SLACK_METHOD.CONVERSATIONS_REPLIES, {
        channel,
        ts: threadTs,
        limit: THREAD_MESSAGES_READ,
      }).pipe(
        Effect.flatMap((answer) =>
          readAnswer(SLACK_METHOD.CONVERSATIONS_REPLIES, RepliesSchema, answer),
        ),
        Effect.map((answer) =>
          answer.messages.map(
            (message): SlackThreadMessage => ({
              ts: message.ts,
              ...(message.user === undefined ? undefined : { user: message.user }),
              bot: message.bot_id !== undefined,
              text: message.text ?? "",
            }),
          ),
        ),
        Effect.catch((cause) =>
          Effect.as(Effect.logWarning("The Slack bot could not read a thread", cause.message), []),
        ),
      ),
    permalink: (channel, ts) =>
      api(SLACK_METHOD.CHAT_GET_PERMALINK, { channel, message_ts: ts }).pipe(
        Effect.flatMap((answer) =>
          readAnswer(SLACK_METHOD.CHAT_GET_PERMALINK, PermalinkSchema, answer),
        ),
        Effect.map((answer) => Option.some(answer.permalink)),
        Effect.catch(swallowed<string>("read a message's link")),
      ),
    userEmail: (slackUserId) =>
      api(SLACK_METHOD.USERS_INFO, { user: slackUserId }).pipe(
        Effect.flatMap((answer) => readAnswer(SLACK_METHOD.USERS_INFO, UserInfoSchema, answer)),
        Effect.map((answer) => Option.fromNullishOr(answer.user.profile?.email)),
        Effect.catch(swallowed<string>("read a member's email")),
      ),
    channels: api(SLACK_METHOD.CONVERSATIONS_LIST, {
      types: CHANNEL_TYPES,
      exclude_archived: "true",
      limit: CHANNELS_READ,
    }).pipe(
      Effect.flatMap((answer) =>
        readAnswer(SLACK_METHOD.CONVERSATIONS_LIST, ChannelsSchema, answer),
      ),
      Effect.map((answer) =>
        Option.some(
          answer.channels.map(
            (channel): SlackChannel => ({
              id: channel.id,
              name: channel.name,
              private: channel.is_private === true,
              member: channel.is_member === true,
            }),
          ),
        ),
      ),
      Effect.catch(swallowed<readonly SlackChannel[]>("read the team's channels")),
    ),
    join: (channel) =>
      api(SLACK_METHOD.CONVERSATIONS_JOIN, { channel }).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.as(
            Effect.logWarning("The Slack bot could not join a channel", cause.message),
            false,
          ),
        ),
      ),
    leave: (channel) =>
      api(SLACK_METHOD.CONVERSATIONS_LEAVE, { channel }).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.as(
            Effect.logWarning("The Slack bot could not leave a channel", cause.message),
            false,
          ),
        ),
      ),
    react: (channel, ts, emoji) =>
      api(SLACK_METHOD.REACTIONS_ADD, { channel, timestamp: ts, name: emoji }).pipe(
        Effect.asVoid,
        Effect.catch(swallowed<void>("react to a message")),
        Effect.asVoid,
      ),
  };
}

/**
 * The subject the bot's token is asked under: the app's, as Slack bot tokens
 * are one per install. Note that this is exactly what `@vercel/connect/chat`'s
 * `connectSlackAdapter(connector).botToken()` asks, called here directly,
 * because that helper's type comes from a Chat SDK package we do not install.
 */
const BOT_SUBJECT = { subject: { type: "app" } } as const;

/** The token a call is made on: the bot's from its own connector, or a member's own Slack account's from the connector members connect Slack through. */
function tokenFor(
  method: SlackMethod,
  connector: string,
  members: ConnectorService,
  memberSubject: string | undefined,
): Effect.Effect<string, SlackBotFailure> {
  if (memberSubject === undefined) {
    return Effect.tryPromise({
      try: () => getToken(connector, BOT_SUBJECT),
      catch: () => new SlackBotFailure({ method }),
    });
  }
  return members.token(memberSubject, { fresh: false }).pipe(
    Effect.map((issued) => Redacted.value(issued.token)),
    Effect.mapError(() => new SlackBotFailure({ method })),
  );
}

/** The Web API under a token from Connect, each call a form post as Slack's docs take every method. */
function slackWebApi(
  connector: string,
  members: ConnectorService,
  client: HttpClient.HttpClient,
): SlackWebApi {
  return (method, args, memberSubject) =>
    Effect.gen(function* () {
      const token = yield* tokenFor(method, connector, members, memberSubject);
      const request = HttpClientRequest.post(`${SLACK_API_ORIGIN}/api/${method}`).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyUrlParams(args),
      );
      const answer = yield* client.execute(request).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Unknown)),
        Effect.scoped,
        Effect.mapError(() => new SlackBotFailure({ method })),
      );
      const said = yield* readAnswer(method, AnswerSchema, answer);
      if (!said.ok) {
        const code = codeOf(said.error);
        return yield* Effect.fail(
          new SlackBotFailure(code === undefined ? { method } : { method, code }),
        );
      }
      return answer;
    });
}

/** The bot as this deployment's environment configures it, read as the services are built. */
export const slackBotFromEnvironment: Layer.Layer<
  SlackBot,
  Config.ConfigError,
  HttpClient.HttpClient | IntegrationConnect
> = Layer.effect(
  SlackBot,
  Effect.gen(function* () {
    const connector = text(
      Option.getOrUndefined(yield* Config.option(Config.String(SLACK_BOT_ENVIRONMENT.CONNECTOR))),
    );
    if (connector === undefined) return slackBotOver(undefined);
    const members = (yield* IntegrationConnect)[INTEGRATION_PROVIDER.SLACK];
    return slackBotOver(slackWebApi(connector, members, yield* HttpClient.HttpClient));
  }),
);
