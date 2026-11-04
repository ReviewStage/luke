/**
 * slack-events-app.ts -- our Slack bot's one inbound route: a press of an ask's button in a member's DM answers the ask, as the member would in the app.
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
 * A press (`block_actions`) is acknowledged at once with an empty answer,
 * as Slack asks within its three seconds, and acted on once the answer has
 * left, a failure logged by its kind alone. It is read for the option
 * button's value, which
 * names the item, the message whose ask it answers, and the option
 * (`SlackChoice`, `thread-dms.ts`), or a do ask's answer, Mark done ticking
 * every step, or for a Submit's, which names no option
 * and is answered with the checkboxes the press's state holds ticked, each
 * found back by its place among the ask's options; a press with none, the
 * Open button's and a tick of a checkbox among them, is acknowledged and
 * nothing else. The presser is found back as
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
import { INBOX_ASK, INBOX_ASK_STATUS, INBOX_REPLY, knownAsk } from "@repo/features/inbox-wire";
import { causeKind } from "@repo/runtime/effect";
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
import { INBOX_ASK_ANSWER, readInboxItem } from "../inbox/inbox-store.js";
import { ANY_METHOD } from "../route.js";
import { actOnSlackEvent } from "./slack-agent-starts.js";
import { SlackBot, type SlackMessage } from "./slack-bot.js";
import {
  chosenLine,
  doneLine,
  itemWorkspace,
  rewriteThreadDm,
  SLACK_PICKS_ACTION,
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

/** A press as far as it is read: who pressed, in which team, the DM it was in, the buttons' action ids and values, and the checkboxes ticked in that DM. */
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
  state: Schema.optionalKey(
    Schema.Struct({
      values: Schema.Record(
        Schema.String,
        Schema.Record(
          Schema.String,
          Schema.Struct({
            selected_options: Schema.optionalKey(
              Schema.Array(Schema.Struct({ value: Schema.String })),
            ),
          }),
        ),
      ),
    }),
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

/** The places among the ask's options of the checkboxes ticked when the press was made; none where the DM holds none. */
function tickedPlaces(press: BlockActions): readonly number[] {
  for (const block of Object.values(press.state?.values ?? {})) {
    const ticked = block[SLACK_PICKS_ACTION]?.selected_options;
    if (ticked !== undefined) return ticked.map(({ value }) => Number(value));
  }
  return [];
}

/** The ask a press answers, as the member reads it; none where the item, the message, or its ask is not found. */
const pressedAsk = /* @__PURE__ */ Effect.fnUntraced(function* (
  member: string,
  choice: SlackChoice,
) {
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(member, choice.item));
  if (Option.isNone(stored)) return undefined;
  const message = (stored.value.item.thread ?? []).find((each) => each.id === choice.ask);
  return message?.ask === undefined ? undefined : knownAsk(message.ask);
});

/**
 * The answer a press gives, with the line its DM says once taken: a do
 * ask's Mark done, every step ticked, or Couldn't do it, none ticked; the
 * option its button names; or for a Submit, the ticked checkboxes' options
 * as the member reads the ask, none where the ask is not found or takes no
 * options, which the ask's own check refuses.
 */
const pressedAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  member: string,
  choice: SlackChoice,
  press: BlockActions,
) {
  const { reply } = choice;
  if (reply !== undefined) {
    const ask = yield* pressedAsk(member, choice);
    const steps = ask?.type === INBOX_ASK.DO ? ask.steps : [];
    const ticked = reply === INBOX_REPLY.DONE ? steps.map((_, at) => at) : [];
    return { answers: { ask: choice.ask, reply, steps: ticked }, line: doneLine(reply) };
  }
  if (choice.choice !== undefined) {
    const choices = [choice.choice];
    const answers = { ask: choice.ask, reply: INBOX_REPLY.CHOSE, choices };
    return { answers, line: chosenLine(choices) };
  }
  const ask = yield* pressedAsk(member, choice);
  const options = ask?.type === INBOX_ASK.DECIDE ? ask.options : [];
  const choices = tickedPlaces(press).flatMap((place) => {
    const option = options[place];
    return option === undefined ? [] : [option.label];
  });
  return {
    answers: { ask: choice.ask, reply: INBOX_REPLY.CHOSE, choices },
    line: chosenLine(choices),
  };
});

/** The DM a press was made in, where Slack named it. */
function pressedDm(press: BlockActions): SlackMessage | undefined {
  const channel = press.container?.channel_id;
  const ts = press.container?.message_ts;
  return channel === undefined || ts === undefined ? undefined : { channel, ts };
}

/**
 * A press of an option, a do ask's button, or a Submit of the options
 * ticked, answered as the member who pressed it, and the DM
 * rewritten past the answer: the answer taken says what was answered
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
  const { answers, line } = yield* pressedAnswer(member.value, choice, press);
  const answered = yield* answerAsMember(
    storeWriter({ tools: CODER_TOOL_SET }),
    member.value,
    choice.item,
    {
      text: "",
      clientKey: actionId,
      attachments: [],
      answers,
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
  yield* rewriteThreadDm(dm, choice.item, { text: message?.text ?? "", ask: message?.ask }, said);
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
      // Slack is answered before the press is acted on, so the press never waits on the agent or on Slack.
      yield* afterResponse(
        "a Slack press",
        answerPress(press.success).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("a Slack press was not acted on", { failure: causeKind(cause) }),
          ),
        ),
      );
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
