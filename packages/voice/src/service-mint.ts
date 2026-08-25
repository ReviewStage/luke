import { type HostedQuota, hostedMintAnswerFromWire } from "@sidecar/hosted";
import {
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  REALTIME_DEFAULTS,
  REALTIME_MINT_OUTCOME,
  type RealtimeConnection,
  type RealtimeDiagnostics,
  type RealtimeMintOutcome,
} from "@sidecar/realtime";
import { positiveInteger, text, type UnparsedWireValue, unparsedWire } from "@sidecar/wire";
import type { RealtimeCredentialMinter } from "./minter.js";

const SERVICE_MINT_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ServiceMintOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The mint endpoint's path under that origin. */
  servicePath: string;
  /** Names the minter in the stderr line a failed mint writes. */
  logLabel: string;
  /** The detail recorded when the service answers with no usable credential. */
  malformedDetail: string;
  voice?: string;
  speed?: number;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * The shared core of minting ephemeral Realtime credentials from Luke's
 * hosted service: whichever endpoint a subclass aims at, the renderer still
 * receives only an ephemeral secret aimed at OpenAI's canonical calls
 * endpoint, validated by the same wire reader, a failure resolves to nothing
 * rather than an error, and the diagnostics say why. Subclasses own only what
 * genuinely differs — the headers an attempt carries, a retry after a refused
 * token, and what a refusal status means.
 */
export abstract class ServiceRealtimeCredentialMinter implements RealtimeCredentialMinter {
  readonly #endpoint: string;
  readonly #logLabel: string;
  readonly #malformedDetail: string;
  /** The voice from construction, which a cleared setting falls back to. */
  readonly #configuredVoice: string | undefined;
  #voice: string | undefined;
  readonly #configuredSpeed: number | undefined;
  #speed: number | undefined;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  #lastModel: string | undefined;
  #lastOutcome: RealtimeMintOutcome = REALTIME_MINT_OUTCOME.NOT_ATTEMPTED;
  #lastDetail: string | undefined;
  #lastAttemptAt: number | undefined;
  #quota: HostedQuota | undefined;

  constructor(options: ServiceMintOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${options.servicePath}`;
    this.#logLabel = options.logLabel;
    this.#malformedDetail = options.malformedDetail;
    this.#configuredVoice = text(options.voice);
    this.#voice = this.#configuredVoice;
    this.#configuredSpeed = options.speed;
    this.#speed = this.#configuredSpeed;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      SERVICE_MINT_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  abstract mint(): Promise<RealtimeConnection | undefined>;

  /**
   * Changes the voice new credentials are minted for. A call already open
   * keeps the voice it answered with, the keyed minter's own rule.
   */
  setVoice(voice: string | undefined): void {
    this.#voice = text(voice) ?? this.#configuredVoice;
  }

  setSpeed(speed: number | undefined): void {
    this.#speed = speed ?? this.#configuredSpeed;
  }

  diagnostics(): RealtimeDiagnostics {
    return {
      apiKeyConfigured: false,
      hosted: true,
      fixtureMode: false,
      model: this.#lastModel ?? REALTIME_DEFAULTS.MODEL,
      voice: this.#voice ?? REALTIME_DEFAULTS.VOICE,
      speed: this.#speed ?? REALTIME_DEFAULTS.SPEED,
      endpoint: this.#endpoint,
      lastOutcome: this.#lastOutcome,
      ...(this.#lastDetail ? { lastDetail: this.#lastDetail } : undefined),
      ...(this.#lastAttemptAt === undefined ? undefined : { lastAttemptAt: this.#lastAttemptAt }),
      ...(this.#quota ? { quota: this.#quota } : undefined),
    };
  }

  /** Names what a refusal status means, which is where the service minters differ. */
  protected abstract refuseMint(status: number, payload: UnparsedWireValue): void;

  protected beginAttempt(): void {
    this.#lastAttemptAt = this.#now();
  }

  protected async requestMint(headers: Record<string, string>): Promise<Response | undefined> {
    try {
      return await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        // Only values inside the build's own sets travel; anything else lets
        // the service mint its default rather than sending a refusable field.
        body: JSON.stringify({
          ...(isRealtimeVoice(this.#voice) ? { voice: this.#voice } : undefined),
          ...(isRealtimeVoiceSpeed(this.#speed) ? { speed: this.#speed } : undefined),
        }),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      this.recordOutcome(
        REALTIME_MINT_OUTCOME.NETWORK_ERROR,
        error instanceof Error ? error.name : "unknown error",
      );
      return undefined;
    }
  }

  protected async settleMint(response: Response): Promise<RealtimeConnection | undefined> {
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      this.refuseMint(response.status, unparsedWire(payload));
      return undefined;
    }

    const answer =
      payload === undefined
        ? undefined
        : hostedMintAnswerFromWire(unparsedWire(payload), this.#now());
    if (!answer) {
      this.recordOutcome(REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE, this.#malformedDetail);
      return undefined;
    }

    this.#lastModel = answer.connection.model;
    this.#quota = answer.quota ?? this.#quota;
    this.recordOutcome(REALTIME_MINT_OUTCOME.SUCCEEDED);
    return answer.connection;
  }

  /** Replaces the held quota with the one a refusal carried, or clears it. */
  protected keepQuota(quota: HostedQuota | undefined): void {
    this.#quota = quota;
  }

  protected recordOutcome(outcome: RealtimeMintOutcome, detail?: string): void {
    this.#lastOutcome = outcome;
    this.#lastDetail = detail;
    if (outcome === REALTIME_MINT_OUTCOME.SUCCEEDED) return;
    process.stderr.write(`${this.#logLabel}: ${outcome}${detail ? ` (${detail})` : ""}\n`);
  }
}
