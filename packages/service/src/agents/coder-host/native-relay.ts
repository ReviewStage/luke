/**
 * native-relay.ts -- the native harnesses as an eve app reaches them: each call relayed to the web function that launches the runner, under the deployment's own secret.
 *
 * Only the web functions ship the runner's bundle (`apps/web/server/native-agents.ts`),
 * so only they provide `NativeAgentSessions` over the harnesses themselves.
 * The eve app, an eve agent's tools in `apps/dev`, provides this one in
 * its place (`nativeRelayLayer`): every
 * `open`, `send`, `cancel`, and `reset` the router hands a native harness
 * (`runtime-sessions.ts`) is posted to the web's relay route
 * (`native-relay-app.ts`) as the deployment acting for the account the
 * router named, and the route answers it with the harness's own outcome. The
 * eve app therefore bundles no runner, and the router, a Start's runtime
 * choice (`agent-runtime-choice.ts`), and every caller above them read a
 * harness here as they read one in a web function.
 *
 * The bearer is `EVE_DEPLOYMENT_SECRET`, the one the web already presents at
 * eve's door, never the cron's; the route admits nothing else. A deployment
 * that names no secret or no origin opens no harness, which the router
 * answers as `RUNTIME_REFUSAL.NOT_HERE`, as before. A message carries no
 * token: its words and files are what the harness is handed, as it is
 * handed them from the panel.
 */

import { readEither } from "@luke/wire/effect";
import type { UserContent } from "ai";
import { Effect, Layer, Option, Redacted, Result, Schema, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../../core.js";
import { HostedEnvironment } from "../../environment.js";
import { HOSTED_API_ERROR } from "../../http/http.js";
import { ACCOUNT_ID_PATTERN, BRAIN_HOST_TURN, type BrainHostTurn } from "../brain-host/bounds.js";
import { deploymentEveOrigin } from "../brain-host/eve-origin.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  EveUnreachable,
  PLAN_REFUSAL,
  RUNTIME_REFUSAL,
} from "../brain-host/eve-sessions.js";
import { NATIVE_SESSION_PREFIX, type NativeRuntime } from "./native-runtime.js";
import { NativeAgentSessions, type NativeSessions, RUNNER_CHOICE } from "./runtime-sessions.js";

/** The path the web function answers a relayed call on. */
export const NATIVE_RELAY_PATH = "/api/agents/native-sessions";

/** The calls a harness takes by name; `stream` is none, since a runner posts its own events. */
export const NATIVE_RELAY_CALL = {
  OPEN: "open",
  SEND: "send",
  CANCEL: "cancel",
  RESET: "reset",
  /** The agent's model and effort as its row now holds them, handed to its runner (`runnerChoiceApplied`). */
  RETUNE: "retune",
} as const;

/** Every native harness, by the prefix each mints its sessions under, so one added to the column is relayed with no change here. */
// SAFETY: the keys are `NATIVE_SESSION_PREFIX`'s own, a record over every native runtime.
const NATIVE_RUNTIMES = Object.keys(NATIVE_SESSION_PREFIX) as NativeRuntime[];

const NativeRuntimeSchema = Schema.Literals(NATIVE_RUNTIMES);
const AccountSchema = Schema.String.check(Schema.isPattern(ACCOUNT_ID_PATTERN));
const SessionIdSchema = Schema.String.check(Schema.isNonEmpty());

/**
 * A message as the harness is handed it. The words, or the AI SDK's user
 * content where files ride along (`attached-files.ts`), which carries each
 * file as a `data:` URL and so crosses as JSON whole.
 */
const RelayedMessageSchema = Schema.Struct({
  conversationId: Schema.String.check(Schema.isNonEmpty()),
  turn: Schema.Literals(Object.values(BRAIN_HOST_TURN)),
  message: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]),
  timeZone: Schema.optionalKey(Schema.String),
  lineId: Schema.optionalKey(Schema.String),
});

/** One relayed call: which, on which harness, acting for whom, and what it names. */
export const NativeRelayCallSchema = Schema.Union([
  Schema.Struct({
    call: Schema.Literal(NATIVE_RELAY_CALL.OPEN),
    runtime: NativeRuntimeSchema,
    account: AccountSchema,
    message: RelayedMessageSchema,
  }),
  Schema.Struct({
    call: Schema.Literal(NATIVE_RELAY_CALL.SEND),
    runtime: NativeRuntimeSchema,
    account: AccountSchema,
    sessionId: SessionIdSchema,
    message: RelayedMessageSchema,
  }),
  Schema.Struct({
    call: Schema.Literal(NATIVE_RELAY_CALL.CANCEL),
    runtime: NativeRuntimeSchema,
    account: AccountSchema,
    sessionId: SessionIdSchema,
    turnId: SessionIdSchema,
  }),
  Schema.Struct({
    call: Schema.Literal(NATIVE_RELAY_CALL.RESET),
    runtime: NativeRuntimeSchema,
    account: AccountSchema,
    sessionId: SessionIdSchema,
  }),
  Schema.Struct({
    call: Schema.Literal(NATIVE_RELAY_CALL.RETUNE),
    runtime: NativeRuntimeSchema,
    account: AccountSchema,
    sessionId: SessionIdSchema,
    conversationId: SessionIdSchema,
  }),
]);

export type NativeRelayCall = typeof NativeRelayCallSchema.Type;

/** A relayed message as the harness is handed it. */
export function relayedMessage(
  message: (typeof RelayedMessageSchema)["Type"],
): EveMessage<BrainHostTurn> {
  return {
    ...message,
    // SAFETY: the content the eve app was handed as `UserContent` and posted as JSON, which is what a `data:` URL's file part is whole.
    message: message.message as string | UserContent,
  };
}

const FailedSchema = Schema.Struct({
  outcome: Schema.Literal(EVE_SEND_OUTCOME.FAILED),
  status: Schema.Number,
  planRefusal: Schema.optionalKey(Schema.Literals(Object.values(PLAN_REFUSAL))),
  runtimeRefusal: Schema.optionalKey(Schema.Literals(Object.values(RUNTIME_REFUSAL))),
});

const OpenedSchema = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal(EVE_SEND_OUTCOME.ACCEPTED), sessionId: SessionIdSchema }),
  FailedSchema,
]);

const SentSchema = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal(EVE_SEND_OUTCOME.ACCEPTED),
    sessionId: SessionIdSchema,
    deliveryId: SessionIdSchema,
  }),
  Schema.Struct({ outcome: Schema.Literal(EVE_SEND_OUTCOME.RETIRED) }),
  Schema.Struct({ outcome: Schema.Literal(EVE_SEND_OUTCOME.NOT_READY) }),
  FailedSchema,
]);

const StoppedFailedSchema = Schema.Struct({
  outcome: Schema.Literal(EVE_CANCEL_OUTCOME.FAILED),
  status: Schema.Number,
  runtimeRefusal: Schema.optionalKey(Schema.Literals(Object.values(RUNTIME_REFUSAL))),
});

const CancelledSchema = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal(EVE_CANCEL_OUTCOME.ACCEPTED) }),
  Schema.Struct({ outcome: Schema.Literal(EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN) }),
  StoppedFailedSchema,
]);

const ResetSchema = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal(EVE_RESET_OUTCOME.RESET) }),
  Schema.Struct({ outcome: Schema.Literal(EVE_RESET_OUTCOME.NO_ACTIVE_SESSION) }),
  StoppedFailedSchema,
]);

const RefusalSchema = Schema.Struct({ error: Schema.String });

const RetunedSchema = Schema.Struct({ choice: Schema.Literals(Object.values(RUNNER_CHOICE)) });

const OK_STATUS = 200;
const JSON_CONTENT_TYPE = "application/json";

/** A redirect is an error, never followed, because the deployment's bearer travels on the request. */
const RELAY_REQUEST_INIT: RequestInit = { redirect: "error" };

/** What the route answered: its status and its body, unread. */
interface RelayAnswer {
  readonly status: number;
  readonly body: UnparsedWireValue;
}

/** What a call answers where the route did not answer it as the harness: its refusal, by name where the web has no harness either. */
function refusedAs({ status, body }: RelayAnswer) {
  const refusal = readEither(RefusalSchema, { excess: EXCESS_KEYS.DROP })(body);
  const notHere =
    Result.isSuccess(refusal) && refusal.success.error === HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE;
  return {
    outcome: EVE_SEND_OUTCOME.FAILED,
    status,
    ...(notHere ? { runtimeRefusal: RUNTIME_REFUSAL.NOT_HERE } : undefined),
  } as const;
}

/** The harness's own outcome where the route answered with one, and its refusal otherwise. */
function readAnswer<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  return (answer: RelayAnswer): S["Type"] | ReturnType<typeof refusedAs> => {
    if (answer.status !== OK_STATUS) return refusedAs(answer);
    const read = readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.body);
    return Result.isSuccess(read) ? read.success : refusedAs(answer);
  };
}

/** The relay over one client, secret, and origin: each call posted as the deployment acting for the account the router names. */
function relayOver(
  client: HttpClient.HttpClient,
  secret: Redacted.Redacted,
  origin: string,
  runtime: NativeRuntime,
  account: string,
): NativeSessions<BrainHostTurn> {
  const post = (body: NativeRelayCall) =>
    client
      .execute(
        HttpClientRequest.post(new URL(NATIVE_RELAY_PATH, origin), {
          headers: { authorization: `Bearer ${Redacted.value(secret)}` },
        }).pipe(HttpClientRequest.bodyText(JSON.stringify(body), JSON_CONTENT_TYPE)),
      )
      .pipe(
        Effect.flatMap((response) =>
          response.json.pipe(
            Effect.map((body) => unparsedWire(body)),
            Effect.orElseSucceed(() => unparsedWire(undefined)),
            Effect.map((body): RelayAnswer => ({ status: response.status, body })),
          ),
        ),
        Effect.scoped,
        Effect.provideService(FetchHttpClient.RequestInit, RELAY_REQUEST_INIT),
        Effect.mapError((cause) => new EveUnreachable({ cause })),
      );
  const named = { runtime, account } as const;
  return {
    open: (message) =>
      Effect.map(
        post({ call: NATIVE_RELAY_CALL.OPEN, ...named, message }),
        readAnswer(OpenedSchema),
      ),
    send: (sessionId, message) =>
      Effect.map(
        post({ call: NATIVE_RELAY_CALL.SEND, ...named, sessionId, message }),
        readAnswer(SentSchema),
      ),
    cancel: (sessionId, turnId) =>
      Effect.map(
        post({ call: NATIVE_RELAY_CALL.CANCEL, ...named, sessionId, turnId }),
        readAnswer(CancelledSchema),
      ),
    reset: (sessionId) =>
      Effect.map(
        post({ call: NATIVE_RELAY_CALL.RESET, ...named, sessionId }),
        readAnswer(ResetSchema),
      ),
    // A runner posts its events to Luke itself, so there is no stream of its session to follow.
    stream: () => Stream.empty,
    // A change the route did not answer with the runner's own word is said as failed; the row already holds it.
    retune: (sessionId, conversationId) =>
      post({ call: NATIVE_RELAY_CALL.RETUNE, ...named, sessionId, conversationId }).pipe(
        Effect.map(({ status, body }) => {
          const read = readEither(RetunedSchema, { excess: EXCESS_KEYS.DROP })(body);
          return status === OK_STATUS && Result.isSuccess(read)
            ? read.success.choice
            : RUNNER_CHOICE.FAILED;
        }),
        Effect.orElseSucceed(() => RUNNER_CHOICE.FAILED),
      ),
  };
}

export interface NativeRelayOptions {
  /** The deployment's own origin, where the web function answers the relay; none opens no harness. */
  readonly origin?: () => string | undefined;
}

/**
 * The native harnesses as an eve app reaches them, over the calling
 * fiber's client and the deployment's environment, as above.
 */
export function nativeRelayLayer(
  options: NativeRelayOptions = {},
): Layer.Layer<NativeAgentSessions, never, HttpClient.HttpClient | HostedEnvironment> {
  return Layer.effect(
    NativeAgentSessions,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const environment = yield* HostedEnvironment;
      const originOf = options.origin ?? deploymentEveOrigin;
      return {
        sessions: (runtime, account) => {
          const secret = environment.eveDeploymentSecret;
          const origin = originOf();
          if (secret === undefined || origin === undefined) return Option.none();
          return Option.some(Effect.succeed(relayOver(client, secret, origin, runtime, account)));
        },
      };
    }),
  );
}
