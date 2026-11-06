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

const SLACK_EVENTS_PATH = "/api/slack/events";

const MAXIMUM_REQUEST_BYTES = 1024 * 1024;

const INTERACTION_FIELD = "payload";

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

const SLACK_REQUEST_TYPE = {
  BLOCK_ACTIONS: "block_actions",
  URL_VERIFICATION: "url_verification",
} as const;

const SLACK_RETRY_HEADER = "x-slack-retry-num";

const VERIFIED_ORIGIN = "https://slack.connect.invalid";

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

const UrlVerificationSchema = Schema.Struct({
  type: Schema.Literal(SLACK_REQUEST_TYPE.URL_VERIFICATION),
  challenge: Schema.String,
});

function readRequest<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

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

function requestPayload(
  contentType: string | undefined,
  body: Uint8Array,
): Effect.Effect<UnparsedWireValue, HostedRefusal> {
  if (!(contentType ?? "").startsWith(FORM_CONTENT_TYPE)) return parseJsonBytes(body);
  const field = new URLSearchParams(new TextDecoder().decode(body)).get(INTERACTION_FIELD);
  if (field === null) return Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return parseJsonBytes(new TextEncoder().encode(field));
}

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

function tickedPlaces(press: BlockActions): readonly number[] {
  for (const block of Object.values(press.state?.values ?? {})) {
    const ticked = block[SLACK_PICKS_ACTION]?.selected_options;
    if (ticked !== undefined) return ticked.map(({ value }) => Number(value));
  }
  return [];
}

const pressedAsk = /* @__PURE__ */ Effect.fnUntraced(function* (
  member: string,
  choice: SlackChoice,
) {
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(member, choice.item));
  if (Option.isNone(stored)) return undefined;
  const message = (stored.value.item.thread ?? []).find((each) => each.id === choice.ask);
  return message?.ask === undefined ? undefined : knownAsk(message.ask);
});

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

function pressedDm(press: BlockActions): SlackMessage | undefined {
  const channel = press.container?.channel_id;
  const ts = press.container?.message_ts;
  return channel === undefined || ts === undefined ? undefined : { channel, ts };
}

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
  if (outcome === INBOX_ASK_ANSWER.REFUSED && status === INBOX_ASK_STATUS.OPEN) return;
  const said = outcome === INBOX_ASK_ANSWER.REPEATED ? line : settledLine(status);
  yield* rewriteThreadDm(
    dm,
    choice.item,
    { id: choice.ask, text: message?.text ?? "", ask: message?.ask },
    said,
  );
});

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

export function slackEventsApp(verify: ConnectWebhookVerifier = createConnectWebhookVerifier()) {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, SLACK_EVENTS_PATH, hostedRefusing(eventsEndpoint(verify))),
    hostedNotFoundRoute,
  );
}
