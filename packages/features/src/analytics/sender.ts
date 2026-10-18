import { scheduleRepeat } from "@luke/runtime/effect";
import { HTTP_METHOD, positiveInteger } from "@luke/wire";
import { Duration, Effect, type Layer, Schedule, type Scope, Semaphore } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  type AccountToken,
  accountBearer,
  accountCall,
  CALL_FAULT,
  callAnswered,
  HOSTED_SERVICE_PATH,
} from "../index.js";
import {
  PRODUCT_EVENT,
  PRODUCT_EVENT_BATCH_LIMIT,
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

/**
 * The account a sender handed no `readAccountKey` counts every day under:
 * with no identity to tell two accounts apart, they are one holder.
 */
const UNNAMED_ACCOUNT = "";

/** A sender handed no store remembers a day for the run alone. */
const UNKEPT_DAYS: RecordedDayStore = {
  lastRecordedDay: () => Effect.succeed(undefined),
  keepRecordedDay: () => Effect.void,
};

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** One once-a-day event as sent: which event, for what, for whom, and on which UTC day. */
export interface RecordedDay {
  readonly name: ProductEventName;
  readonly discriminator: string;
  /** The account key `readAccountKey` answered when the event was queued. */
  readonly account: string;
  /** `YYYY-MM-DD`, in UTC. */
  readonly day: string;
}

/**
 * Where the day a once-a-day event was last sent is kept across launches.
 * The host hands in its own state store, so the guard outlives the run that
 * set it. Neither side fails: a day that could not be read is counted again,
 * and one that could not be kept is the next launch's to count.
 */
export interface RecordedDayStore {
  readonly lastRecordedDay: (
    name: ProductEventName,
    discriminator: string,
    account: string,
  ) => Effect.Effect<string | undefined>;
  readonly keepRecordedDay: (recorded: RecordedDay) => Effect.Effect<void>;
}

/** A queued event, and the day it marks when it is a once-a-day one. */
interface QueuedEvent {
  readonly event: ProductEvent;
  readonly recorded?: RecordedDay;
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
  /** Where once-a-day events keep their day across launches; the run alone without one. */
  recordedDays?: RecordedDayStore;
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
 * minute of counts. Nothing outlives a run but the day a once-a-day event was
 * last sent for an account: a count made while no account is signed in waits
 * on the queue for a sign-in in this run, and goes with the run if none
 * comes.
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
  readonly #readAccountKey: () => Effect.Effect<string | undefined>;
  readonly #keptDays: RecordedDayStore;
  readonly #queue: QueuedEvent[] = [];
  /**
   * This run's own guard, by name, then discriminator, then account: nested
   * rather than an interpolated key, so the three stay apart. It is set when
   * an event is queued, while the kept day is written only once it is sent,
   * so a tick a minute later does not queue the day a second time.
   */
  readonly #recordedDays = new Map<ProductEventName, Map<string, Map<string, string>>>();
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
  readonly #tick: Effect.Effect<void> = Effect.suspend(() =>
    Effect.andThen(this.markDayActive(), this.flush),
  );

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
    this.#readAccountKey = options.readAccountKey ?? (() => Effect.succeed(UNNAMED_ACCOUNT));
    this.#keptDays = options.recordedDays ?? UNKEPT_DAYS;
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
    this.#enqueue(name, properties, undefined);
  }

  /**
   * Marks today active, at most once per account per UTC day, across
   * launches. Luke can run for a week on one launch, so launches alone would
   * undercount the days he was used, and relaunching must not count one day
   * twice.
   */
  markDayActive(): Effect.Effect<void> {
    return this.recordOncePerDay(PRODUCT_EVENT.APP_DAY_ACTIVE, DAY_ACTIVE_KEY, {
      app_version: this.#appVersion,
    });
  }

  /**
   * Queues one event per discriminator per account per UTC day. The day is
   * kept in the store the host handed over once the batch carrying it was
   * answered, so a relaunch the same day finds it, while a launch quit before
   * its first flush leaves the day for the next launch to count.
   *
   * Nobody signed in is nobody's day: nothing is queued, and the next tick
   * asks again, so an account that signs in later the same day is counted.
   * Another account signing in the same day is counted for its own.
   */
  recordOncePerDay<Name extends ProductEventName>(
    name: Name,
    discriminator: string,
    properties: ProductEventPropertiesFor<Name>,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#allowed()) return;
      const account = yield* this.#readAccountKey();
      if (account === undefined) return;
      const day = utcDay(this.#now());
      const accounts = this.#recordedDaysOf(name, discriminator);
      if (accounts.get(account) === day) return;
      const kept = yield* this.#keptDays.lastRecordedDay(name, discriminator, account);
      // Note that we look again after the read, because another mark may have
      // queued this day while it was under way.
      if (accounts.get(account) === day) return;
      accounts.set(account, day);
      // Note that only the very day counts as kept, because a clock that was
      // wrong must never hide a real day: it costs one count at most instead.
      if (kept === day) return;
      this.#enqueue(name, properties, { name, discriminator, account, day });
    });
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

  /** One event read against the allowlist and queued, with the day it marks. */
  #enqueue<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
    recorded: RecordedDay | undefined,
  ): void {
    if (!this.#allowed()) return;
    const event = productEventFromWire({ name, at: this.#now(), properties });
    if (!event) return;
    this.#queue.push(recorded ? { event, recorded } : { event });
    this.#trimQueue();
  }

  /** This run's guard for one event and discriminator, by account. */
  #recordedDaysOf(name: ProductEventName, discriminator: string): Map<string, string> {
    let byDiscriminator = this.#recordedDays.get(name);
    if (!byDiscriminator) {
      byDiscriminator = new Map();
      this.#recordedDays.set(name, byDiscriminator);
    }
    let byAccount = byDiscriminator.get(discriminator);
    if (!byAccount) {
      byAccount = new Map();
      byDiscriminator.set(discriminator, byAccount);
    }
    return byAccount;
  }

  #flushEffect(): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.gen({ self: this }, function* () {
      if (this.#queue.length === 0) return;
      const holder = yield* this.#readAccountKey();
      // Gone whatever becomes of the request, save for the one end that never
      // authenticated at all.
      const queued = this.#ownDays(this.#queue.splice(0, PRODUCT_EVENT_BATCH_LIMIT), holder);
      if (queued.length > 0) yield* this.#send(queued);
    });
  }

  /**
   * The batch without the day marks of an account no longer signed in. The
   * service counts a batch for whoever its bearer names, so a mark queued
   * before a sign-out and another sign-in would count the first account's day
   * for the second; it goes instead, and this run's guard forgets it, so the
   * first account is counted if it signs in again today. Signed out, the
   * batch is kept whole for the sign-in it waits on.
   */
  #ownDays(queued: QueuedEvent[], holder: string | undefined): QueuedEvent[] {
    if (holder === undefined) return queued;
    return queued.filter(({ recorded }) => {
      if (!recorded || recorded.account === holder) return true;
      this.#recordedDaysOf(recorded.name, recorded.discriminator).delete(recorded.account);
      return false;
    });
  }

  /** Posts one batch. */
  #send(queued: QueuedEvent[]): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.suspend(() =>
      Effect.flatMap(
        this.#call.send({
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.EVENTS,
          body: JSON.stringify({ events: queued.map(({ event }) => event) }),
        }),
        (answer) => {
          // The service answered, so whatever it made of the batch, a day it
          // carried is not to be sent again: kept for the next launch.
          if (callAnswered(answer)) return this.#keepRecordedDays(queued);
          // Signed out is temporary and nobody's fault, and nothing was asked
          // of the service, so the batch waits rather than being spent. An
          // account that changed under a refreshed token is not that case:
          // those counts were queued by an account this request can no longer
          // name, and they go.
          if (answer.fault === CALL_FAULT.NO_CREDENTIAL) {
            this.#queue.unshift(...queued);
            this.#trimQueue();
          }
          return Effect.void;
        },
      ),
    );
  }

  #keepRecordedDays(queued: readonly QueuedEvent[]): Effect.Effect<void> {
    return Effect.forEach(
      queued,
      ({ recorded }) => (recorded ? this.#keptDays.keepRecordedDay(recorded) : Effect.void),
      { discard: true },
    );
  }

  #trimQueue(): void {
    if (this.#queue.length > this.#queueLimit) {
      this.#queue.splice(0, this.#queue.length - this.#queueLimit);
    }
  }
}
