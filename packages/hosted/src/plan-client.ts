import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
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
import {
  type Plan,
  type PlanCommand,
  type PlanCommandResult,
  type PlanCreateRequest,
  type PlanSummary,
  planAnswerSchema,
  planCommandClaimAnswerSchema,
  planCommandSettleAnswerSchema,
  planCreateRequestSchema,
  planDeleteAnswerSchema,
  planListAnswerSchema,
} from "./plan-wire.js";
import { PLAN_CALL_FAILURE, type PlanCallFailure } from "./planning-view.js";
import {
  HOSTED_SERVICE_PATH,
  planCommandClaimPath,
  planCommandPath,
  planPath,
} from "./service-paths.js";
import { HOSTED_API_ERROR, hostedErrorSchema } from "./service-wire.js";

/**
 * plan-client.ts -- the Plans tab's side of the named plans and the planning model's folder commands, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. What the window has to say about a
 * call that did not answer is one of two reasons: the service never answered,
 * or the plan is gone.
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

/** A claim is held open by the service for up to 20 s, so its own deadline sits past that. */
const COMMAND_CLAIM_TIMEOUT_MS = 25_000;

function succeeded<Answer>(answer: Answer) {
  return { ok: true, answer } as const;
}

/**
 * The Plans tab's reads and its one write of the service: the list of
 * plans, one plan opened with its document, and a plan started. Each resolves to a
 * result rather than failing, because every caller does the same thing with
 * a failure: draws why, and offers to try again.
 */
export class HostedPlanClient {
  readonly #call: AccountCallEffects;
  readonly #claimCall: AccountCallEffects;

  constructor(options: HostedPlanClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#claimCall = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: COMMAND_CLAIM_TIMEOUT_MS,
    });
  }

  /**
   * The plan's next command the planning model asked to run on this Mac,
   * claimed; null when none arrived while the service held the claim, and
   * undefined when the service did not answer.
   */
  claimCommand(
    planId: string,
  ): Effect.Effect<PlanCommand | null | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#claimCall.ask(
        { method: HTTP_METHOD.POST, path: planCommandClaimPath(planId) },
        planCommandClaimAnswerSchema,
      ),
      (answer) => answer?.command,
    );
  }

  /** What a claimed command answered, posted back to the planning model waiting on it. */
  settleCommand(
    planId: string,
    commandId: string,
    result: PlanCommandResult,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.POST,
          path: planCommandPath(planId, commandId),
          body: JSON.stringify(result),
        },
        planCommandSettleAnswerSchema,
      ),
      (answer) => answer?.settled === true,
    );
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
   * Starts a plan with the fixed template untouched; a request the service
   * would refuse by shape is refused here without traveling at all.
   */
  create(
    request: PlanCreateRequest,
  ): Effect.Effect<
    PlanCallResult<Plan, typeof PLAN_CALL_FAILURE.UNANSWERED>,
    never,
    HttpClient.HttpClient
  > {
    const admitted = Result.getOrUndefined(readEither(planCreateRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.PLANS,
          body: JSON.stringify(admitted),
        },
        planAnswerSchema,
      ),
      (answer) => (answer === undefined ? UNANSWERED : succeeded(answer.plan)),
    );
  }
}

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}
