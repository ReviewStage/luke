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
import { Duration, Effect, type Layer, Schedule, type Scope, Semaphore } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
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

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

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
 * and never double-counting a day. {@link ProductEventSender.drop} clears the
 * queue rather than flushing it, because a request in `will-quit` either
 * delays the quit or is killed mid-flight, and an instant quit is worth a
 * minute of counts. Nothing outlives a run: a count made while no account is
 * signed in waits on the queue for a sign-in in this run, and goes with the
 * run if none comes.
 *
 * No identity travels with an event. The service resolves the account from the
 * bearer token this sender already holds for the voice and review endpoints,
 * so there is nothing here to name a person with.
 *
 * It runs nothing itself. {@link ProductEventSender.make} builds one in the
 * scope its caller is already composing in, forks the flush cadence into that
 * scope, and answers a sender whose flush is an effect the caller yields, so
 * the fibers the counts ride are the host's own.
 */
export class ProductEventSender {
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;
  readonly #appVersion: string;
  readonly #sends: boolean;
  readonly #now: () => number;
  readonly #flushIntervalMs: number;
  readonly #queueLimit: number;
  readonly #queue: ProductEvent[] = [];
  /** Nested rather than an interpolated key: the name and the discriminator stay apart. */
  readonly #recordedDays = new Map<ProductEventName, Map<string, string>>();
  #armed = false;
  /**
   * One request at a time, as the queue's splice assumes: a second flush
   * asked for while one is under way waits for it and then carries whatever
   * is queued by then.
   */
  readonly #gate = Semaphore.makeUnsafe(1);

  /**
   * One flush, delayed by the cadence and then repeated on it — never an
   * immediate one, so the events a caller queues right after the sender is
   * built ride the first tick rather than an empty flush ahead of it.
   */
  readonly #tick: Effect.Effect<void> = Effect.suspend(() => {
    this.markDayActive();
    return this.flush;
  });

  /**
   * Sends what is queued, at most one request at a time. Never fails: a
   * request `accountCall` could not carry is a count nobody has, which is the
   * trade this whole pipeline makes.
   */
  readonly flush: Effect.Effect<void> = Effect.suspend(() =>
    this.#gate.withPermits(1)(Effect.provide(this.#flushEffect(), this.#client)),
  );

  /**
   * The queue dropped, which is the whole of a quit's stop: what it has to
   * guarantee is that nothing further is sent, never that a request already
   * under way has ended. The cadence ends with the scope the sender was built
   * in, for the same reason cancelling a timer never awaited one.
   */
  readonly drop: Effect.Effect<void> = Effect.sync(() => {
    this.#queue.length = 0;
  });

  private constructor(options: ProductEventSenderOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = options.httpClient ?? FetchHttpClient.layer;
    this.#appVersion = options.appVersion;
    this.#sends = options.sends;
    this.#now = options.now ?? Date.now;
    this.#flushIntervalMs = positiveInteger(
      options.flushIntervalMs,
      PRODUCT_EVENT_DEFAULTS.FLUSH_INTERVAL_MS,
    );
    this.#queueLimit = positiveInteger(options.queueLimit, PRODUCT_EVENT_DEFAULTS.QUEUE_LIMIT);
  }

  /**
   * One sender, with its flush cadence forked into the scope this is built
   * in: a run that sends no network forks none, since every tick of it would
   * be a no-op.
   */
  static make(
    options: ProductEventSenderOptions,
  ): Effect.Effect<ProductEventSender, never, Scope.Scope> {
    return Effect.gen(function* () {
      const sender = new ProductEventSender(options);
      // The day is marked on the tick rather than at launch alone, because a
      // Luke left running crosses midnight without relaunching — which is the
      // whole case this event exists for, and marking it only at launch would
      // make it a second, worse copy of `app:launch`.
      if (options.sends) {
        const interval = Duration.millis(sender.#flushIntervalMs);
        yield* scheduleRepeat(Schedule.spaced(interval), Effect.delay(sender.#tick, interval));
      }
      return sender;
    });
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
    const today = utcDay(this.#now());
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

  #allowed(): boolean {
    return this.#sends && this.#armed;
  }

  #flushEffect(): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.suspend(() => {
      if (this.#queue.length === 0) return Effect.void;
      // Gone whatever becomes of the request, save for the one end that never
      // authenticated at all.
      const events = this.#queue.splice(0, PRODUCT_EVENT_BATCH_LIMIT);
      return this.#send(events);
    });
  }

  /** Posts one batch. */
  #send(events: ProductEvent[]): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.suspend(() =>
      Effect.map(
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
      ),
    );
  }

  #trimQueue(): void {
    if (this.#queue.length > this.#queueLimit) {
      this.#queue.splice(0, this.#queue.length - this.#queueLimit);
    }
  }
}
