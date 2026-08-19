import {
  type AttentionDecision,
  type AttentionEvaluator,
  type AttentionPromptUpdate,
  type AttentionUpdate,
  HOSTED_SERVICE_PATH,
  hostedQuotaFromWire,
  hostedReviewAnswerFromWire,
  isRecord,
  positiveInteger,
  text,
} from "@sidecar/core";

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
  // SAFETY: The preceding check establishes the asserted contract.
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
    if (this.#now() < this.#quietUntil) return undefined;

    const token = await this.#readAccessToken();
    if (!token) return undefined;

    let response = await this.#request(token, update);
    if (response?.status === UNAUTHORIZED_STATUS) {
      // Routine expiry of an hour-lived token inside a day-lived app: refresh
      // and retry once, like the hosted mint.
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      if (refreshed && refreshed !== token) {
        response = await this.#request(refreshed, update);
      }
    }
    if (!response) return undefined;

    if (!response.ok) {
      if (response.status === QUOTA_STATUS) {
        await this.#quiet(response);
        return undefined;
      }
      // Status alone diagnoses the refusal without writing session material.
      this.#report(`Hosted attention review failed with status ${response.status}`);
      return undefined;
    }

    const payload: unknown = await response.json().catch(() => undefined);
    const answer =
      payload === undefined ? undefined : hostedReviewAnswerFromWire(payload, this.#now());
    if (!answer) {
      this.#report("Hosted attention review answered outside the decision contract");
      return undefined;
    }
    return answer.decision;
  }

  /**
   * Stands reviews down until the day's counters reset, taking the refusal's
   * own word for when that is. Updates held back stay derivable and are
   * reviewed once the quiet ends, exactly like the keyed evaluator's 429.
   */
  async #quiet(response: Response): Promise<void> {
    const payload: unknown = await response.json().catch(() => undefined);
    const quota = isRecord(payload) ? hostedQuotaFromWire(payload.quota) : undefined;
    const resetsAt = quota?.resetsAt;
    this.#quietUntil =
      resetsAt !== undefined && resetsAt > this.#now()
        ? resetsAt
        : this.#now() + HOSTED_DEFAULTS.RATE_LIMIT_COOLDOWN_MS;
    const waitMs = Math.max(0, this.#quietUntil - this.#now());
    this.#report(
      `Hosted attention reviews are out of today's allowance; pausing for ${Math.round(waitMs / 1000)}s`,
    );
  }

  async #request(token: string, update: AttentionUpdate): Promise<Response | undefined> {
    // The kind of call and nothing else: the update, the token, and the
    // decision stay out of the log. The model is the service's choice, so it
    // has no name to log.
    console.log("AI call: hosted attention review");
    try {
      return await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(promptFields(update)),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      this.#report(
        `Hosted attention review did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
      );
      return undefined;
    }
  }

  #report(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}
