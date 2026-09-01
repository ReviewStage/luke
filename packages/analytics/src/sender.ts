import {
  PRODUCT_EVENT,
  PRODUCT_EVENT_BATCH_LIMIT,
  PRODUCT_EVENT_CLIENT,
  PRODUCT_EVENT_CLIENT_HEADER,
  type ProductEvent,
  type ProductEventName,
  type ProductEventPropertiesFor,
  productEventFromWire,
} from "@sidecar/analytics";
import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { positiveInteger, text } from "@sidecar/wire";

const PRODUCT_EVENT_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
  /**
   * A minute between flushes. Long enough that a launch, a sign-in, and a
   * first observation ride one request rather than three; short enough that a
   * quit loses at most a minute of counts.
   */
  FLUSH_INTERVAL_MS: 60_000,
  /**
   * How many events wait for a network at most. Past this the oldest go: a
   * long stretch offline should keep recent behaviour, and the one event that
   * would hurt to lose — the day marker — is recorded again the next day
   * anyway.
   */
  QUEUE_LIMIT: 200,
} as const;

const UNAUTHORIZED_STATUS = 401;

/** The one discriminator the day marker dedups on; the day itself is the key. */
const DAY_ACTIVE_KEY = "day";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ProductEventSenderOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The running build's version, as the packaged app reports it. */
  appVersion: string;
  /** `runMode.sendsNetwork`. False makes every record a no-op. */
  sends: boolean;
  readAccessToken: () => Promise<string | undefined>;
  refreshAccount: () => Promise<void>;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  flushIntervalMs?: number;
  queueLimit?: number;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Counts how Luke's own features are used, and sends nothing else. The
 * vocabulary is core's: every event is run through the same reader the service
 * runs before it is even queued, so a bad emitter is dropped on this machine
 * rather than becoming a refusal over the wire, and nothing observed can reach
 * a property in the first place.
 *
 * The pipeline is lossy on purpose. Any outcome — accepted, refused,
 * unreachable — drops the batch, and nothing is ever retried: counts undercount
 * on a flaky network in exchange for never retry-storming Luke's own service
 * and never double-counting a day. `stop()` drops the queue rather than
 * flushing, because a request in `will-quit` either delays the quit or is
 * killed mid-flight, and an instant quit is worth a minute of counts.
 *
 * No identity travels with an event. The service resolves the account from the
 * bearer token this sender already holds for the voice and review endpoints,
 * so there is nothing here to name a person with.
 */
export class ProductEventSender {
  readonly #endpoint: string;
  readonly #appVersion: string;
  readonly #sends: boolean;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #flushIntervalMs: number;
  readonly #queueLimit: number;
  readonly #queue: ProductEvent[] = [];
  /** Nested rather than an interpolated key: the name and the discriminator stay apart. */
  readonly #recordedDays = new Map<ProductEventName, Map<string, string>>();
  #armed = false;
  #timer: NodeJS.Timeout | undefined;
  #inFlight: Promise<void> | undefined;

  constructor(options: ProductEventSenderOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${HOSTED_SERVICE_PATH.EVENTS}`;
    this.#appVersion = options.appVersion;
    this.#sends = options.sends;
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      PRODUCT_EVENT_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#flushIntervalMs = positiveInteger(
      options.flushIntervalMs,
      PRODUCT_EVENT_DEFAULTS.FLUSH_INTERVAL_MS,
    );
    this.#queueLimit = positiveInteger(options.queueLimit, PRODUCT_EVENT_DEFAULTS.QUEUE_LIMIT);
  }

  /** The build's version, so an emitter never has to hold it to report it. */
  get appVersion(): string {
    return this.#appVersion;
  }

  /**
   * Queues one event. Synchronous and never throws, so an emit site can sit
   * on any path without ordering itself around it.
   */
  record<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): void {
    if (!this.#allowed()) return;
    const event = productEventFromWire({ name, at: this.#now(), properties });
    if (!event) return;
    this.#queue.push(event);
    if (this.#queue.length > this.#queueLimit) {
      this.#queue.splice(0, this.#queue.length - this.#queueLimit);
    }
  }

  /**
   * Marks today active, at most once per UTC day. Luke can run for a week on
   * one launch, so launches alone would undercount the days he was used.
   */
  markDayActive(): void {
    this.recordOncePerDay(PRODUCT_EVENT.APP_DAY_ACTIVE, DAY_ACTIVE_KEY, {
      app_version: this.#appVersion,
    });
  }

  /**
   * Queues one event per discriminator per UTC day. Observation commits on
   * every registry change, which would be a count of registry churn rather
   * than of use; one per provider per day is the fact worth having.
   */
  recordOncePerDay<Name extends ProductEventName>(
    name: Name,
    discriminator: string,
    properties: ProductEventPropertiesFor<Name>,
  ): void {
    if (!this.#allowed()) return;
    const today = new Date(this.#now()).toISOString().slice(0, 10);
    let recorded = this.#recordedDays.get(name);
    if (!recorded) {
      recorded = new Map();
      this.#recordedDays.set(name, recorded);
    }
    if (recorded.get(discriminator) === today) return;
    recorded.set(discriminator, today);
    this.record(name, properties);
  }

  /**
   * Arms counting. The sender comes up disarmed rather than assuming, so
   * nothing recorded while the app is still standing itself up can be sent
   * before the launch has decided whether this run counts at all.
   */
  arm(): void {
    this.#armed = true;
  }

  /** Starts the timed flush. The timer never holds the process open. */
  start(): void {
    if (this.#timer) return;
    // Unlike the update check there is no flush here: letting the launch
    // events ride the first tick is what makes the first batch carry more
    // than one event.
    this.#timer = setInterval(() => {
      // The day is marked on the tick rather than at launch alone, because a
      // Luke left running crosses midnight without relaunching — which is the
      // whole case this event exists for, and marking it only at launch would
      // make it a second, worse copy of `app:launch`.
      this.markDayActive();
      void this.flush();
    }, this.#flushIntervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#queue.length = 0;
  }

  /**
   * Sends what is queued, at most one request at a time. Never throws: a
   * failure is a count nobody has, which is the trade this whole pipeline
   * makes.
   */
  flush(): Promise<void> {
    this.#inFlight ??= this.#send().then(
      () => {
        this.#inFlight = undefined;
      },
      () => {
        this.#inFlight = undefined;
      },
    );
    return this.#inFlight;
  }

  #allowed(): boolean {
    return this.#sends && this.#armed;
  }

  async #send(): Promise<void> {
    if (this.#queue.length === 0) return;
    const token = await this.#readAccessToken();
    // Signed out is temporary and nobody's fault, so the queue waits rather
    // than being spent against a request that cannot authenticate.
    if (!token) return;
    // Taken only once a request will actually be made, and gone whatever
    // becomes of it.
    const events = this.#queue.splice(0, PRODUCT_EVENT_BATCH_LIMIT);
    let response = await this.#post(token, events);
    if (response?.status === UNAUTHORIZED_STATUS) {
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      if (refreshed && refreshed !== token) {
        response = await this.#post(refreshed, events);
      }
    }
  }

  async #post(token: string, events: readonly ProductEvent[]): Promise<Response | undefined> {
    try {
      return await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          // This sender is the desktop's; the iOS app runs its own Swift
          // sender and names itself the same way.
          [PRODUCT_EVENT_CLIENT_HEADER]: PRODUCT_EVENT_CLIENT.DESKTOP,
        },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch {
      return undefined;
    }
  }
}
