import { HTTP_METHOD } from "@sidecar/wire";
import { Effect } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { type AccountCallEffects, accountBearer, accountCall } from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  type GitHubConnection,
  githubConnectAnswerSchema,
  githubConnectionSchema,
  githubDisconnectUrl,
} from "./github-connection-wire.js";
import type { PlanCallResult } from "./plan-client.js";
import { PLAN_CALL_FAILURE } from "./planning-view.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

/**
 * github-connection-client.ts -- whether the signed-in account has GitHub connected, and the page that connects it, as the host asks the service.
 *
 * Every call is the account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. Either answers a result, the one
 * failure being that the service did not answer: a status the host could
 * not read keeps the one it last read, and a connect that did not answer
 * opens nothing.
 */

/** Why a GitHub connection call answered nothing. */
export const GITHUB_CONNECTION_FAILURE = {
  UNANSWERED: PLAN_CALL_FAILURE.UNANSWERED,
} as const;

export type GitHubConnectionFailure =
  (typeof GITHUB_CONNECTION_FAILURE)[keyof typeof GITHUB_CONNECTION_FAILURE];

export type GitHubConnectionResult<Answer> = PlanCallResult<Answer, GitHubConnectionFailure>;

const UNANSWERED = { ok: false, failure: GITHUB_CONNECTION_FAILURE.UNANSWERED } as const;

function resultOf<Answer>(answer: Answer | undefined): GitHubConnectionResult<Answer> {
  return answer === undefined ? UNANSWERED : { ok: true, answer };
}

export interface HostedGitHubConnectionClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

export class HostedGitHubConnectionClient {
  readonly #call: AccountCallEffects;
  readonly #serviceBaseUrl: string;

  constructor(options: HostedGitHubConnectionClientOptions) {
    this.#serviceBaseUrl = options.serviceBaseUrl;
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** Whether the account has GitHub connected, and its login; or that the service did not answer. */
  status(): Effect.Effect<GitHubConnectionResult<GitHubConnection>, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_CONNECTION },
        githubConnectionSchema,
      ),
      resultOf,
    );
  }

  /** The page that connects the account's GitHub, used once; or that the service did not answer. */
  connect(): Effect.Effect<GitHubConnectionResult<{ url: string }>, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.GITHUB_CONNECT },
        githubConnectAnswerSchema,
      ),
      resultOf,
    );
  }

  /** The page that disconnects the account's GitHub, which asks the service nothing until the browser opens it. */
  disconnectUrl(): string {
    return githubDisconnectUrl(this.#serviceBaseUrl);
  }
}
