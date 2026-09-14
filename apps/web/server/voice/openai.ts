import { readEither } from "@sidecar/wire/effect";
import { Data, Effect, type Layer, Result, type Scope } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { WebSocket } from "ws";
import {
  accountCall,
  callAnswered,
  EXCESS_KEYS,
  fixedBearer,
  HTTP_METHOD,
  withoutTrailingSlash,
} from "../core.js";
import {
  LIVE_SESSION_OUTCOME,
  LIVE_SESSIONS_PATH,
  type LiveCreateAnswer,
  type LiveSessionConfig,
  liveAttachPath,
  liveCreateAnswerSchema,
  liveCreateRequest,
} from "../live.js";
import { SOCKET_CLOSE_CODE } from "./socket.js";

/**
 * How the service reaches OpenAI on Luke's project key: the one POST that
 * creates a WebRTC session from the device's offer, and the one socket that
 * attaches this service's sideband to it. The key travels as the bearer on
 * both and nowhere else; a failure is answered as an outcome name and a
 * status, never as an error whose words could carry the key.
 *
 * Both answer effects the session's own scope runs. The sideband is acquired
 * in that scope, so a session refused after the attach, or a fiber interrupted
 * while the handshake was still open, leaves no socket standing: the scope's
 * close resumes it — a paused socket cannot complete its close handshake — and
 * closes it.
 */

const OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  CREATE_TIMEOUT_MS: 15_000,
  ATTACH_TIMEOUT_MS: 15_000,
} as const;

type LiveCreateResult =
  | { outcome: typeof LIVE_SESSION_OUTCOME.SUCCEEDED; answer: LiveCreateAnswer }
  | { outcome: typeof LIVE_SESSION_OUTCOME.HTTP_ERROR; status: number }
  | { outcome: typeof LIVE_SESSION_OUTCOME.NETWORK_ERROR; errorName: string | undefined }
  | { outcome: typeof LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE };

/** The sideband did not stand: the handshake was refused, failed, or ran past its wait. */
class SidebandNotAttached extends Data.TaggedError("SidebandNotAttached") {}

export interface LiveUpstreamOptions {
  apiKey: string;
  /** The API's `/v1` base; a test points it at a fake. The attach socket derives from the same base. */
  baseUrl?: string | undefined;
  httpClient?: Layer.Layer<HttpClient.HttpClient> | undefined;
  createTimeoutMs?: number | undefined;
  attachTimeoutMs?: number | undefined;
}

export interface LiveUpstream {
  create(config: LiveSessionConfig, sdpOffer: string): Effect.Effect<LiveCreateResult>;
  /**
   * The sideband open and paused in the caller's scope, so nothing it speaks
   * is emitted before every consumer listens; the caller resumes it once they
   * do, and reads then what arrived meanwhile.
   */
  attach(sessionId: string): Effect.Effect<WebSocket, SidebandNotAttached, Scope.Scope>;
}

const WS_PROTOCOL = { SECURE: "wss:", PLAIN: "ws:", PLAIN_HTTP: "http:" } as const;

/** The `wss` address of a session's attach path under the same base the session was created at. */
function attachAddress(baseUrl: string, sessionId: string): string {
  const url = new URL(`${withoutTrailingSlash(baseUrl)}${liveAttachPath(sessionId)}`);
  url.protocol = url.protocol === WS_PROTOCOL.PLAIN_HTTP ? WS_PROTOCOL.PLAIN : WS_PROTOCOL.SECURE;
  return url.toString();
}

export function createLiveUpstream(options: LiveUpstreamOptions): LiveUpstream {
  const baseUrl = options.baseUrl ?? OPENAI_DEFAULTS.BASE_URL;
  const credential = fixedBearer(options.apiKey);
  const call = accountCall({
    baseUrl,
    credential,
    requestTimeoutMs: options.createTimeoutMs ?? OPENAI_DEFAULTS.CREATE_TIMEOUT_MS,
  });
  const client = options.httpClient ?? FetchHttpClient.layer;
  const attachTimeoutMs = options.attachTimeoutMs ?? OPENAI_DEFAULTS.ATTACH_TIMEOUT_MS;

  return {
    create: (config, sdpOffer) =>
      Effect.gen(function* () {
        const answer = yield* call.send({
          method: HTTP_METHOD.POST,
          path: LIVE_SESSIONS_PATH,
          body: JSON.stringify(liveCreateRequest(config, sdpOffer)),
        });
        if (!callAnswered(answer)) {
          return { outcome: LIVE_SESSION_OUTCOME.NETWORK_ERROR, errorName: answer.errorName };
        }
        if (!answer.response.ok) {
          return { outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR, status: answer.response.status };
        }
        const payload = yield* Effect.orElseSucceed(
          Effect.tryPromise(() => answer.response.json()),
          () => undefined,
        );
        // The provider names more of a created session than the two fields
        // this build reads, so the read drops what it does not name.
        const created = Result.getOrUndefined(
          readEither(liveCreateAnswerSchema, { excess: EXCESS_KEYS.DROP })(payload),
        );
        return created
          ? { outcome: LIVE_SESSION_OUTCOME.SUCCEEDED, answer: created }
          : { outcome: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE };
      }).pipe(Effect.provide(client)),

    attach: (sessionId) =>
      Effect.gen(function* () {
        const authorization = credential.authorization && (yield* credential.authorization());
        const socket = yield* Effect.acquireRelease(
          Effect.sync(
            () =>
              new WebSocket(attachAddress(baseUrl, sessionId), {
                headers: authorization === undefined ? {} : { authorization },
                followRedirects: false,
              }),
          ),
          (open) =>
            Effect.sync(() => {
              // Resumed first: a paused socket cannot complete its close handshake.
              open.resume();
              open.close(SOCKET_CLOSE_CODE.GOING_AWAY);
            }),
        );
        yield* Effect.callback<void, SidebandNotAttached>((resume) => {
          socket.once("open", () => {
            // Paused here, inside the open handler, and not by the caller: the
            // bytes that followed the handshake response are re-queued on the
            // stream and flushed on the next tick, which runs before any fiber
            // continuation, so a frame in that same chunk would otherwise be
            // emitted to nobody.
            socket.pause();
            resume(Effect.void);
          });
          socket.once("error", () => resume(Effect.fail(new SidebandNotAttached())));
          socket.once("unexpected-response", () => resume(Effect.fail(new SidebandNotAttached())));
        }).pipe(
          Effect.timeoutOrElse({
            duration: attachTimeoutMs,
            orElse: () => Effect.fail(new SidebandNotAttached()),
          }),
        );
        return socket;
      }),
  };
}
