import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Effect, type Schema as EffectSchema, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallCredential,
  callAnswered,
  sendInSession,
} from "./account-call.js";
import {
  type GitHubConnectAnswer,
  type GitHubConnection,
  githubConnectAnswerSchema,
  githubConnectionAnswerSchema,
} from "./github-connection-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR, hostedErrorSchema, readServiceAnswer } from "./service-wire.js";
import type { TaskCallResult } from "./task-client.js";
import { GITHUB_DISCONNECT_FAILURE, TASK_CALL_FAILURE } from "./tasks-view.js";

/**
 * github-connection-client.ts -- whether the signed-in account has connected its GitHub, and the page that connects it, as the host asks the service for them.
 *
 * Every call is the account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. Each answers a result, as the
 * workspace client's calls do, so a caller tells a service that did not
 * answer apart from an answer it can draw. A disconnect is Better Auth's own
 * unlink on the service, so it carries the Mac's Better Auth session rather
 * than its OAuth token, asking for one through the browser's hand-off where
 * there is none.
 */

/** Why a GitHub connection call has no answer: the service never gave one the wire reads. */
export const GITHUB_CONNECTION_CALL_FAILURE = {
  UNANSWERED: TASK_CALL_FAILURE.UNANSWERED,
  /** GitHub is the account's only way to sign in, so the service keeps it linked. */
  NOT_PERMITTED: GITHUB_DISCONNECT_FAILURE.NOT_PERMITTED,
} as const;

export type GitHubConnectionCallFailure =
  (typeof GITHUB_CONNECTION_CALL_FAILURE)[keyof typeof GITHUB_CONNECTION_CALL_FAILURE];

/** A connect or a status read: its answer, or why there is none. */
export type GitHubConnectionCallResult<Answer> = TaskCallResult<
  Answer,
  GitHubConnectionCallFailure
>;

const UNANSWERED = { ok: false, failure: GITHUB_CONNECTION_CALL_FAILURE.UNANSWERED } as const;

/** One call read whole by its schema; anything else is unanswered. */
function asked<Answer, Encoded>(
  call: AccountCallEffects,
  request: Parameters<AccountCallEffects["ask"]>[0],
  schema: EffectSchema.Codec<Answer, Encoded>,
): Effect.Effect<GitHubConnectionCallResult<Answer>, never, HttpClient.HttpClient> {
  return Effect.map(call.ask(request, schema), (answer) =>
    answer === undefined ? UNANSWERED : ({ ok: true, answer } as const),
  );
}

export interface HostedGitHubConnectionClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The Mac's own Better Auth session, for the calls that write through Better Auth's organization endpoints. */
  sessionCredential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

export class HostedGitHubConnectionClient {
  readonly #call: AccountCallEffects;
  /** The send for the disconnect, under the Mac's session. */
  readonly #inSession: AccountCallEffects["send"];

  constructor(options: HostedGitHubConnectionClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#inSession = sendInSession(
      accountCall({
        baseUrl: options.serviceBaseUrl,
        credential: options.sessionCredential,
        requestTimeoutMs: options.requestTimeoutMs,
      }),
      options.sessionCredential,
    );
  }

  /** A new connect intent: the page the browser opens to connect the account's GitHub. */
  connect(): Effect.Effect<
    GitHubConnectionCallResult<GitHubConnectAnswer>,
    never,
    HttpClient.HttpClient
  > {
    return asked(
      this.#call,
      { method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.GITHUB_CONNECT },
      githubConnectAnswerSchema,
    );
  }

  /** Whether the account has connected its GitHub, and its login where the service holds one. */
  status(): Effect.Effect<
    GitHubConnectionCallResult<GitHubConnection>,
    never,
    HttpClient.HttpClient
  > {
    return asked(
      this.#call,
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_CONNECTION },
      githubConnectionAnswerSchema,
    );
  }

  /** The account's GitHub disconnected on the service, answering the connection as it then stands. */
  disconnect(): Effect.Effect<
    GitHubConnectionCallResult<GitHubConnection>,
    never,
    HttpClient.HttpClient
  > {
    const send = this.#inSession;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.GITHUB_DISCONNECT,
      });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(
        yield* Effect.promise(
          (): Promise<WireBoundaryInput> => answer.response.json().catch(() => undefined),
        ),
      );
      if (!answer.response.ok) {
        const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
        return refusal === HOSTED_API_ERROR.NOT_PERMITTED
          ? ({ ok: false, failure: GITHUB_CONNECTION_CALL_FAILURE.NOT_PERMITTED } as const)
          : UNANSWERED;
      }
      const read = Result.getOrUndefined(readServiceAnswer(githubConnectionAnswerSchema)(payload));
      return read === undefined ? UNANSWERED : ({ ok: true, answer: read } as const);
    });
  }
}
