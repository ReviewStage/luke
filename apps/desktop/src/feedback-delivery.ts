import { Effect } from "effect";
import { Http } from "./services/http";
import type { FeedbackResult, FeedbackSubmission } from "./shared/feedback";

const FEEDBACK_ENVIRONMENT = {
  /** Overrides the endpoint for local testing of the delivery path. */
  URL: "LUKE_FEEDBACK_URL",
} as const;

const FEEDBACK_DEFAULTS = {
  /**
   * The one place a submission goes: a small endpoint on Luke's own site that
   // SAFETY: The preceding check establishes the asserted contract.
   * forwards it as email to the founders. Fixed here rather than passed in, so
   * the renderer names an intent and never an address.
   */
  URL: "https://tryluke.dev/api/feedback",
  // Generous next to the evaluator's timeout, because a submission can carry
  // screenshots and a send that dies mid-upload costs the user a retry.
  REQUEST_TIMEOUT_MS: 30_000,
} as const;

/** What the send failed as, in words the composer can put under its field. */
const FEEDBACK_REFUSAL = {
  UNREACHABLE: "Could not reach the feedback service. Check the connection and try again.",
  REFUSED: "The feedback service could not take this right now. Try again in a moment.",
} as const;

export interface FeedbackDeliveryOptions {
  url?: string;
  requestTimeoutMs?: number;
}

function trimmedText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

/**
 * Carries one submission to the fixed endpoint and answers in the user's
 * terms. A refusal is an answer for the composer, never a throw: sending
 * feedback is the user's own act, and what became of it belongs beside the
 * field it left. Nothing about the submission is ever logged — a message to
 * the founders is the user's words, and status codes alone diagnose the path.
 */
export class FeedbackDelivery {
  readonly #url: string;
  readonly #requestTimeoutMs: number;

  constructor(options: FeedbackDeliveryOptions = {}) {
    this.#url = trimmedText(options.url) ?? FEEDBACK_DEFAULTS.URL;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? FEEDBACK_DEFAULTS.REQUEST_TIMEOUT_MS;
  }

  deliver(submission: FeedbackSubmission): Effect.Effect<FeedbackResult, never, Http> {
    return Effect.gen(this, function* () {
      const http = yield* Http;
      const response = yield* http
        .request(this.#url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(submission),
          signal: AbortSignal.timeout(this.#requestTimeoutMs),
        })
        .pipe(
          Effect.catchAll((error) => {
            this.#report(
              `Feedback delivery did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
            );
            return Effect.succeed(undefined);
          }),
        );
      if (!response) {
        return { delivered: false, reason: FEEDBACK_REFUSAL.UNREACHABLE };
      }
      if (!response.ok) {
        this.#report(`Feedback delivery failed with status ${response.status}`);
        return { delivered: false, reason: FEEDBACK_REFUSAL.REFUSED };
      }
      return { delivered: true };
    });
  }

  #report(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}

/**
 * Builds the courier every run gets. There is no key to be missing — the
 * endpoint is public and the destination is fixed — so unlike the evaluator
 * this never answers with nothing; only the address can be overridden, for
 * testing the path against a local server.
 */
export function feedbackDeliveryFromEnvironment(
  options: FeedbackDeliveryOptions = {},
): FeedbackDelivery {
  const url = trimmedText(options.url) ?? trimmedText(process.env[FEEDBACK_ENVIRONMENT.URL]);
  const deliveryOptions = url ? { ...options, url } : options;
  return new FeedbackDelivery(deliveryOptions);
}
