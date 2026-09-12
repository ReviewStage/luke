import type * as HttpClient from "@effect/platform/HttpClient";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Either, type Layer } from "effect";
import { WebSocket } from "ws";
import {
  callAnswered,
  createAccountCall,
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

/**
 * How the service reaches OpenAI on Luke's project key: the one POST that
 * creates a WebRTC session from the desktop's offer, and the one socket that
 * attaches this service's sideband to it. The key travels as the bearer on
 * both and nowhere else; a failure is answered as an outcome name and a
 * status, never as an error whose words could carry the key.
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

export interface LiveUpstreamOptions {
  apiKey: string;
  /** The API's `/v1` base; a test points it at a fake. The attach socket derives from the same base. */
  baseUrl?: string | undefined;
  httpClient?: Layer.Layer<HttpClient.HttpClient> | undefined;
  createTimeoutMs?: number | undefined;
  attachTimeoutMs?: number | undefined;
}

export interface LiveUpstream {
  create(config: LiveSessionConfig, sdpOffer: string): Promise<LiveCreateResult>;
  /** Resolves once the sideband is open and paused, so nothing it speaks is emitted before a consumer listens, or rejects when it could not attach within the timeout. */
  attach(sessionId: string): Promise<WebSocket>;
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
  const call = createAccountCall({
    baseUrl,
    credential,
    ...(options.httpClient ? { httpClient: options.httpClient } : undefined),
    requestTimeoutMs: options.createTimeoutMs ?? OPENAI_DEFAULTS.CREATE_TIMEOUT_MS,
  });
  const attachTimeoutMs = options.attachTimeoutMs ?? OPENAI_DEFAULTS.ATTACH_TIMEOUT_MS;

  return {
    async create(config, sdpOffer) {
      const answer = await call.send({
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
      const payload = await answer.response.json().catch(() => undefined);
      const created = Either.getOrUndefined(readEither(liveCreateAnswerSchema)(payload));
      return created
        ? { outcome: LIVE_SESSION_OUTCOME.SUCCEEDED, answer: created }
        : { outcome: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE };
    },

    async attach(sessionId) {
      // The one credential this upstream ever holds is `fixedBearer`'s, which
      // answers `Effect.succeed` and nothing else, so running it here defers
      // no asynchronous work.
      const authorization = credential.authorization && Effect.runSync(credential.authorization());
      const socket = new WebSocket(attachAddress(baseUrl, sessionId), {
        headers: authorization === undefined ? {} : { authorization },
        followRedirects: false,
      });
      return new Promise<WebSocket>((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.terminate();
          reject(new Error("The sideband did not attach within its timeout"));
        }, attachTimeoutMs);
        socket.once("open", () => {
          clearTimeout(timer);
          // Paused here, inside the open handler, and not by the caller: the
          // bytes that followed the handshake response are re-queued on the
          // stream and flushed on the next tick, which runs before any promise
          // continuation, so a frame in that same chunk would otherwise be
          // emitted to nobody. The service resumes the socket once every
          // consumer listens, and reads then what arrived meanwhile.
          socket.pause();
          resolve(socket);
        });
        socket.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        socket.once("unexpected-response", (_request, response) => {
          clearTimeout(timer);
          socket.terminate();
          reject(new Error(`The attach handshake was refused with status ${response.statusCode}`));
        });
      });
    },
  };
}
