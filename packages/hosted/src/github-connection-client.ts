import { HTTP_METHOD } from "@sidecar/wire";
import { Effect, type Schema as EffectSchema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { type AccountCallEffects, accountBearer, accountCall } from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  type GitHubConnectAnswer,
  type GitHubConnection,
  githubConnectAnswerSchema,
  githubConnectionAnswerSchema,
} from "./github-connection-wire.js";
import type { PlanCallResult } from "./plan-client.js";
import { PLAN_CALL_FAILURE } from "./planning-view.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

/**
 * github-connection-client.ts -- whether the signed-in account has connected its GitHub, and the page that connects it, as the host asks the service for them.
 *
 * Every call is the account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. Each answers a result, as the
 * workspace client's calls do, so a caller tells a service that did not
 * answer apart from an answer it can draw.
 */

/** Why a GitHub connection call has no answer: the service never gave one the wire reads. */
export const GITHUB_CONNECTION_CALL_FAILURE = {
  UNANSWERED: PLAN_CALL_FAILURE.UNANSWERED,
} as const;

export type GitHubConnectionCallFailure =
  (typeof GITHUB_CONNECTION_CALL_FAILURE)[keyof typeof GITHUB_CONNECTION_CALL_FAILURE];

/** A connect or a status read: its answer, or why there is none. */
export type GitHubConnectionCallResult<Answer> = PlanCallResult<
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

export interface HostedGitHubConnectionClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

export class HostedGitHubConnectionClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedGitHubConnectionClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
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
}
