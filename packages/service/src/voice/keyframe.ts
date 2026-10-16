/**
 * keyframe.ts -- Keyframe Labs, as the voice service mints one avatar session on Luke's key.
 *
 * A session is one POST under the API key naming the deployment's persona,
 * answered with the LiveKit server the avatar publishes into, the token that
 * joins it, and the identity the avatar takes there. The key travels as the
 * bearer of that one call and leaves this module nowhere else; the grant it
 * answers is the call window's alone to hold, so nothing here logs either.
 *
 * A failure is answered as a fixed kind and, where Keyframe answered at all,
 * its status, never as an error carrying Keyframe's body, which nothing here
 * can vouch for holding no credential.
 */

import { readEither } from "@luke/wire/effect";
import { Context, Data, Effect, Layer, Redacted, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import {
  accountCall,
  callAnswered,
  EXCESS_KEYS,
  fixedBearer,
  HTTP_METHOD,
  HTTP_STATUS,
} from "../core.js";

const KEYFRAME_DEFAULTS = {
  BASE_URL: "https://api.keyframelabs.com",
  REQUEST_TIMEOUT_MS: 15_000,
} as const;

const KEYFRAME_SESSIONS_PATH = "/v1/sessions";

/** The status Keyframe answers when no avatar worker is free, beside the 429 of a plan's concurrency. */
const SERVICE_UNAVAILABLE = 503;

/** Why Keyframe minted no session. */
export const KEYFRAME_FAILURE = {
  /** Every session the plan allows is standing, or no worker is free: the call goes on as voice. */
  NO_CAPACITY: "no_capacity",
  /** The plan does not allow the session asked for. */
  TASK_REFUSED: "plan_refused",
  /** Any other answer, or none: a status where Keyframe answered one. */
  UPSTREAM: "upstream",
} as const;

export type KeyframeFailure = (typeof KEYFRAME_FAILURE)[keyof typeof KEYFRAME_FAILURE];

export class KeyframeError extends Data.TaggedError("KeyframeError")<{
  readonly failure: KeyframeFailure;
  /** Keyframe's status, where it answered one. */
  readonly status?: number;
}> {
  override get message(): string {
    const words: string[] = [`Keyframe answered ${this.failure}`];
    if (this.status !== undefined) words.push(String(this.status));
    return words.join(" ");
  }
}

/** One minted avatar session: what the call window joins the avatar's room with. */
export interface AvatarGrant {
  /** The LiveKit server the avatar publishes into. */
  readonly serverUrl: string;
  /** The token that joins the room to watch the avatar and speak to it; the call window is the one place it may reach. */
  readonly participantToken: string;
  /** The participant the avatar is in that room. */
  readonly agentIdentity: string;
}

export interface KeyframeService {
  /** Mints one session of the configured persona. */
  readonly createSession: () => Effect.Effect<AvatarGrant, KeyframeError>;
}

export interface KeyframeOptions {
  readonly apiKey: Redacted.Redacted;
  readonly personaId: string;
  /** The API's base; a test points it elsewhere. */
  readonly baseUrl?: string | undefined;
  readonly requestTimeoutMs?: number | undefined;
}

const keptText = Schema.String.check(Schema.isNonEmpty());

const sessionAnswerSchema = Schema.Struct({
  server_url: keptText,
  participant_token: keptText,
  agent_identity: keptText,
});

/** The kind a refusal is read as, by its status alone. */
function refusalOf(status: number): KeyframeFailure {
  if (status === SERVICE_UNAVAILABLE || status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return KEYFRAME_FAILURE.NO_CAPACITY;
  }
  if (status === HTTP_STATUS.FORBIDDEN) return KEYFRAME_FAILURE.TASK_REFUSED;
  return KEYFRAME_FAILURE.UPSTREAM;
}

/** The one call over the ambient client. */
function keyframeService(options: KeyframeOptions, client: HttpClient.HttpClient): KeyframeService {
  const requestTimeoutMs = options.requestTimeoutMs ?? KEYFRAME_DEFAULTS.REQUEST_TIMEOUT_MS;
  const call = accountCall({
    baseUrl: options.baseUrl ?? KEYFRAME_DEFAULTS.BASE_URL,
    credential: fixedBearer(Redacted.value(options.apiKey)),
    requestTimeoutMs,
  });

  // Note that the deadline is taken again around the whole session, because
  // the call's own ends when the headers arrive and a body that stalls after
  // them would otherwise hold the call's voice-only fallback indefinitely.
  const createSession: KeyframeService["createSession"] = () =>
    Effect.gen(function* () {
      const sent = yield* call.send({
        method: HTTP_METHOD.POST,
        path: KEYFRAME_SESSIONS_PATH,
        body: JSON.stringify({ persona_id: options.personaId }),
      });
      if (!callAnswered(sent)) {
        return yield* new KeyframeError({ failure: KEYFRAME_FAILURE.UPSTREAM });
      }
      if (!sent.response.ok) {
        const status = sent.response.status;
        return yield* new KeyframeError({ failure: refusalOf(status), status });
      }
      const payload = yield* Effect.orElseSucceed(
        Effect.tryPromise(() => sent.response.json()),
        () => undefined,
      );
      // A success the schema refuses keeps its status and none of its words.
      const read = readEither(sessionAnswerSchema, { excess: EXCESS_KEYS.DROP })(payload);
      if (Result.isFailure(read)) {
        return yield* new KeyframeError({
          failure: KEYFRAME_FAILURE.UPSTREAM,
          status: sent.response.status,
        });
      }
      return {
        serverUrl: read.success.server_url,
        participantToken: read.success.participant_token,
        agentIdentity: read.success.agent_identity,
      };
    }).pipe(
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.timeoutOrElse({
        duration: requestTimeoutMs,
        orElse: () => Effect.fail(new KeyframeError({ failure: KEYFRAME_FAILURE.UPSTREAM })),
      }),
    );

  return { createSession };
}

export class Keyframe extends Context.Service<Keyframe, KeyframeService>()("Keyframe") {
  /** The client on Luke's key and the deployment's persona, over the ambient `HttpClient`. */
  static layer(options: KeyframeOptions): Layer.Layer<Keyframe, never, HttpClient.HttpClient> {
    return Layer.effect(
      Keyframe,
      Effect.gen(function* () {
        return keyframeService(options, yield* HttpClient.HttpClient);
      }),
    );
  }
}
