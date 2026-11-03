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
 * (`@luke/database/models/slack-installation-store`). Writing to a member
 * finds their Slack user id by their email (`users.lookupByEmail`) the first
 * time and keeps it, a miss included, which is asked again only after
 * `SLACK_MEMBER_MISS_LIFETIME`; a member with no match is written nothing.
 *
 * `dm` and `update` are best-effort: whatever fails, Slack, Connect, or the
 * store, is logged by a fixed line and Slack's own error code, never Slack's
 * words or the token, and answers nothing. Note that neither is to be
 * yielded inside a transaction, because each waits on Slack.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  recordSlackMemberLookup,
  slackMemberLookup,
  workspaceSlackInstallation,
} from "@luke/database/models/slack-installation-store";
import { getToken } from "@vercel/connect";
import { Config, Context, Data, DateTime, Duration, Effect, Layer, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { readAccountPerson } from "../accounts/account-person.js";
import { text } from "../core.js";

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

/** One Web API call: the method, its arguments, and Slack's answer as JSON, an answer Slack marked not ok refused by its code. */
export type SlackWebApi = (
  method: SlackMethod,
  args: Readonly<Record<string, string>>,
) => Effect.Effect<unknown, SlackBotFailure>;

/** our Slack bot as this deployment holds it. */
export interface SlackBotService {
  /** Whether the deployment names the bot's connector; one that does not writes nothing. */
  readonly configured: boolean;
  /** The team the bot's token answers for, as `auth.test` says. */
  readonly team: Effect.Effect<SlackTeam, SlackBotFailure>;
  /** Writes to the member directly, where the workspace's bot is connected and their email matches someone in its team; nothing otherwise, or where anything failed. */
  readonly dm: (
    organizationId: string,
    userId: string,
    content: SlackMessageContent,
  ) => Effect.Effect<Option.Option<SlackMessage>, never, DatabaseServices>;
  /** Rewrites a message the bot wrote; a failure is logged and answers nothing. */
  readonly update: (
    channel: string,
    ts: string,
    content: SlackMessageContent,
  ) => Effect.Effect<void>;
}

export class SlackBot extends Context.Service<SlackBot, SlackBotService>()("SlackBot") {}

/** `auth.test`'s answer, as far as it is read. */
const AuthTestSchema = Schema.Struct({ team_id: Schema.String, team: Schema.String });

/** `users.lookupByEmail`'s answer, as far as it is read. */
const LookupSchema = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) });

/** `chat.postMessage`'s answer, as far as it is read. */
const PostedSchema = Schema.Struct({ channel: Schema.String, ts: Schema.String });

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

/** Logs a failure by its fixed line, and answers nothing. */
function swallowed<A>(what: string) {
  return (cause: { readonly message: string }) =>
    Effect.as(
      Effect.logWarning(`The Slack bot could not ${what}`, cause.message),
      Option.none<A>(),
    );
}

/** The member's Slack user id in the team: kept, or looked up by their email and kept, a miss within its lifetime answering nothing. */
const memberSlackId = Effect.fn("web/slackMemberId")(function* (
  api: SlackWebApi,
  organizationId: string,
  userId: string,
) {
  const kept = yield* slackMemberLookup(organizationId, userId);
  if (Option.isSome(kept)) {
    const { slackUserId, lookedUpAt } = kept.value;
    if (slackUserId !== null) return Option.some(slackUserId);
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

/** The bot over one Web API, or over none where the deployment names no connector. */
export function slackBotOver(api: SlackWebApi | undefined): SlackBotService {
  if (api === undefined) {
    return {
      configured: false,
      team: Effect.fail(new SlackBotFailure({ method: SLACK_METHOD.AUTH_TEST })),
      dm: () => Effect.succeedNone,
      update: () => Effect.void,
    };
  }
  return {
    configured: true,
    team: api(SLACK_METHOD.AUTH_TEST, {}).pipe(
      Effect.flatMap((answer) => readAnswer(SLACK_METHOD.AUTH_TEST, AuthTestSchema, answer)),
      Effect.map((answer) => ({ id: answer.team_id, name: answer.team })),
    ),
    dm: (organizationId, userId, content) =>
      Effect.gen(function* () {
        if (Option.isNone(yield* workspaceSlackInstallation(organizationId))) {
          return Option.none<SlackMessage>();
        }
        const slackId = yield* memberSlackId(api, organizationId, userId);
        if (Option.isNone(slackId)) return Option.none<SlackMessage>();
        // Note that a user id as the channel writes to the bot's own conversation with them.
        const posted = yield* api(SLACK_METHOD.CHAT_POST_MESSAGE, {
          channel: slackId.value,
          ...contentArgs(content),
        });
        const message = yield* readAnswer(SLACK_METHOD.CHAT_POST_MESSAGE, PostedSchema, posted);
        return Option.some<SlackMessage>({ channel: message.channel, ts: message.ts });
      }).pipe(Effect.catch(swallowed<SlackMessage>("write to a member"))),
    update: (channel, ts, content) =>
      api(SLACK_METHOD.CHAT_UPDATE, { channel, ts, ...contentArgs(content) }).pipe(
        Effect.asVoid,
        Effect.catch(swallowed<void>("update a message")),
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

/** The Web API under the bot's token from Connect, each call a form post as Slack's docs take every method. */
function slackWebApi(connector: string, client: HttpClient.HttpClient): SlackWebApi {
  return (method, args) =>
    Effect.gen(function* () {
      const token = yield* Effect.tryPromise({
        try: () => getToken(connector, BOT_SUBJECT),
        catch: () => new SlackBotFailure({ method }),
      });
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
  HttpClient.HttpClient
> = Layer.effect(
  SlackBot,
  Effect.gen(function* () {
    const connector = text(
      Option.getOrUndefined(yield* Config.option(Config.String(SLACK_BOT_ENVIRONMENT.CONNECTOR))),
    );
    if (connector === undefined) return slackBotOver(undefined);
    return slackBotOver(slackWebApi(connector, yield* HttpClient.HttpClient));
  }),
);
