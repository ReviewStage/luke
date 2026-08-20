import {
  type AttentionDecision,
  type AttentionEvaluator,
  type AttentionPromptUpdate,
  type AttentionUpdate,
  HOSTED_SERVICE_PATH,
  hostedQuotaFromWire,
  hostedReviewAnswerFromWire,
  positiveInteger,
  text,
} from "@sidecar/core";
import { AttentionRateLimited } from "@sidecar/core/effect-errors";
import { Duration, Effect, Schedule } from "effect";
import { Http } from "./services/http";
import { unparsedWire, wireRecord } from "./wire-boundary";

const HOSTED_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 15_000,
  /** The keyed evaluator's cooldown, for a 429 that names no reset of its own. */
  RATE_LIMIT_COOLDOWN_MS: 60_000,
} as const;

const UNAUTHORIZED_STATUS = 401;
const QUOTA_STATUS = 429;

/**
 * Exactly the fields the review's prompt reads, picked rather than spread: an
 * update also carries the session's identifiers and clock, and neither has any
 * business leaving the machine — the hosted service renders the same prompt
 * the keyed evaluator would have, from the same bounded fields.
 */
function promptFields(update: AttentionUpdate): AttentionPromptUpdate {
  return {
    trigger: update.trigger,
    providerName: update.providerName,
    title: update.title,
    status: update.status,
    ...(update.workspace ? { workspace: update.workspace } : undefined),
    ...(update.previousStatus ? { previousStatus: update.previousStatus } : undefined),
    ...(update.recap ? { recap: update.recap } : undefined),
    ...(update.context ? { context: update.context } : undefined),
    ...(update.noticeRequest ? { noticeRequest: update.noticeRequest } : undefined),
  };
}

export interface HostedAttentionEvaluatorOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  readAccessToken: () => Effect.Effect<string | undefined, never, never>;
  refreshAccount: () => Effect.Effect<void, unknown, unknown>;
  now?: () => number;
  requestTimeoutMs?: number;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Reviews bounded session updates through Luke's hosted service on the
 * signed-in account, for a developer with no OpenAI key of their own. What
 * leaves the machine is identical to the keyed evaluator's input — the bounded
 * update, nothing behind it — it merely travels by way of Luke's service,
 * which holds the instructions and the decision schema fixed by its own build.
 * A failure answers nothing, and a spent allowance stands the evaluator down
 * until the day's counters reset rather than spending refusals on it.
 */
export class HostedAttentionEvaluator implements AttentionEvaluator {
  readonly #endpoint: string;
  readonly #readAccessToken: () => Effect.Effect<string | undefined, never, never>;
  readonly #refreshAccount: () => Effect.Effect<void, unknown, unknown>;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;

  constructor(options: HostedAttentionEvaluatorOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${HOSTED_SERVICE_PATH.ATTENTION_REVIEW}`;
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      HOSTED_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  evaluate(update: AttentionUpdate) {
    return this.#evaluateOnce(update).pipe(
      Effect.retry({
        while: (error): error is AttentionRateLimited =>
          error instanceof AttentionRateLimited && error.retryAfterMs <= 0,
        schedule: Schedule.addDelay(Schedule.recurs(1), () => Duration.zero),
      }),
    );
  }

  #evaluateOnce(
    update: AttentionUpdate,
  ): Effect.Effect<AttentionDecision | undefined, AttentionRateLimited, Http> {
    return Effect.gen(this, function* () {
      const token = yield* this.#readAccessToken();
      if (!token) return undefined;

      let response = yield* this.#request(token, update);
      if (response?.status === UNAUTHORIZED_STATUS) {
        // Routine expiry of an hour-lived token inside a day-lived app: refresh
        // and retry once, like the hosted mint.
        // SAFETY: Account refresh runs through the Http service requirement on this path.
        yield* this.#refreshAccount() as Effect.Effect<void, never, Http>;
        const refreshed = yield* this.#readAccessToken();
        if (refreshed && refreshed !== token) {
          response = yield* this.#request(refreshed, update);
        }
      }
      if (!response) return undefined;

      if (!response.ok) {
        if (response.status === QUOTA_STATUS) {
          return yield* this.#rateLimited(response);
        }
        // Status alone diagnoses the refusal without writing session material.
        this.#report(`Hosted attention review failed with status ${response.status}`);
        return undefined;
      }

      const payload = yield* this.#payload(response);
      if (payload === undefined) return undefined;
      const answer = hostedReviewAnswerFromWire(
        unparsedWire(
          // SAFETY: Hosted attention JSON matches WireBoundaryInput at this HTTP boundary.
          payload as import("./wire-boundary").WireBoundaryInput,
        ),
        this.#now(),
      );
      if (!answer) {
        this.#report("Hosted attention review answered outside the decision contract");
        return undefined;
      }
      return answer.decision;
    });
  }

  /**
   * Stands reviews down until the day's counters reset, taking the refusal's
   * own word for when that is. Updates held back stay derivable and are
   * reviewed once the quiet ends, exactly like the keyed evaluator's 429.
   */
  #rateLimited(response: Response): Effect.Effect<never, AttentionRateLimited, Http> {
    return Effect.gen(this, function* () {
      const now = this.#now();
      const payload = yield* this.#payload(response);
      const record = wireRecord(
        unparsedWire(
          // SAFETY: Hosted quota JSON matches WireBoundaryInput at this HTTP boundary.
          payload as import("./wire-boundary").WireBoundaryInput,
        ),
      );
      const quota = record ? hostedQuotaFromWire(unparsedWire(record.quota)) : undefined;
      const resetsAt = quota?.resetsAt;
      const waitMs =
        resetsAt !== undefined && resetsAt > now
          ? resetsAt - now
          : HOSTED_DEFAULTS.RATE_LIMIT_COOLDOWN_MS;
      this.#report(
        `Hosted attention reviews are out of today's allowance; pausing for ${Math.round(waitMs / 1000)}s`,
      );
      return yield* Effect.fail(new AttentionRateLimited({ retryAfterMs: waitMs }));
    });
  }

  #request(
    token: string,
    update: AttentionUpdate,
  ): Effect.Effect<Response | undefined, never, Http> {
    return Effect.gen(this, function* () {
      const http = yield* Http;
      return yield* http
        .request(this.#endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(promptFields(update)),
          signal: AbortSignal.timeout(this.#requestTimeoutMs),
        })
        .pipe(
          Effect.catchAll(() => {
            this.#report("Hosted attention review did not complete");
            return Effect.succeed(undefined);
          }),
        );
    });
  }

  #payload(response: Response): Effect.Effect<unknown | undefined, never, Http> {
    return Effect.gen(this, function* () {
      const http = yield* Http;
      return yield* http.readJson(response).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    });
  }

  #report(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}
