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
import { fromPromise, fromPromiseWithError } from "@sidecar/core/effect";
import { Effect } from "effect";
import { unparsedWire, wireRecord } from "./wire-boundary";

const HOSTED_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 15_000,
  /** The keyed evaluator's cooldown, for a 429 that names no reset of its own. */
  RATE_LIMIT_COOLDOWN_MS: 60_000,
} as const;

const UNAUTHORIZED_STATUS = 401;
const QUOTA_STATUS = 429;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HostedAttentionEvaluatorOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  readAccessToken: () => Promise<string | undefined>;
  refreshAccount: () => Promise<void>;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

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
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  /** Until when reviews stay unsent, as epoch milliseconds. */
  #quietUntil = 0;

  constructor(options: HostedAttentionEvaluatorOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${HOSTED_SERVICE_PATH.ATTENTION_REVIEW}`;
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      HOSTED_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  /** The moment held-back reviews resume, for the reviewer to ask before a pass. */
  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async evaluate(update: AttentionUpdate): Promise<AttentionDecision | undefined> {
    return Effect.runPromise(this.#evaluateEffect(update));
  }

  #evaluateEffect(
    update: AttentionUpdate,
  ): Effect.Effect<AttentionDecision | undefined, never, never> {
    const self = this;
    return Effect.gen(function* () {
      if (self.#now() < self.#quietUntil) return undefined;

      const token = yield* fromPromise(() => self.#readAccessToken()).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
      );
      if (!token) return undefined;

      let response = yield* self.#requestEffect(token, update);
      if (response?.status === UNAUTHORIZED_STATUS) {
        yield* fromPromise(() => self.#refreshAccount()).pipe(Effect.catchAll(() => Effect.void));
        const refreshed = yield* fromPromise(() => self.#readAccessToken()).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        );
        if (refreshed && refreshed !== token) {
          response = yield* self.#requestEffect(refreshed, update);
        }
      }
      if (!response) return undefined;

      if (!response.ok) {
        if (response.status === QUOTA_STATUS) {
          yield* self.#quietEffect(response);
          return undefined;
        }
        self.#report(`Hosted attention review failed with status ${response.status}`);
        return undefined;
      }

      const payload = yield* fromPromise(() => response.json()).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
      );
      const answer =
        payload === undefined
          ? undefined
          : hostedReviewAnswerFromWire(unparsedWire(payload), self.#now());
      if (!answer) {
        self.#report("Hosted attention review answered outside the decision contract");
        return undefined;
      }
      return answer.decision;
    });
  }

  #quietEffect(response: Response): Effect.Effect<void, never, never> {
    const self = this;
    return Effect.gen(function* () {
      const payload = yield* fromPromise(() => response.json()).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
      );
      const record = wireRecord(unparsedWire(payload));
      const quota = record ? hostedQuotaFromWire(unparsedWire(record.quota)) : undefined;
      const resetsAt = quota?.resetsAt;
      self.#quietUntil =
        resetsAt !== undefined && resetsAt > self.#now()
          ? resetsAt
          : self.#now() + HOSTED_DEFAULTS.RATE_LIMIT_COOLDOWN_MS;
      const waitMs = Math.max(0, self.#quietUntil - self.#now());
      self.#report(
        `Hosted attention reviews are out of today's allowance; pausing for ${Math.round(waitMs / 1000)}s`,
      );
    });
  }

  #requestEffect(
    token: string,
    update: AttentionUpdate,
  ): Effect.Effect<Response | undefined, never, never> {
    return fromPromiseWithError(
      () =>
        this.#fetch(this.#endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(promptFields(update)),
          signal: AbortSignal.timeout(this.#requestTimeoutMs),
        }),
      (cause) => cause,
    ).pipe(
      Effect.catchAll((cause) => {
        this.#report(
          `Hosted attention review did not complete: ${cause instanceof Error ? cause.name : "unknown error"}`,
        );
        return Effect.succeed(undefined);
      }),
    );
  }

  #report(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}
