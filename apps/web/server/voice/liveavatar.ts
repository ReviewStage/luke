/**
 * liveavatar.ts -- HeyGen LiveAvatar, as the voice service mints and stops one LITE avatar session on Luke's key.
 *
 * A LITE session is minted in two calls: a session token under the API key,
 * then the session started under that token, which answers the LiveKit room
 * the call window watches and the media socket the host speaks Luke's audio
 * into. The API key travels as `X-API-KEY` and the session token as the
 * bearer of the one start call; neither leaves this module, and the grant it
 * answers carries only what the legs downstream need: the room's address and
 * viewer token, the media socket, and the session's cap.
 *
 * A failure is answered as a fixed word and, where LiveAvatar answered at
 * all, its status, never as an error carrying LiveAvatar's body, which
 * nothing here can vouch for holding no credential.
 */

import { readEither } from "@sidecar/wire/effect";
import { Context, Data, Effect, Layer, Redacted, Result, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import {
  accountCall,
  callAnswered,
  EXCESS_KEYS,
  HTTP_METHOD,
  HTTP_STATUS,
  NO_CREDENTIAL,
  type WireValue,
} from "../core.js";

const LIVEAVATAR_DEFAULTS = {
  BASE_URL: "https://api.liveavatar.com",
  REQUEST_TIMEOUT_MS: 15_000,
  /**
   * The cap a started session is read as holding when LiveAvatar names none:
   * the shortest cap of any paid plan, so a session is never thought to run
   * longer than the plan lets it.
   */
  MAX_SECONDS: 20 * 60,
} as const;

const LIVEAVATAR_PATH = {
  TOKEN: "/v1/sessions/token",
  START: "/v1/sessions/start",
  STOP: "/v1/sessions/stop",
} as const;

/** The session shape Luke asks for: LITE, since the voice stays GPT Live's and LiveAvatar only renders it. */
const LIVEAVATAR_MODE = { LITE: "LITE" } as const;
const LIVEAVATAR_VIDEO_QUALITY = { HIGH: "high" } as const;

/** Why a call to LiveAvatar answered nothing usable. */
export const LIVEAVATAR_FAILURE = {
  /** LiveAvatar answered a status other than success. */
  HTTP: "http",
  /** LiveAvatar could not be reached, or did not answer within the deadline. */
  NETWORK: "network",
  /** LiveAvatar answered success with a body this build cannot read. */
  MALFORMED: "malformed",
} as const;

export type LiveAvatarFailure = (typeof LIVEAVATAR_FAILURE)[keyof typeof LIVEAVATAR_FAILURE];

/** Why Luke ends a session, in LiveAvatar's own `SessionEndReasonEnum` words. */
export const LIVEAVATAR_STOP_REASON = {
  /** The developer turned the video off or hung up. */
  USER_CLOSED: "USER_CLOSED",
  /** The call ended without the developer asking: the device detached or the session closed. */
  USER_DISCONNECTED: "USER_DISCONNECTED",
  /** Luke's side of the avatar failed, its media socket lost among them. */
  SERVER_ERROR: "SERVER_ERROR",
  /** The sweep found the session's call gone. */
  ZOMBIE_SESSION_REAP: "ZOMBIE_SESSION_REAP",
} as const;

type LiveAvatarStopReason = (typeof LIVEAVATAR_STOP_REASON)[keyof typeof LIVEAVATAR_STOP_REASON];

export class LiveAvatarError extends Data.TaggedError("LiveAvatarError")<{
  readonly failure: LiveAvatarFailure;
  /** LiveAvatar's status, where it answered one. */
  readonly status?: number;
}> {
  override get message(): string {
    const words: string[] = [`LiveAvatar answered ${this.failure}`];
    if (this.status !== undefined) words.push(String(this.status));
    return words.join(" ");
  }
}

/** One started avatar session, as much of it as the legs downstream are handed. */
export interface AvatarGrant {
  readonly sessionId: string;
  /** The LiveKit server the avatar publishes into. */
  readonly livekitUrl: string;
  /** The token that joins the avatar's room to watch it; the call window is the one place it may reach. */
  readonly viewerToken: string;
  /** The LITE media socket the host speaks Luke's audio into. */
  readonly mediaUrl: string;
  /** How long LiveAvatar lets the session run. */
  readonly maxSeconds: number;
}

export interface LiveAvatarService {
  /** Mints and starts one LITE session of the configured avatar. */
  readonly start: () => Effect.Effect<AvatarGrant, LiveAvatarError>;
  /** Ends a session; one LiveAvatar no longer knows has already ended, so a 404 is success. */
  readonly stop: (
    sessionId: string,
    reason: LiveAvatarStopReason,
  ) => Effect.Effect<void, LiveAvatarError>;
}

export interface LiveAvatarOptions {
  readonly apiKey: Redacted.Redacted;
  readonly avatarId: string;
  /** The API's base; a test points it elsewhere. */
  readonly baseUrl?: string | undefined;
  readonly requestTimeoutMs?: number | undefined;
}

const keptText = Schema.String.check(Schema.isNonEmpty());

/** Every answer comes in LiveAvatar's envelope, the payload under `data`. */
function envelopeOf<Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.Struct({ data: Schema.Struct(fields) });
}

const tokenAnswerSchema = envelopeOf({ session_id: keptText, session_token: keptText });

const startAnswerSchema = envelopeOf({
  livekit_url: keptText,
  livekit_client_token: keptText,
  // Optional in LiveAvatar's schema, which documents it for custom mode, and
  // required here: a LITE session without its media socket is one the host
  // can speak nothing into.
  ws_url: keptText,
  max_session_duration: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});

/** The three calls over the ambient client. */
function liveAvatarService(
  options: LiveAvatarOptions,
  client: HttpClient.HttpClient,
): LiveAvatarService {
  // The headers each call carries are its own, so the call takes no credential.
  const call = accountCall({
    baseUrl: options.baseUrl ?? LIVEAVATAR_DEFAULTS.BASE_URL,
    credential: NO_CREDENTIAL,
    requestTimeoutMs: options.requestTimeoutMs ?? LIVEAVATAR_DEFAULTS.REQUEST_TIMEOUT_MS,
  });
  const keyHeaders = { "x-api-key": Redacted.value(options.apiKey) };

  /**
   * One POST, its success read through the answer's schema. A success the
   * schema refuses is malformed, and the payload's own words go nowhere.
   */
  const post = <Answer, Encoded>(
    path: string,
    headers: Record<string, string>,
    body: WireValue,
    answer: Schema.Codec<Answer, Encoded>,
  ): Effect.Effect<Answer, LiveAvatarError> =>
    Effect.gen(function* () {
      const sent = yield* call.send({
        method: HTTP_METHOD.POST,
        path,
        headers,
        body: JSON.stringify(body),
      });
      if (!callAnswered(sent)) {
        return yield* new LiveAvatarError({ failure: LIVEAVATAR_FAILURE.NETWORK });
      }
      if (!sent.response.ok) {
        return yield* new LiveAvatarError({
          failure: LIVEAVATAR_FAILURE.HTTP,
          status: sent.response.status,
        });
      }
      const payload = yield* Effect.orElseSucceed(
        Effect.tryPromise(() => sent.response.json()),
        () => undefined,
      );
      const read = readEither(answer, { excess: EXCESS_KEYS.DROP })(payload);
      if (Result.isFailure(read)) {
        return yield* new LiveAvatarError({ failure: LIVEAVATAR_FAILURE.MALFORMED });
      }
      return read.success;
    }).pipe(Effect.provideService(HttpClient.HttpClient, client));

  const stop: LiveAvatarService["stop"] = (sessionId, reason) =>
    Effect.gen(function* () {
      const sent = yield* call.send({
        method: HTTP_METHOD.POST,
        path: LIVEAVATAR_PATH.STOP,
        headers: keyHeaders,
        body: JSON.stringify({ session_id: sessionId, reason }),
      });
      if (!callAnswered(sent)) {
        return yield* new LiveAvatarError({ failure: LIVEAVATAR_FAILURE.NETWORK });
      }
      // A 404 is a session already ended, by LiveAvatar's own cap or whoever stopped it first.
      if (!sent.response.ok && sent.response.status !== HTTP_STATUS.NOT_FOUND) {
        return yield* new LiveAvatarError({
          failure: LIVEAVATAR_FAILURE.HTTP,
          status: sent.response.status,
        });
      }
    }).pipe(Effect.provideService(HttpClient.HttpClient, client));

  const start: LiveAvatarService["start"] = () =>
    Effect.gen(function* () {
      const minted = yield* post(
        LIVEAVATAR_PATH.TOKEN,
        keyHeaders,
        {
          mode: LIVEAVATAR_MODE.LITE,
          avatar_id: options.avatarId,
          video_settings: { quality: LIVEAVATAR_VIDEO_QUALITY.HIGH },
        },
        tokenAnswerSchema,
      );
      const sessionId = minted.data.session_id;
      // Note that a start that fails still stops the minted session, because
      // LiveAvatar may have begun one this side will never hear of again.
      const started = yield* post(
        LIVEAVATAR_PATH.START,
        { authorization: `Bearer ${minted.data.session_token}` },
        {},
        startAnswerSchema,
      ).pipe(
        Effect.tapError(() => Effect.ignore(stop(sessionId, LIVEAVATAR_STOP_REASON.SERVER_ERROR))),
      );
      return {
        sessionId,
        livekitUrl: started.data.livekit_url,
        viewerToken: started.data.livekit_client_token,
        mediaUrl: started.data.ws_url,
        maxSeconds: started.data.max_session_duration ?? LIVEAVATAR_DEFAULTS.MAX_SECONDS,
      };
    });

  return { start, stop };
}

export class LiveAvatar extends Context.Service<LiveAvatar, LiveAvatarService>()("LiveAvatar") {
  /** The client on Luke's key and the deployment's avatar, over the ambient `HttpClient`. */
  static layer(options: LiveAvatarOptions): Layer.Layer<LiveAvatar, never, HttpClient.HttpClient> {
    return Layer.effect(
      LiveAvatar,
      Effect.gen(function* () {
        return liveAvatarService(options, yield* HttpClient.HttpClient);
      }),
    );
  }
}
