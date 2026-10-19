import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallCredential,
  callAnswered,
} from "./account-call.js";
import { ISSUE_ARCHIVED_QUERY } from "./contract/issues.js";
import { askHosted, type HostedClient, type HostedFailure, hostedClient } from "./hosted-link.js";
import { type IssuesLiveAnswer, issuesLiveAnswerSchema } from "./issue-live.js";
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
import { ISSUE_LIST_QUERY } from "./issue-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR, type HostedApiError, readServiceAnswer } from "./service-wire.js";

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
  /** The account call the live reads go over, which are plain routes rather than procedures. */
  readonly #live: AccountCallEffects;

  constructor(options: HostedIssueClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#live = accountCall({
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

  /**
   * The workspace's standing issues sealed for following over Neon
   * Realtime; unanswered for anything that went wrong, which the caller
   * answers by asking again.
   */
  listLive(
    workspaceId: string,
  ): Effect.Effect<IssuesLiveAnswer | Failed, never, HttpClient.HttpClient> {
    const query = new URLSearchParams({ [ISSUE_LIST_QUERY.WORKSPACE_ID]: workspaceId });
    const path = `${HOSTED_SERVICE_PATH.LIVE_ISSUES}?${query.toString()}`;
    return Effect.flatMap(this.#live.send({ method: HTTP_METHOD.GET, path }), (answer) => {
      if (!callAnswered(answer) || !answer.response.ok) return Effect.succeed(UNANSWERED);
      const { response } = answer;
      return Effect.map(
        Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined)),
        (body): IssuesLiveAnswer | Failed =>
          Result.getOrUndefined(readServiceAnswer(issuesLiveAnswerSchema)(unparsedWire(body))) ??
          UNANSWERED,
      );
    });
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
