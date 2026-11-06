import { HTTP_METHOD } from "@repo/wire";
import { Duration, Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  accountCall,
  CALL_FAULT,
  type CallAnswer,
  type CallCredential,
  callAnswered,
  sendInSession,
} from "./account-call.js";
import {
  ADMIN_HTTP_STATUS,
  ADMIN_READ_PATH,
  ADMIN_REFUSED,
  ADMIN_ROUTE_PATH,
  ADMIN_UNANSWERED,
  ADMIN_USER_ID_PARAM,
  type AdminReadAnswer,
  type AdminReadParams,
  type AdminRefused,
} from "./admin-wire.js";
import { textWithin } from "./hosted-link.js";

interface HostedAdminClientOptions {
  serviceBaseUrl: string;
  sessionCredential: CallCredential;
  requestTimeoutMs?: number | undefined;
}

const REFUSED_BY_STATUS: ReadonlyMap<number, AdminRefused> = new Map([
  [ADMIN_HTTP_STATUS.UNAUTHORIZED, ADMIN_REFUSED.SIGNED_OUT],
  [ADMIN_HTTP_STATUS.FORBIDDEN, ADMIN_REFUSED.FORBIDDEN],
  [ADMIN_HTTP_STATUS.NOT_FOUND, ADMIN_REFUSED.MISSING],
  [ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_REFUSED.UNAVAILABLE],
]);

function withQuery(path: string, query: Readonly<Record<string, string>>): string {
  const parameters = new URLSearchParams(query).toString();
  return parameters ? `${path}?${parameters}` : path;
}

function faultRefused(answer: Exclude<CallAnswer, { response: Response }>): AdminReadAnswer {
  return answer.fault === CALL_FAULT.NETWORK
    ? { refused: ADMIN_REFUSED.UNAVAILABLE }
    : { refused: ADMIN_REFUSED.SIGNED_OUT };
}

function parsedJson(text: string): { readonly json: unknown } | undefined {
  try {
    return { json: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

function favoriteLanded(json: unknown, favorite: boolean): boolean {
  return (
    typeof json === "object" && json !== null && "favorite" in json && json.favorite === favorite
  );
}

export class HostedAdminClient {
  readonly #send: ReturnType<typeof sendInSession>;
  readonly #bodyDeadline: Duration.Duration;

  constructor(options: HostedAdminClientOptions) {
    const call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: options.sessionCredential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#send = sendInSession(call, options.sessionCredential);
    this.#bodyDeadline = Duration.millis(call.requestTimeoutMs);
  }

  read(params: AdminReadParams): Effect.Effect<AdminReadAnswer, never, HttpClient.HttpClient> {
    const send = this.#send;
    const deadline = this.#bodyDeadline;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: HTTP_METHOD.GET,
        path: withQuery(ADMIN_READ_PATH[params.procedure], params.query),
      });
      if (!callAnswered(answer)) return faultRefused(answer);
      const { response } = answer;
      if (!response.ok) {
        return { refused: REFUSED_BY_STATUS.get(response.status) ?? ADMIN_UNANSWERED };
      }
      const text = yield* textWithin(response, deadline);
      if (text === undefined) return { refused: ADMIN_REFUSED.UNAVAILABLE };
      const body = parsedJson(text);
      return body === undefined ? { refused: ADMIN_REFUSED.INTERCEPTED } : { answer: body.json };
    });
  }

  favorite(id: string, favorite: boolean): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const send = this.#send;
    const deadline = this.#bodyDeadline;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: favorite ? HTTP_METHOD.PUT : HTTP_METHOD.DELETE,
        path: withQuery(ADMIN_ROUTE_PATH.FAVORITE, { [ADMIN_USER_ID_PARAM]: id }),
      });
      if (!callAnswered(answer) || !answer.response.ok) return false;
      const text = yield* textWithin(answer.response, deadline);
      const body = text === undefined ? undefined : parsedJson(text);
      return body !== undefined && favoriteLanded(body.json, favorite);
    });
  }
}
