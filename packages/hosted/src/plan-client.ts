import {
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import { type Board, type BoardElement, boardAnswerSchema } from "./board-wire.js";
import {
  type GitHubRepositoriesAnswer,
  githubRepositoriesAnswerSchema,
} from "./github-repositories-wire.js";
import {
  type Plan,
  type PlanCreateRequest,
  type PlanRenameRequest,
  type PlanSummary,
  planAnswerSchema,
  planCreateRequestSchema,
  planDeleteAnswerSchema,
  planListAnswerSchema,
  planRenameRequestSchema,
  planUpdateRequestSchema,
} from "./plan-wire.js";
import {
  PLAN_CALL_FAILURE,
  type PlanCallFailure,
  type RepositoryCallFailure,
  type RepositoryListFailure,
} from "./planning-view.js";
import {
  HOSTED_SERVICE_PATH,
  planBoardPath,
  planPath,
  planTranscriptPath,
} from "./service-paths.js";
import { HOSTED_API_ERROR, type HostedApiError, hostedErrorSchema } from "./service-wire.js";
import { type PlanTranscript, planTranscriptAnswerSchema } from "./transcript-wire.js";

/**
 * plan-client.ts -- the Plans tab's side of the named plans, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. What the window has to say about a
 * call that did not answer is one of a few reasons: the service never
 * answered, the plan is gone, or, on a call that names a repository, GitHub's
 * reach refused it.
 */

/** One call's answer, or why there is none. */
export type PlanCallResult<Answer, Failure> =
  | { readonly ok: true; readonly answer: Answer }
  | { readonly ok: false; readonly failure: Failure };

export interface HostedPlanClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED } as const;

function succeeded<Answer>(answer: Answer) {
  return { ok: true, answer } as const;
}

/** The refusals a call that names a repository can answer with, by the service's own word for each. */
const REPOSITORY_REFUSALS = {
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED]: PLAN_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED,
} as const;

/** The refusal a refused answer carries, where it is one the caller names; unanswered otherwise. */
function refusedAs<Failure extends PlanCallFailure>(
  payload: UnparsedWireValue,
  named: Readonly<Partial<Record<HostedApiError, Failure>>>,
): PlanCallResult<never, Failure | typeof PLAN_CALL_FAILURE.UNANSWERED> {
  const refusal = Result.getOrUndefined(readEither(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : named[refusal];
  return failure === undefined ? UNANSWERED : { ok: false, failure };
}

/**
 * The Plans tab's reads and its writes of the service: the list of plans,
 * one plan opened with its document, the repositories the account reaches,
 * and a plan started, renamed, given its repository, or deleted. Each
 * resolves to a result rather than failing, because every caller does the
 * same thing with a failure: draws why, and offers to try again.
 */
export class HostedPlanClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedPlanClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** Every plan the account owns, newest started first. */
  list(): Effect.Effect<
    PlanCallResult<readonly PlanSummary[], typeof PLAN_CALL_FAILURE.UNANSWERED>,
    never,
    HttpClient.HttpClient
  > {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.PLANS },
        planListAnswerSchema,
      ),
      (answer) => (answer === undefined ? UNANSWERED : succeeded(answer.plans)),
    );
  }

  /** One plan with its saved document; opening it moves no row of the list. */
  open(
    planId: string,
  ): Effect.Effect<PlanCallResult<Plan, PlanCallFailure>, never, HttpClient.HttpClient> {
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({ method: HTTP_METHOD.GET, path: planPath(planId) });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (answer.response.ok) {
        const opened = Result.getOrUndefined(readEither(planAnswerSchema)(payload));
        return opened === undefined ? UNANSWERED : succeeded(opened.plan);
      }
      return refusedAs(payload, { [HOSTED_API_ERROR.NOT_FOUND]: PLAN_CALL_FAILURE.NOT_FOUND });
    });
  }

  /**
   * The repositories the account reaches through the Luke GitHub App, with
   * whether the App is installed anywhere for it and where to install it;
   * or why there is no list: the service did not answer, or the account must
   * sign in with GitHub again.
   */
  repositories(): Effect.Effect<
    PlanCallResult<GitHubRepositoriesAnswer, RepositoryListFailure>,
    never,
    HttpClient.HttpClient
  > {
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({
        method: HTTP_METHOD.GET,
        path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORIES,
      });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (answer.response.ok) {
        const listed = Result.getOrUndefined(readEither(githubRepositoriesAnswerSchema)(payload));
        return listed === undefined ? UNANSWERED : succeeded(listed);
      }
      return refusedAs(payload, {
        [HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED]: PLAN_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED,
      });
    });
  }

  /**
   * Gives one plan its repository, or takes it away with null, answering
   * the plan as changed; or why it is unchanged: the service did not answer,
   * the App does not reach that repository for the account, or the account
   * must sign in with GitHub again. A name the service would refuse by shape
   * is refused here without traveling at all.
   */
  setRepository(
    planId: string,
    repository: string | null,
  ): Effect.Effect<PlanCallResult<Plan, RepositoryCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planUpdateRequestSchema)({ repository }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({
        method: HTTP_METHOD.PATCH,
        path: planPath(planId),
        body: JSON.stringify(admitted),
      });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (answer.response.ok) {
        const changed = Result.getOrUndefined(readEither(planAnswerSchema)(payload));
        return changed === undefined ? UNANSWERED : succeeded(changed.plan);
      }
      return refusedAs(payload, REPOSITORY_REFUSALS);
    });
  }

  /** One plan's whiteboard as it stands; nothing where the service did not answer one. */
  readBoard(planId: string): Effect.Effect<Board | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask({ method: HTTP_METHOD.GET, path: planBoardPath(planId) }, boardAnswerSchema),
      (answer) => answer?.board,
    );
  }

  /** What was said on one plan's calls; nothing where the service did not answer it. */
  readTranscript(
    planId: string,
  ): Effect.Effect<PlanTranscript | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: planTranscriptPath(planId) },
        planTranscriptAnswerSchema,
      ),
      (answer) => answer?.transcript,
    );
  }

  /** The board's scene written whole, with the number of Luke's drawing it holds and, when it is the first to hold it, the scene's image; the board as written, or nothing where the service did not answer. */
  saveBoard(
    planId: string,
    elements: readonly BoardElement[],
    appliedDrawing: number,
    image?: string,
  ): Effect.Effect<Board | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.PUT,
          path: planBoardPath(planId),
          body: JSON.stringify({ elements, appliedDrawing, image }),
        },
        boardAnswerSchema,
      ),
      (answer) => answer?.board,
    );
  }

  /** Deletes one plan with its document and its conversation; whether the service deleted it. */
  delete(planId: string): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.DELETE, path: planPath(planId) },
        planDeleteAnswerSchema,
      ),
      (answer) => answer?.deleted === true,
    );
  }

  /**
   * Renames one plan, answering it as renamed with its document, or nothing
   * where the service did not rename it; a name the service would refuse by
   * shape is refused here without traveling at all.
   */
  rename(
    planId: string,
    request: PlanRenameRequest,
  ): Effect.Effect<Plan | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planRenameRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(undefined);
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.PATCH, path: planPath(planId), body: JSON.stringify(admitted) },
        planAnswerSchema,
      ),
      (answer) => answer?.plan,
    );
  }

  /**
   * Starts a plan with the fixed template untouched, on the repository the
   * request names where it names one; a request the service would refuse by
   * shape is refused here without traveling at all, and a repository the
   * service refused is answered as the refusal it was.
   */
  create(
    request: PlanCreateRequest,
  ): Effect.Effect<PlanCallResult<Plan, RepositoryCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planCreateRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.PLANS,
        body: JSON.stringify(admitted),
      });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (answer.response.ok) {
        const started = Result.getOrUndefined(readEither(planAnswerSchema)(payload));
        return started === undefined ? UNANSWERED : succeeded(started.plan);
      }
      return refusedAs(payload, REPOSITORY_REFUSALS);
    });
  }
}

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}
