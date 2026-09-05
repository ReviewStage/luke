import { positiveInteger, text } from "@sidecar/wire";
import {
  BRAIN_CLIENT_OUTCOME,
  type FetchLike,
  failedAnswer,
  isRateLimited,
  KEYED_RESPONSES_RESULT,
  keyedBaseUrl,
  keyedClientOverrides,
  OPENAI_ENVIRONMENT,
  postKeyedResponses,
  rateLimitQuietUntil,
} from "./brain-client.js";
import type { BrainSessionDigest, DigestInput } from "./brain-digest.js";
import { digestFromResponsesPayload, digestResponsesRequest } from "./brain-digest-openai.js";
import { BRAIN_REASONING_EFFORT, type BrainReasoningEffort } from "./brain-openai.js";

/**
 * How a transcript slice reaches the summarizer: directly, on the developer's
 * own key. The client answers a digest the schema reader already accepted, or
 * says why not, and the agent falls back to the deterministic digest on
 * anything but an answer.
 */

export type DigestClientAnswer =
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.ANSWERED; digest: BrainSessionDigest }
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.QUIET; until: number }
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.FAILED; reason: string };

export interface DigestClient {
  /** The model a digest is written by, when the client knows it. */
  readonly model?: string;
  /**
   * Settles within the client's own request timeout and never hangs: the
   * timeout is this contract, so the agent awaits the answer with no deadline
   * of its own, and a client that gave up answers `FAILED`.
   */
  summarize(input: DigestInput): Promise<DigestClientAnswer>;
  /** The moment held-back calls may resume, for the agent to skip the call rather than spend it. */
  quietUntil(): number | undefined;
}

export const DIGEST_OPENAI_DEFAULTS = {
  /** A form from a bounded slice, in the background: the cost-optimized tier. */
  MODEL: "gpt-5.6-luna",
  REASONING_EFFORT: BRAIN_REASONING_EFFORT.LOW,
  /** The one ceiling on the form's fields, which carry no length bound of their own. */
  MAXIMUM_OUTPUT_TOKENS: 2_000,
  /** How long one digest may take before the client gives up and the fallback stands in. */
  REQUEST_TIMEOUT_MS: 8_000,
} as const;

export interface OpenAiDigestClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  reasoningEffort?: BrainReasoningEffort;
  maximumOutputTokens?: number;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  report?: (message: string) => void;
}

export type OpenAiDigestOptions = Omit<OpenAiDigestClientOptions, "apiKey">;

/**
 * Writes digests with the OpenAI Responses API on the developer's own key,
 * under the strict digest schema. It never asks the API to retain a request,
 * and a rate limit quiets it the way it quiets the brain, since both share
 * the key.
 */
export class OpenAiDigestClient implements DigestClient {
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #reasoningEffort: BrainReasoningEffort;
  readonly #maximumOutputTokens: number;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #report: (message: string) => void;
  #quietUntil = 0;

  constructor(options: OpenAiDigestClientOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.model = text(options.model) ?? DIGEST_OPENAI_DEFAULTS.MODEL;
    this.#baseUrl = keyedBaseUrl(options.baseUrl);
    this.#reasoningEffort = options.reasoningEffort ?? DIGEST_OPENAI_DEFAULTS.REASONING_EFFORT;
    this.#maximumOutputTokens = positiveInteger(
      options.maximumOutputTokens,
      DIGEST_OPENAI_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
    );
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      DIGEST_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
  }

  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async summarize(input: DigestInput): Promise<DigestClientAnswer> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: quietUntil };

    const posted = await postKeyedResponses({
      apiKey: this.#apiKey,
      baseUrl: this.#baseUrl,
      fetch: this.#fetch,
      timeoutMs: this.#requestTimeoutMs,
      body: digestResponsesRequest(input, {
        model: this.model,
        maximumOutputTokens: this.#maximumOutputTokens,
        reasoningEffort: this.#reasoningEffort,
      }),
    });
    if (posted.kind === KEYED_RESPONSES_RESULT.FAILED) return failedAnswer(posted.reason);
    const { response } = posted;
    if (isRateLimited(response)) return this.#quiet(response);
    // Status alone diagnoses credentials or an outage without writing the
    // request, the key, or any transcript to the log.
    if (!response.ok) return failedAnswer(`request failed with status ${response.status}`);
    const digest = digestFromResponsesPayload(await response.json().catch(() => undefined));
    return digest
      ? { outcome: BRAIN_CLIENT_OUTCOME.ANSWERED, digest }
      : failedAnswer("response did not satisfy the digest schema");
  }

  #quiet(response: Response): DigestClientAnswer {
    this.#quietUntil = rateLimitQuietUntil(response, this.#now());
    const waitMs = this.#quietUntil - this.#now();
    this.#report(`OpenAI digests are rate limited; pausing for ${Math.round(waitMs / 1000)}s`);
    return { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: this.#quietUntil };
  }
}

/** Builds a keyed client only when there is a key to build one from, like the brain's. */
export function openAiDigestClient(
  apiKey: string | undefined,
  options: OpenAiDigestOptions = {},
): OpenAiDigestClient | undefined {
  const resolved = text(apiKey);
  if (!resolved) return undefined;
  return new OpenAiDigestClient({
    ...options,
    apiKey: resolved,
    ...keyedClientOverrides(options, OPENAI_ENVIRONMENT.DIGEST_MODEL),
  });
}
