import { HTTP_METHOD } from "@luke/wire";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type AccountCallEffects, accountBearer, accountCall } from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  REPOSITORY_RUNS_QUERY,
  type RepositoryRun,
  type RepositoryRunSetRequest,
  repositoryRunsAnswerSchema,
} from "./repository-run-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

/**
 * repository-run-client.ts -- the host's side of a workspace's shared run commands: read before each Run, and set from Settings.
 *
 * The one account call, so the bearer is read fresh per attempt and a 401 is
 * renewed and retried once. Neither call fails: no answer is nothing, which
 * the caller says in its own words.
 */

export interface HostedRepositoryRunClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
}

export class HostedRepositoryRunClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedRepositoryRunClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
    });
  }

  /** The workspace's repositories with commands set; nothing where the service did not answer. */
  list(
    workspaceId: string,
  ): Effect.Effect<readonly RepositoryRun[] | undefined, never, HttpClient.HttpClient> {
    const query = new URLSearchParams({ [REPOSITORY_RUNS_QUERY.WORKSPACE_ID]: workspaceId });
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.REPOSITORY_RUNS}?${query}` },
        repositoryRunsAnswerSchema,
      ),
      (answer) => answer?.runs,
    );
  }

  /** One repository's commands set, or forgotten with both null; the workspace's as they then stand, or nothing. */
  set(
    request: RepositoryRunSetRequest,
  ): Effect.Effect<readonly RepositoryRun[] | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.PUT,
          path: HOSTED_SERVICE_PATH.REPOSITORY_RUNS,
          body: JSON.stringify(request),
        },
        repositoryRunsAnswerSchema,
      ),
      (answer) => answer?.runs,
    );
  }
}
