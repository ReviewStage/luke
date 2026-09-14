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
  adoptableHeldProductEvents,
  HELD_PRODUCT_EVENTS_VERSION,
  type HeldProductEvents,
  type HeldProductEventsRecord,
} from "./held-events.js";
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
  /**
   * Where a batch waits between runs while no credential can carry it. A
   * sender given none holds nothing past its own life.
   */
  held?: HeldProductEvents;
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
 * minute of counts.
 *
 * The one batch that outlives a run is the one no credential could carry.
 * A flush that found no account leaves its events queued, and writes them to
 * the hold it was given, so a run that launched, was introduced, and quit
 * before any sign-in still posts under the account that signs in next — in a
 * later launch as readily as in this one. That moves when those counts
 * leave, never whether: a Mac that never signs in posts none of them, and the
 * hold is bounded to the queue's own limit and to the service's own age
 * window, past which an event goes rather than being posted to be re-dated.
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
  readonly #held: HeldProductEvents | undefined;
  /** Nested rather than an interpolated key: the name and the discriminator stay apart. */
  readonly #recordedDays = new Map<ProductEventName, Map<string, string>>();
  #armed = false;
  /** Whether the hold on disk names any event, so an emptied queue clears it exactly once. */
  #holdStanding = false;
  /** The one adoption of the hold, memoized by {@link ProductEventSender.make}. */
  #adoption: Effect.Effect<void> = Effect.void;
  /**
   * One request at a time, as the queue's splice and the hold's write around
   * it assume: a second flush asked for while one is under way waits for it
   * and then carries whatever is queued by then.
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
    this.#held = options.held;
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
   * be a no-op. The hold's one read is memoized here rather than at the first
   * flush, so the memo is made where an effect is already running; running it
   * still waits for a flush of a run that counts.
   */
  static make(
    options: ProductEventSenderOptions,
  ): Effect.Effect<ProductEventSender, never, Scope.Scope> {
    return Effect.gen(function* () {
      const sender = new ProductEventSender(options);
      const held = options.held;
      if (held) sender.#adoption = yield* Effect.cached(sender.#readHold(held));
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

  /**
   * The hold is written ahead of the request, never behind it: what leaves
   * the queue for the wire leaves the disk first, so a quit between the post
   * and a write could only lose the batch, never post it twice — the direction
   * this whole pipeline already takes. A refusal that requeues writes the
   * hold again with the batch back in it.
   */
  #flushEffect(): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.andThen(
      this.#adoptHold(),
      Effect.suspend(() => {
        if (this.#queue.length === 0) return this.#persistHold();
        // Gone whatever becomes of the request, save for the one end that never
        // authenticated at all.
        const events = this.#queue.splice(0, PRODUCT_EVENT_BATCH_LIMIT);
        return this.#persistHold().pipe(
          Effect.andThen(this.#send(events)),
          Effect.flatMap((requeued) => (requeued ? this.#persistHold() : Effect.void)),
        );
      }),
    );
  }

  /**
   * The hold is read once, and only ahead of a flush of a run that counts:
   * a fixture run and a sender not yet armed read nothing, nothing else reads
   * the disk, and no write of the hold can happen before the read, so a run
   * that quits ahead of its first flush leaves the earlier hold as it found
   * it. What is adopted lands ahead of this run's own events, as the older
   * counts they are, and a held day marker for a day this queue already marks
   * is dropped, since a relaunch on the same day is one day used, not two.
   */
  #adoptHold(): Effect.Effect<void> {
    if (!this.#held || !this.#allowed()) return Effect.void;
    return this.#adoption;
  }

  /** The hold read and taken onto the queue, memoized by `make` so it happens once. */
  #readHold(held: HeldProductEvents): Effect.Effect<void> {
    return Effect.map(held.read, (record) => {
      if (!record) return;
      this.#holdStanding = record.events.length > 0;
      const adopted = adoptableHeldProductEvents(record, this.#now(), this.#queueLimit).filter(
        (event) => !(event.name === PRODUCT_EVENT.APP_DAY_ACTIVE && this.#dayMarked(event.at)),
      );
      this.#queue.unshift(...adopted);
      this.#trimQueue();
    });
  }

  #dayMarked(at: number): boolean {
    const day = utcDay(at);
    return this.#queue.some(
      (queued) => queued.name === PRODUCT_EVENT.APP_DAY_ACTIVE && utcDay(queued.at) === day,
    );
  }

  /**
   * The hold follows the queue: written whenever the queue holds events, and
   * written empty once when a hold that stood has nothing left behind it, so
   * a quiet signed-in run writes nothing at all.
   */
  #persistHold(): Effect.Effect<void> {
    const held = this.#held;
    if (!held || !this.#allowed()) return Effect.void;
    if (this.#queue.length === 0 && !this.#holdStanding) return Effect.void;
    const record: HeldProductEventsRecord = {
      version: HELD_PRODUCT_EVENTS_VERSION,
      events: [...this.#queue],
    };
    this.#holdStanding = record.events.length > 0;
    return held.write(record);
  }

  /** Posts one batch, answering whether it went back on the queue. */
  #send(events: ProductEvent[]): Effect.Effect<boolean, never, HttpClient.HttpClient> {
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
            return true;
          }
          return false;
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
