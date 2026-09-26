import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, type Schema as EffectSchema, Result } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  type GitHubRepositoryListAnswer,
  githubFailureAnswerSchema,
  githubRepositoryListAnswerSchema,
} from "./github-wire.js";
import {
  type Plan,
  type PlanCreateRequest,
  type PlanSummary,
  planAnswerSchema,
  planCreateRequestSchema,
  planListAnswerSchema,
} from "./plan-wire.js";
import {
  type GitHubCallFailure,
  PLAN_CALL_FAILURE,
  type PlanCallFailure,
} from "./planning-view.js";
import { HOSTED_SERVICE_PATH, planPath } from "./service-paths.js";
import { HOSTED_API_ERROR, hostedErrorSchema } from "./service-wire.js";

/**
 * plan-client.ts -- the planning window's side of the named plans and the GitHub repository list, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. What the window has to say about a
 * call that did not answer is one of a few reasons: the service never
 * answered, the plan is gone, or GitHub refused the account's connection for
 * a reason the service named. GitHub's own words never travel this far.
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

/**
 * The planning window's reads and its one write of the service: the list of
 * plans, one plan opened with its document, a plan started, and the
 * repositories the account's GitHub connection can read. Each resolves to a
 * result rather than failing, because every caller does the same thing with
 * a failure: draws why, and offers to try again.
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

  /** Every plan the account owns, most recently opened first. */
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

  /** One plan with its saved document; the service moves it to the head of the list. */
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
      const refusal = Result.getOrUndefined(readEither(hostedErrorSchema)(payload));
      return refusal === HOSTED_API_ERROR.NOT_FOUND
        ? { ok: false, failure: PLAN_CALL_FAILURE.NOT_FOUND }
        : UNANSWERED;
    });
  }

  /**
   * Starts a plan with an empty document. The service resolves the
   * repository's default branch to one commit itself; a request the service
   * would refuse by shape is refused here without traveling at all.
   */
  create(
    request: PlanCreateRequest,
  ): Effect.Effect<PlanCallResult<Plan, GitHubCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planCreateRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#throughGitHub(
      { method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.PLANS, body: JSON.stringify(admitted) },
      planAnswerSchema,
      (answer) => answer.plan,
    );
  }

  /** The repositories the account's GitHub connection can read, most recently pushed first. */
  repositories(): Effect.Effect<
    PlanCallResult<GitHubRepositoryListAnswer, GitHubCallFailure>,
    never,
    HttpClient.HttpClient
  > {
    return this.#throughGitHub(
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORIES },
      githubRepositoryListAnswerSchema,
      (answer) => answer,
    );
  }

  /**
   * One call the service carries through the account's GitHub connection:
   * the answer read under its own schema, or GitHub's refusal read as the
   * reason the service named, or unanswered for anything else.
   */
  #throughGitHub<Wire, Encoded, Answer>(
    request: Parameters<AccountCallEffects["send"]>[0],
    schema: EffectSchema.Codec<Wire, Encoded>,
    project: (wire: Wire) => Answer,
  ): Effect.Effect<PlanCallResult<Answer, GitHubCallFailure>, never, HttpClient.HttpClient> {
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send(request);
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (answer.response.ok) {
        const read = Result.getOrUndefined(readEither(schema)(payload));
        return read === undefined ? UNANSWERED : succeeded(project(read));
      }
      const refusal = Result.getOrUndefined(readEither(githubFailureAnswerSchema)(payload));
      return refusal === undefined ? UNANSWERED : { ok: false, failure: refusal.reason };
    });
  }
}

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}
