import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import type { GitHubConnectAnswer, GitHubConnection } from "./github-connection-wire.js";
import { askHosted, type HostedClient, type HostedFailure, hostedClient } from "./hosted-link.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";
import type { TaskCallResult } from "./task-client.js";
import { GITHUB_DISCONNECT_FAILURE, TASK_CALL_FAILURE } from "./tasks-view.js";

export const GITHUB_CONNECTION_CALL_FAILURE = {
  UNANSWERED: TASK_CALL_FAILURE.UNANSWERED,
  NOT_PERMITTED: GITHUB_DISCONNECT_FAILURE.NOT_PERMITTED,
} as const;

export type GitHubConnectionCallFailure =
  (typeof GITHUB_CONNECTION_CALL_FAILURE)[keyof typeof GITHUB_CONNECTION_CALL_FAILURE];

export type GitHubConnectionCallResult<Answer> = TaskCallResult<
  Answer,
  GitHubConnectionCallFailure
>;

const UNANSWERED = { ok: false, failure: GITHUB_CONNECTION_CALL_FAILURE.UNANSWERED } as const;

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
  credential: CallCredential;
  sessionCredential: CallCredential;
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

export class HostedGitHubConnectionClient {
  readonly #hosted: HostedClient;
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

  connect(): Effect.Effect<
    GitHubConnectionCallResult<GitHubConnectAnswer>,
    never,
    HttpClient.HttpClient
  > {
    return asked(askHosted(this.#hosted.github.connect, undefined));
  }

  status(): Effect.Effect<
    GitHubConnectionCallResult<GitHubConnection>,
    never,
    HttpClient.HttpClient
  > {
    return asked(askHosted(this.#hosted.github.connection, undefined));
  }

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
