import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { ISSUE_ARCHIVED_QUERY } from "./contract/issues.js";
import { askHosted, type HostedClient, type HostedFailure, hostedClient } from "./hosted-link.js";
import {
  ISSUE_CALL_FAILURE,
  type IssueCallFailure,
  type IssueChangeParams,
  type IssueCreateParams,
  type IssueIdParams,
  type IssueListParams,
  type IssueListView,
  type IssueView,
  issueChangeParamsSchema,
  issueCreateParamsSchema,
} from "./issue-view.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

/**
 * issue-client.ts -- the window's side of a workspace's issues, as the host asks the service for them.
 *
 * Every call is the hosted contract's procedure over the one account call
 * (`hosted-link.ts`), so the bearer is read fresh per attempt, a 401 is
 * renewed and retried once, and a body that stalls after its headers is let
 * go once the deadline passes. Each call answers what the service said or
 * why there is no answer, never a failure, because every caller does the
 * same with one: says why, and offers to try again. A write the service
 * would refuse by shape is refused here without traveling.
 */

export interface HostedIssueClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

type Failed = { readonly failure: IssueCallFailure };

const UNANSWERED: Failed = { failure: ISSUE_CALL_FAILURE.UNANSWERED };

const INVALID: Failed = { failure: ISSUE_CALL_FAILURE.INVALID };

/** The refusals a call may answer with, by the service's own word for each. */
type NamedRefusals = Readonly<Partial<Record<HostedApiError, IssueCallFailure>>>;

/** The refusals every issue call can answer with. */
const REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: ISSUE_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.INVALID_REQUEST]: ISSUE_CALL_FAILURE.INVALID,
} satisfies NamedRefusals;

/** A procedure's answer, or the refusal it failed with in the window's words; unanswered for everything else. */
function answered<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
  named: NamedRefusals = REFUSALS,
): Effect.Effect<Answer | Failed, never, HttpClient.HttpClient> {
  return Effect.catch(asked, (failed) => {
    const failure = failed._tag === "HostedRefused" ? named[failed.refusal] : undefined;
    return Effect.succeed(failure === undefined ? UNANSWERED : { failure });
  });
}

/** The window's reads and writes of a workspace's issues. */
export class HostedIssueClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedIssueClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** The workspace's issues, standing or archived, the most recently changed first. */
  list(params: IssueListParams): Effect.Effect<IssueListView, never, HttpClient.HttpClient> {
    return answered(
      askHosted(this.#hosted.issues.list, {
        workspaceId: params.workspaceId,
        ...(params.archived === true ? { archived: ISSUE_ARCHIVED_QUERY.TRUE } : undefined),
      }),
    );
  }

  /** One issue, archived or not. */
  read(params: IssueIdParams): Effect.Effect<IssueView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.issues.read, { id: params.issueId }));
  }

  /** An issue filed, answering it as the service kept it. */
  create(params: IssueCreateParams): Effect.Effect<IssueView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(issueCreateParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed(INVALID);
    return answered(askHosted(this.#hosted.issues.create, admitted));
  }

  /** One issue changed, answering it as it then stands. */
  change(params: IssueChangeParams): Effect.Effect<IssueView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(issueChangeParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed(INVALID);
    return answered(
      askHosted(this.#hosted.issues.change, {
        params: { id: admitted.issueId },
        body: admitted.change,
      }),
    );
  }
}
