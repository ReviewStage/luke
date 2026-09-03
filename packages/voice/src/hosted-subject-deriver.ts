import type { SubjectDerivation, SubjectEvaluator, SubjectInput } from "@sidecar/attention";
import {
  HOSTED_SERVICE_PATH,
  hostedQuotaFromWire,
  hostedSubjectAnswerFromWire,
} from "@sidecar/hosted";
import { positiveInteger, text, unparsedWire, wireRecord } from "@sidecar/wire";

const HOSTED_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 20_000,
  RATE_LIMIT_COOLDOWN_MS: 60_000,
} as const;

const UNAUTHORIZED_STATUS = 401;
const QUOTA_STATUS = 429;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HostedSubjectDeriverOptions {
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
 * Derives subjects through Luke's hosted service on the signed-in account,
 * for a developer with no OpenAI key of their own. What leaves the machine is
 * identical to the keyed deriver's input — the bounded transcript rendering and
 * the title — by way of Luke's service, which holds the instructions
 * and schema fixed by its own build and stores none of it. A failure answers
 * nothing, and a spent allowance stands the deriver down until the counters
 * reset, exactly as the hosted attention evaluator does.
 */
export class HostedSubjectDeriver implements SubjectEvaluator {
  readonly #endpoint: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  #quietUntil = 0;

  constructor(options: HostedSubjectDeriverOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${HOSTED_SERVICE_PATH.SUBJECT_DERIVE}`;
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      HOSTED_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async derive(input: SubjectInput): Promise<SubjectDerivation | undefined> {
    if (this.#now() < this.#quietUntil) return undefined;
    const token = await this.#readAccessToken();
    if (!token) return undefined;

    let response = await this.#request(token, input);
    if (response?.status === UNAUTHORIZED_STATUS) {
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      if (refreshed && refreshed !== token) response = await this.#request(refreshed, input);
    }
    if (!response) return undefined;

    if (!response.ok) {
      if (response.status === QUOTA_STATUS) {
        await this.#quiet(response);
        return undefined;
      }
      this.#report(`Hosted subject derivation failed with status ${response.status}`);
      return undefined;
    }

    const payload = await response.json().catch(() => undefined);
    const answer =
      payload === undefined ? undefined : hostedSubjectAnswerFromWire(unparsedWire(payload));
    if (!answer) {
      this.#report("Hosted subject derivation answered outside the subject contract");
      return undefined;
    }
    return { subject: answer.subject };
  }

  async #quiet(response: Response): Promise<void> {
    const payload = await response.json().catch(() => undefined);
    const record = wireRecord(unparsedWire(payload));
    const quota = record ? hostedQuotaFromWire(unparsedWire(record.quota)) : undefined;
    const resetsAt = quota?.resetsAt;
    this.#quietUntil =
      resetsAt !== undefined && resetsAt > this.#now()
        ? resetsAt
        : this.#now() + HOSTED_DEFAULTS.RATE_LIMIT_COOLDOWN_MS;
    const waitMs = Math.max(0, this.#quietUntil - this.#now());
    this.#report(
      `Hosted subject derivations are out of today's allowance; pausing for ${Math.round(waitMs / 1000)}s`,
    );
  }

  async #request(token: string, input: SubjectInput): Promise<Response | undefined> {
    try {
      return await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      this.#report(
        `Hosted subject derivation did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
      );
      return undefined;
    }
  }

  #report(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}
