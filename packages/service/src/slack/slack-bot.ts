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

export const SLACK_BOT_ENVIRONMENT = { CONNECTOR: "SLACK_BOT_CONNECTOR_UID" } as const;

export const SLACK_MEMBER_MISS_LIFETIME = Duration.days(1);

const SLACK_API_ORIGIN = "https://slack.com";

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
  FILES_GET_UPLOAD_URL_EXTERNAL: "files.getUploadURLExternal",
  FILES_COMPLETE_UPLOAD_EXTERNAL: "files.completeUploadExternal",
} as const;

type SlackMethod = (typeof SLACK_METHOD)[keyof typeof SLACK_METHOD];

const SLACK_USERS_NOT_FOUND = "users_not_found";

const SLACK_CODE_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export type SlackBlock = Readonly<Record<string, unknown>>;

export interface SlackMessageContent {
  readonly text: string;
  readonly blocks: readonly SlackBlock[];
}

export interface SlackMessage {
  readonly channel: string;
  readonly ts: string;
}

export interface SlackThreadMessage {
  readonly ts: string;
  readonly user?: string;
  readonly bot: boolean;
  readonly text: string;
}

export interface SlackChannel {
  readonly id: string;
  readonly name: string;
  readonly private: boolean;
  readonly member: boolean;
}

export interface SlackUpload {
  readonly name: string;
  readonly title?: string;
  readonly bytes: Uint8Array;
}

export interface SlackTeam {
  readonly id: string;
  readonly name: string;
}

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

export class SlackFileFailure extends Data.TaggedError("SlackFileFailure") {
  override get message(): string {
    return "A Slack file's bytes could not be moved";
  }
}

export interface SlackFileTransfer {
  readonly send: (url: string, bytes: Uint8Array) => Effect.Effect<void, SlackFileFailure>;
  readonly read: (url: string, maxBytes: number) => Effect.Effect<Uint8Array, SlackFileFailure>;
}

export type SlackWebApi = (
  method: SlackMethod,
  args: Readonly<Record<string, string>>,
  memberSubject?: string,
) => Effect.Effect<unknown, SlackBotFailure>;

export interface SlackBotService {
  readonly configured: boolean;
  readonly team: Effect.Effect<SlackTeam, SlackBotFailure>;
  readonly dm: (
    organizationId: string,
    userId: string,
    content: SlackMessageContent,
    thread?: SlackMessage,
  ) => Effect.Effect<Option.Option<SlackMessage>, never, DatabaseServices>;
  readonly memberOf: (
    organizationId: string,
    teamId: string,
    slackUserId: string,
  ) => Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices>;
  readonly update: (
    channel: string,
    ts: string,
    content: SlackMessageContent,
  ) => Effect.Effect<void>;
  readonly reply: (
    channel: string,
    threadTs: string,
    content: SlackMessageContent,
  ) => Effect.Effect<Option.Option<SlackMessage>>;
  readonly threadMessages: (
    channel: string,
    threadTs: string,
  ) => Effect.Effect<readonly SlackThreadMessage[]>;
  readonly permalink: (channel: string, ts: string) => Effect.Effect<Option.Option<string>>;
  readonly userEmail: (slackUserId: string) => Effect.Effect<Option.Option<string>>;
  readonly channels: Effect.Effect<Option.Option<readonly SlackChannel[]>>;
  readonly join: (channel: string) => Effect.Effect<boolean>;
  readonly leave: (channel: string) => Effect.Effect<boolean>;
  readonly react: (channel: string, ts: string, emoji: string) => Effect.Effect<void>;
  readonly upload: (
    channel: string,
    threadTs: string,
    files: readonly SlackUpload[],
  ) => Effect.Effect<void>;
  readonly download: (url: string, maxBytes: number) => Effect.Effect<Option.Option<Uint8Array>>;
}

export class SlackBot extends Context.Service<SlackBot, SlackBotService>()("SlackBot") {}

const AuthTestSchema = Schema.Struct({ team_id: Schema.String, team: Schema.String });

const MemberAuthSchema = Schema.Struct({ team_id: Schema.String, user_id: Schema.String });

const LookupSchema = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) });

const PostedSchema = Schema.Struct({ channel: Schema.String, ts: Schema.String });

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

const PermalinkSchema = Schema.Struct({ permalink: Schema.String });

const UserInfoSchema = Schema.Struct({
  user: Schema.Struct({
    profile: Schema.optional(Schema.Struct({ email: Schema.optional(Schema.String) })),
  }),
});

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

const UploadUrlSchema = Schema.Struct({ upload_url: Schema.String, file_id: Schema.String });

const CHANNELS_READ = "1000";

const CHANNEL_TYPES = "public_channel,private_channel";

const THREAD_MESSAGES_READ = "200";

const AnswerSchema = Schema.Struct({ ok: Schema.Boolean, error: Schema.optional(Schema.String) });

function codeOf(code: string | undefined): string | undefined {
  return code !== undefined && SLACK_CODE_PATTERN.test(code) ? code : undefined;
}

function readAnswer<A>(
  method: SlackMethod,
  schema: Schema.Codec<A, unknown>,
  answer: unknown,
): Effect.Effect<A, SlackBotFailure> {
  return Schema.decodeUnknownEffect(schema)(answer).pipe(
    Effect.mapError(() => new SlackBotFailure({ method })),
  );
}

function contentArgs(content: SlackMessageContent): Record<string, string> {
  return { text: content.text, blocks: JSON.stringify(content.blocks) };
}

function postArgs(content: SlackMessageContent): Record<string, string> {
  return { ...contentArgs(content), unfurl_links: "false", unfurl_media: "false" };
}

function swallowed<A>(what: string) {
  return (cause: { readonly message: string }) =>
    Effect.as(
      Effect.logWarning(`The Slack bot could not ${what}`, cause.message),
      Option.none<A>(),
    );
}

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

function sentFile(
  api: SlackWebApi,
  files: SlackFileTransfer,
  file: SlackUpload,
): Effect.Effect<Option.Option<{ readonly id: string; readonly title: string }>> {
  return api(SLACK_METHOD.FILES_GET_UPLOAD_URL_EXTERNAL, {
    filename: file.name,
    length: String(file.bytes.byteLength),
  }).pipe(
    Effect.flatMap((answer) =>
      readAnswer(SLACK_METHOD.FILES_GET_UPLOAD_URL_EXTERNAL, UploadUrlSchema, answer),
    ),
    Effect.tap((answer) => files.send(answer.upload_url, file.bytes)),
    Effect.map((answer) => Option.some({ id: answer.file_id, title: file.title ?? file.name })),
    Effect.catch(swallowed<{ readonly id: string; readonly title: string }>("upload a file")),
  );
}

function uploadFiles(
  api: SlackWebApi,
  transfer: SlackFileTransfer,
  channel: string,
  threadTs: string,
  files: readonly SlackUpload[],
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const sent = (yield* Effect.forEach(files, (file) => sentFile(api, transfer, file))).flatMap(
      (one) => (Option.isSome(one) ? [one.value] : []),
    );
    if (sent.length === 0) return;
    yield* api(SLACK_METHOD.FILES_COMPLETE_UPLOAD_EXTERNAL, {
      files: JSON.stringify(sent),
      channel_id: channel,
      thread_ts: threadTs,
    }).pipe(Effect.catch(swallowed<unknown>("share uploaded files")));
  });
}

export function slackBotOver(
  api: SlackWebApi | undefined,
  transfer?: SlackFileTransfer,
): SlackBotService {
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
      upload: () => Effect.void,
      download: () => Effect.succeedNone,
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
    upload: (channel, threadTs, files) =>
      transfer === undefined || files.length === 0
        ? Effect.void
        : uploadFiles(api, transfer, channel, threadTs, files),
    download: (url, maxBytes) =>
      transfer === undefined
        ? Effect.succeedNone
        : transfer
            .read(url, maxBytes)
            .pipe(
              Effect.map(Option.some),
              Effect.catch(swallowed<Uint8Array>("read a shared file")),
            ),
  };
}

const BOT_SUBJECT = { subject: { type: "app" } } as const;

function botToken(connector: string): Effect.Effect<string, unknown> {
  return Effect.tryPromise(() => getToken(connector, BOT_SUBJECT));
}

function tokenFor(
  method: SlackMethod,
  connector: string,
  members: ConnectorService,
  memberSubject: string | undefined,
): Effect.Effect<string, SlackBotFailure> {
  if (memberSubject === undefined) {
    return botToken(connector).pipe(Effect.mapError(() => new SlackBotFailure({ method })));
  }
  return members.token(memberSubject, { fresh: false }).pipe(
    Effect.map((issued) => Redacted.value(issued.token)),
    Effect.mapError(() => new SlackBotFailure({ method })),
  );
}

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

const SLACK_FILE_HOST = "files.slack.com";

function isHttpsOn(url: string, host: string | undefined): boolean {
  const parsed = URL.parse(url);
  return (
    parsed !== null &&
    parsed.protocol === "https:" &&
    (host === undefined || parsed.hostname === host)
  );
}

function slackFileTransfer(connector: string, client: HttpClient.HttpClient): SlackFileTransfer {
  const failed = () => new SlackFileFailure();
  return {
    send: (url, bytes) =>
      Effect.gen(function* () {
        if (!isHttpsOn(url, undefined)) return yield* Effect.fail(failed());
        const request = HttpClientRequest.post(url).pipe(
          HttpClientRequest.bodyUint8Array(bytes, "application/octet-stream"),
        );
        yield* client
          .execute(request)
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.scoped,
            Effect.mapError(failed),
          );
      }),
    read: (url, maxBytes) =>
      Effect.gen(function* () {
        if (!isHttpsOn(url, SLACK_FILE_HOST)) return yield* Effect.fail(failed());
        const token = yield* botToken(connector).pipe(Effect.mapError(failed));
        const request = HttpClientRequest.get(url).pipe(HttpClientRequest.bearerToken(token));
        const bytes = yield* Effect.gen(function* () {
          const response = yield* HttpClientResponse.filterStatusOk(yield* client.execute(request));
          if (Number(response.headers["content-length"] ?? 0) > maxBytes) {
            return yield* Effect.fail(failed());
          }
          return yield* response.arrayBuffer;
        }).pipe(Effect.scoped, Effect.mapError(failed));
        if (bytes.byteLength > maxBytes) return yield* Effect.fail(failed());
        return new Uint8Array(bytes);
      }),
  };
}

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
    const client = yield* HttpClient.HttpClient;
    return slackBotOver(
      slackWebApi(connector, members, client),
      slackFileTransfer(connector, client),
    );
  }),
);
