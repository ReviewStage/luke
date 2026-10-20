import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import type { GitHubConnectAnswer, GitHubConnection } from "./github-connection-wire.js";
import { askHosted, type HostedClient, type HostedFailure, hostedClient } from "./hosted-link.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";
import type { TaskCallResult } from "./task-client.js";
import { GITHUB_DISCONNECT_FAILURE, TASK_CALL_FAILURE } from "./tasks-view.js";

/**
 * github-connection-client.ts -- whether the signed-in account has connected its GitHub, and the page that connects it, as the host asks the service for them.
 *
 * Every call is a procedure of the hosted contract over the account call
 * (`hosted-link.ts`), so the bearer is read fresh per attempt and a 401 is
 * renewed and retried once. Each answers a result, as the
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

/** A procedure's answer as a result; a refusal the caller names is that failure, and anything else unanswered. */
function asked<Answer>(
  procedure: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
  named: Readonly<Partial<Record<HostedApiError, GitHubConnectionCallFailure>>> = {},
): Effect.Effect<GitHubConnectionCallResult<Answer>, never, HttpClient.HttpClient> {
  return Effect.match(procedure, {
    onSuccess: (answer) => ({ ok: true, answer }) as const,
    onFailure: (failed) => {
      const failure = failed._tag === "HostedRefused" ? named[failed.refusal] : undefined;
      return failure === undefined ? UNANSWERED : ({ ok: false, failure } as const);
    },
  });
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
  readonly #hosted: HostedClient;
  /** The client for the disconnect, under the Mac's session. */
  readonly #inSession: HostedClient;

  constructor(options: HostedGitHubConnectionClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#inSession = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.sessionCredential,
      requestTimeoutMs: options.requestTimeoutMs,
      inSession: true,
    });
  }

  /** A new connect intent: the page the browser opens to connect the account's GitHub. */
  connect(): Effect.Effect<
    GitHubConnectionCallResult<GitHubConnectAnswer>,
    never,
    HttpClient.HttpClient
  > {
    return asked(askHosted(this.#hosted.github.connect, undefined));
  }

  /** Whether the account has connected its GitHub, and its login where the service holds one. */
  status(): Effect.Effect<
    GitHubConnectionCallResult<GitHubConnection>,
    never,
    HttpClient.HttpClient
  > {
    return asked(askHosted(this.#hosted.github.connection, undefined));
  }

  /** The account's GitHub disconnected on the service, answering the connection as it then stands. */
  disconnect(): Effect.Effect<
    GitHubConnectionCallResult<GitHubConnection>,
    never,
    HttpClient.HttpClient
  > {
    return asked(askHosted(this.#inSession.github.disconnect, undefined), {
      [HOSTED_API_ERROR.NOT_PERMITTED]: GITHUB_CONNECTION_CALL_FAILURE.NOT_PERMITTED,
    });
  }
}
