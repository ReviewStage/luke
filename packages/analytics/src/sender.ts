import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import type * as HttpClient from "@effect/platform/HttpClient";
import {
  type AccountCallEffects,
  type AccountToken,
  accountBearer,
  accountCall,
  CALL_FAULT,
  callAnswered,
  HOSTED_SERVICE_PATH,
} from "@sidecar/hosted";
import { scheduleRepeat } from "@sidecar/runtime/effect";
import { HTTP_METHOD, positiveInteger } from "@sidecar/wire";
import { Duration, Effect, Exit, type Layer, Runtime, Schedule, Scope } from "effect";
import {
  PRODUCT_EVENT,
  PRODUCT_EVENT_BATCH_LIMIT,
  PRODUCT_EVENT_CLIENT,
  PRODUCT_EVENT_CLIENT_HEADER,
  type ProductEvent,
  type ProductEventName,
  type ProductEventPropertiesFor,
  productEventFromWire,
} from "./product-events.js";

const PRODUCT_EVENT_DEFAULTS = {
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

/** The one discriminator the day marker dedups on; the day itself is the key. */
const DAY_ACTIVE_KEY = "day";

export interface ProductEventSenderOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The running build's version, as the packaged app reports it. */
  appVersion: string;
  /** `runMode.sendsNetwork`. False makes every record a no-op. */
  sends: boolean;
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  now?: () => number;
  requestTimeoutMs?: number;
  flushIntervalMs?: number;
  queueLimit?: number;
  /** The runtime the flush cadence forks on, for a test that drives its own clock. */
  runtime?: Runtime.Runtime<never>;
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
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;
  readonly #runtime: Runtime.Runtime<never>;
  readonly #appVersion: string;
  readonly #sends: boolean;
  readonly #now: () => number;
  readonly #flushIntervalMs: number;
  readonly #queueLimit: number;
  readonly #queue: ProductEvent[] = [];
  /** Nested rather than an interpolated key: the name and the discriminator stay apart. */
  readonly #recordedDays = new Map<ProductEventName, Map<string, string>>();
  #armed = false;
  #scope: Scope.CloseableScope | undefined;
  #inFlight: Promise<void> | undefined;

  /**
   * One flush, delayed by the cadence and then repeated on it — never an
   * immediate one, so the events a caller queues right after `start()` ride
   * the first tick rather than an empty flush ahead of it.
   */
  readonly #tick: Effect.Effect<void> = Effect.suspend(() => {
    this.markDayActive();
    return Effect.promise(() => this.flush());
  });

  constructor(options: ProductEventSenderOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = options.httpClient ?? FetchHttpClient.layer;
    this.#runtime = options.runtime ?? Runtime.defaultRuntime;
    this.#appVersion = options.appVersion;
    this.#sends = options.sends;
    this.#now = options.now ?? Date.now;
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
    this.#trimQueue();
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

  /**
   * Starts the timed flush, in a fiber the sender's own scope interrupts.
   *
   * @deprecated Runs its own runtime rather than being handed one at an edge,
   * because the settings composer that owns this sender is still a promise
   * calling two synchronous methods rather than a `Layer`; P7-03 deletes the
   * runtime this class holds once that composer forks the cadence on the
   * host's own.
   */
  start(): void {
    if (this.#scope) return;
    const runSync = Runtime.runSync(this.#runtime);
    const scope = runSync(Scope.make());
    this.#scope = scope;
    // The day is marked on the tick rather than at launch alone, because a
    // Luke left running crosses midnight without relaunching — which is the
    // whole case this event exists for, and marking it only at launch would
    // make it a second, worse copy of `app:launch`.
    const delayed = Effect.delay(this.#tick, Duration.millis(this.#flushIntervalMs));
    runSync(
      Effect.provideService(
        scheduleRepeat(Schedule.spaced(Duration.millis(this.#flushIntervalMs)), delayed),
        Scope.Scope,
        scope,
      ),
    );
  }

  /**
   * The scope is dropped and the queue cleared synchronously; closing the
   * scope is not awaited, for the same reason cancelling a timer never was:
   * what it has to guarantee is that no further tick starts, never that a
   * request already under way has ended.
   *
   * @deprecated On the same allowlisted runtime as {@link start}; P7-03
   * deletes it with the runtime this class holds.
   */
  stop(): void {
    const scope = this.#scope;
    this.#scope = undefined;
    this.#queue.length = 0;
    if (scope) Runtime.runFork(this.#runtime)(Scope.close(scope, Exit.void));
  }

  /**
   * Sends what is queued, at most one request at a time. Never fails: a
   * request `accountCall` could not carry is a count nobody has, which is the
   * trade this whole pipeline makes.
   *
   * @deprecated The promise face over `#flushEffect`, kept because every
   * caller — the composer, the gateway's `analytics.record`, this file's own
   * tests — still holds a `ProductEventSender` rather than an `Effect`; on the
   * same allowlisted runtime as {@link start}, and gone with it in P7-03.
   */
  flush(): Promise<void> {
    this.#inFlight ??= Runtime.runPromise(this.#runtime)(
      Effect.provide(this.#flushEffect(), this.#client),
    ).finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  #allowed(): boolean {
    return this.#sends && this.#armed;
  }

  #flushEffect(): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.suspend(() => {
      if (this.#queue.length === 0) return Effect.void;
      // Gone whatever becomes of the request, save for the one end that never
      // authenticated at all.
      const events = this.#queue.splice(0, PRODUCT_EVENT_BATCH_LIMIT);
      return Effect.map(
        this.#call.send({
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.EVENTS,
          headers: {
            // This sender is the desktop's; the iOS app runs its own Swift
            // sender and names itself the same way.
            [PRODUCT_EVENT_CLIENT_HEADER]: PRODUCT_EVENT_CLIENT.DESKTOP,
          },
          body: JSON.stringify({ events }),
        }),
        (answer) => {
          // Signed out is temporary and nobody's fault, and nothing was asked
          // of the service, so the batch waits rather than being spent. An
          // account that changed under a refreshed token is not that case:
          // those counts were queued by an account this request can no longer
          // name, and they go.
          if (!callAnswered(answer) && answer.fault === CALL_FAULT.NO_CREDENTIAL) {
            this.#queue.unshift(...events);
            this.#trimQueue();
          }
        },
      );
    });
  }

  #trimQueue(): void {
    if (this.#queue.length > this.#queueLimit) {
      this.#queue.splice(0, this.#queue.length - this.#queueLimit);
    }
  }
}
