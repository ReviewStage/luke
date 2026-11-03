/**
 * slack-events-app.ts -- our Slack bot's one inbound route: a press of a decide ask's option in a member's DM answers the ask, as the member would in the app.
 *
 * Vercel Connect holds the bot's Slack app and forwards every request Slack
 * sends it, events and interactivity alike, to this one path, with a Vercel
 * OIDC token as its bearer in place of Slack's own signature, so the
 * deployment keeps no Slack signing secret. Nothing of a request is read
 * past its bounded bytes before that token holds
 * (`createConnectWebhookVerifier`, which fails closed off Vercel).
 * Interactivity arrives form-encoded, its JSON under `payload`; an event
 * arrives as JSON: Slack's URL check is answered, and a message a member
 * addressed to the bot, a mention or a direct message, is acknowledged and
 * acted on once the answer has left (`slack-agent-starts.ts`); every other
 * event is acknowledged unread.
 *
 * A press (`block_actions`) is read for the option button's value, which
 * names the item, the message whose ask it answers, and the option
 * (`SlackChoice`, `thread-dms.ts`); a press with none, the Open button's
 * among them, is acknowledged and nothing else. The presser is found back as
 * the workspace member the bot's lookups kept under that Slack user, or
 * one whose own Slack account is that user, in the team the item's
 * workspace connected (`SlackBot.memberOf`), and the ask is
 * answered as that member (`answerAsMember`) under the button's action id,
 * so a press Slack sends again is the answer already taken. The answer
 * taken is handed to the agent as its "Thread answer", and the DM is
 * rewritten to say the option chosen; a press on an ask already settled
 * rewrites the DM to say where it stands. Of a request nothing is logged
 * but a fixed line: its kind as it is heard, and a refused bearer.
 */

import { storeWriter } from "@repo/database/models/writer";
import { INBOX_ASK_STATUS, INBOX_REPLY } from "@repo/features/inbox-wire";
import { EXCESS_KEYS, HTTP_METHOD, type UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { type ConnectWebhookVerifier, createConnectWebhookVerifier } from "@vercel/connect/chat";
import { Effect, Layer, Option, Result, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { afterResponse } from "../http/after-response.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../http/http-effect.js";
import { answerAsMember } from "../inbox/inbox-procedures.js";
import { INBOX_ASK_ANSWER } from "../inbox/inbox-store.js";
import { ANY_METHOD } from "../route.js";
import { actOnSlackEvent } from "./slack-agent-starts.js";
import { SlackBot, type SlackMessage } from "./slack-bot.js";
import {
  chosenLine,
  itemWorkspace,
  rewriteThreadDm,
  type SlackChoice,
  SlackChoiceSchema,
  settledLine,
} from "./thread-dms.js";

/** The path Connect's trigger forwards Slack's requests to, under the deployment's origin. */
const SLACK_EVENTS_PATH = "/api/slack/events";

/** Slack caps an interaction's payload far below this; bounded all the same before anything is read. */
const MAXIMUM_REQUEST_BYTES = 1024 * 1024;

/** The form field interactivity carries its JSON under. */
const INTERACTION_FIELD = "payload";

/** The content type interactivity arrives as. */
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

/** The kinds of request read: a press of a button, and Slack's check of the URL. */
const SLACK_REQUEST_TYPE = {
  BLOCK_ACTIONS: "block_actions",
  URL_VERIFICATION: "url_verification",
} as const;

/** The header Slack marks its retry of an event with, which is dropped, since the first delivery was acted on. */
const SLACK_RETRY_HEADER = "x-slack-retry-num";

/** Where a verifier is told the request came, which it reads only for its headers. */
const VERIFIED_ORIGIN = "https://slack.connect.invalid";

/** A press as far as it is read: who pressed, in which team, the DM it was in, and the buttons' action ids and values. */
const BlockActionsSchema = Schema.Struct({
  type: Schema.Literal(SLACK_REQUEST_TYPE.BLOCK_ACTIONS),
  user: Schema.Struct({ id: Schema.String, team_id: Schema.optionalKey(Schema.String) }),
  team: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.String }))),
  container: Schema.optionalKey(
    Schema.Struct({
      channel_id: Schema.optionalKey(Schema.String),
      message_ts: Schema.optionalKey(Schema.String),
    }),
  ),
  actions: Schema.Array(
    Schema.Struct({ action_id: Schema.String, value: Schema.optionalKey(Schema.String) }),
  ),
});

type BlockActions = typeof BlockActionsSchema.Type;

/** Slack's check of the URL as far as it is read: the words it wants back. */
const UrlVerificationSchema = Schema.Struct({
  type: Schema.Literal(SLACK_REQUEST_TYPE.URL_VERIFICATION),
  challenge: Schema.String,
});

/** A request read against the few fields it is read for; every other key Slack sends is dropped unread. */
function readRequest<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

/** Whether Connect's bearer on the request holds, as the verifier says; one that throws or answers nothing holds not. */
function verified(
  verify: ConnectWebhookVerifier,
  authorization: string | undefined,
  body: Uint8Array,
): Effect.Effect<boolean> {
  const headers = authorization === undefined ? undefined : { authorization };
  const request = new Request(new URL(SLACK_EVENTS_PATH, VERIFIED_ORIGIN), {
    method: HTTP_METHOD.POST,
    ...(headers === undefined ? undefined : { headers }),
  });
  return Effect.tryPromise(async () => Boolean(await verify(request, body))).pipe(
    Effect.orElseSucceed(() => false),
  );
}

/** The request's JSON: interactivity's under its form field, an event's as the body is. */
function requestPayload(
  contentType: string | undefined,
  body: Uint8Array,
): Effect.Effect<UnparsedWireValue, HostedRefusal> {
  if (!(contentType ?? "").startsWith(FORM_CONTENT_TYPE)) return parseJsonBytes(body);
  const field = new URLSearchParams(new TextDecoder().decode(body)).get(INTERACTION_FIELD);
  if (field === null) return Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return parseJsonBytes(new TextEncoder().encode(field));
}

/** The first option a press names, with the action id it was pressed under; nothing for a press of any other button. */
function pressedChoice(
  press: BlockActions,
): { readonly choice: SlackChoice; readonly actionId: string } | undefined {
  for (const action of press.actions) {
    if (action.value === undefined) continue;
    const choice = Schema.decodeUnknownOption(SlackChoiceSchema)(action.value);
    if (Option.isSome(choice)) return { choice: choice.value, actionId: action.action_id };
  }
  return undefined;
}

/** The DM a press was made in, where Slack named it. */
function pressedDm(press: BlockActions): SlackMessage | undefined {
  const channel = press.container?.channel_id;
  const ts = press.container?.message_ts;
  return channel === undefined || ts === undefined ? undefined : { channel, ts };
}

/**
 * A press of an option answered as the member who pressed it, and the DM
 * rewritten past the answer: the answer taken says the option chosen
 * through the hand-off's own settling of the item's DMs, and one already
 * taken, or an ask no longer open, is said here. Nothing where the item,
 * the member, or the option is not found.
 */
const answerPress = /* @__PURE__ */ Effect.fnUntraced(function* (press: BlockActions) {
  const pressed = pressedChoice(press);
  if (pressed === undefined) return;
  const { choice, actionId } = pressed;
  const organizationId = yield* hostedStoreOrUnavailable(itemWorkspace(choice.item));
  if (Option.isNone(organizationId)) return;
  const teamId = press.team?.id ?? press.user.team_id;
  if (teamId === undefined) return;
  const member = yield* hostedStoreOrUnavailable(
    (yield* SlackBot).memberOf(organizationId.value, teamId, press.user.id),
  );
  if (Option.isNone(member)) return;
  const line = chosenLine(choice.choice);
  const answered = yield* answerAsMember(
    storeWriter({ tools: CODER_TOOL_SET }),
    member.value,
    choice.item,
    {
      text: "",
      clientKey: actionId,
      attachments: [],
      answers: { ask: choice.ask, reply: INBOX_REPLY.CHOSE, choices: [choice.choice] },
    },
    { messageId: choice.ask, line },
  ).pipe(
    Effect.map(Option.some),
    Effect.catchIf(
      (refusal) => refusal.error === HOSTED_REFUSAL.NOT_FOUND.error,
      () => Effect.succeedNone,
    ),
  );
  const dm = pressedDm(press);
  if (Option.isNone(answered) || dm === undefined) return;
  const { item, outcome } = answered.value;
  if (outcome === INBOX_ASK_ANSWER.TAKEN) return;
  const message = (item.thread ?? []).find((each) => each.id === choice.ask);
  const status = message?.ask?.status;
  // A refused answer to an ask still open leaves the DM's buttons standing.
  if (outcome === INBOX_ASK_ANSWER.REFUSED && status === INBOX_ASK_STATUS.OPEN) return;
  const said = outcome === INBOX_ASK_ANSWER.REPEATED ? line : settledLine(status);
  yield* afterResponse(
    "a pressed Slack DM",
    rewriteThreadDm(dm, choice.item, { text: message?.text ?? "" }, said),
  );
});

/** POST: one request Connect forwarded, its bearer confirmed before anything of it is read. */
const eventsEndpoint = (verify: ConnectWebhookVerifier) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const body = yield* readBodyBytesEffect(MAXIMUM_REQUEST_BYTES);
    if (!(yield* verified(verify, request.headers.authorization, body))) {
      yield* Effect.logWarning("A Slack request was refused: Connect's bearer did not hold");
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    const payload = yield* requestPayload(request.headers["content-type"], body);
    const check = readRequest(UrlVerificationSchema, payload);
    if (Result.isSuccess(check)) {
      yield* Effect.logInfo("A Slack request was heard", {
        kind: SLACK_REQUEST_TYPE.URL_VERIFICATION,
      });
      return hostedJsonResponse(200, { challenge: check.success.challenge });
    }
    const press = readRequest(BlockActionsSchema, payload);
    if (Result.isSuccess(press)) {
      yield* Effect.logInfo("A Slack request was heard", {
        kind: SLACK_REQUEST_TYPE.BLOCK_ACTIONS,
      });
      yield* answerPress(press.success);
    } else yield* actOnSlackEvent(payload, request.headers[SLACK_RETRY_HEADER] !== undefined);
    return hostedJsonResponse(200, {});
  });

/**
 * The group: the one path Connect forwards to, and the hosted vocabulary's
 * own refusal for any other. The verifier is Connect's own unless a caller
 * hands another, as a test does in place of Vercel's keys.
 */
export function slackEventsApp(verify: ConnectWebhookVerifier = createConnectWebhookVerifier()) {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, SLACK_EVENTS_PATH, hostedRefusing(eventsEndpoint(verify))),
    hostedNotFoundRoute,
  );
}
