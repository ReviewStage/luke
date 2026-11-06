import { scheduleRepeat } from "@repo/runtime/effect";
import { positiveInteger } from "@repo/wire";
import { Duration, Effect, type Layer, Schedule, type Scope, Semaphore } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import { CALL_FAULT, type CallCredential, resolvedCredential } from "../account-call.js";
import { askHosted, type HostedClient, HostedUnanswered, hostedClient } from "../hosted-link.js";
import {
  PRODUCT_EVENT,
  PRODUCT_EVENT_BATCH_LIMIT,
  PRODUCT_EVENT_BUILD_FIELD,
  type ProductClientPlatform,
  type ProductEvent,
  type ProductEventBuild,
  type ProductEventName,
  type ProductEventPropertiesFor,
  productEventFromWire,
} from "./product-events.js";

const PRODUCT_EVENT_DEFAULTS = {
  FLUSH_INTERVAL_MS: 60_000,
  QUEUE_LIMIT: 200,
} as const;

const DAY_ACTIVE_KEY = "day";

const UNNAMED_ACCOUNT = "";

const UNKEPT_DAYS: RecordedDayStore = {
  lastRecordedDay: () => Effect.succeed(undefined),
  keepRecordedDay: () => Effect.void,
};

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export interface RecordedDay {
  readonly name: ProductEventName;
  readonly discriminator: string;
  readonly account: string;
  readonly day: string;
}

export interface RecordedDayStore {
  readonly lastRecordedDay: (
    name: ProductEventName,
    discriminator: string,
    account: string,
  ) => Effect.Effect<string | undefined>;
  readonly keepRecordedDay: (recorded: RecordedDay) => Effect.Effect<void>;
}

interface QueuedEvent {
  readonly event: ProductEvent;
  readonly recorded?: RecordedDay;
}

export interface ProductEventSenderOptions {
  credential: CallCredential;
  confirmAccount?: (() => Effect.Effect<void>) | undefined;
  serviceBaseUrl: string;
  appVersion: string;
  packaged: boolean;
  platform: ProductClientPlatform;
  sends: boolean;
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  recordedDays?: RecordedDayStore;
  now?: () => number;
  requestTimeoutMs?: number;
  flushIntervalMs?: number;
  queueLimit?: number;
}

export class ProductEventSender {
  readonly #hosted: HostedClient;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;
  readonly #appVersion: string;
  readonly #build: ProductEventBuild;
  readonly #sends: boolean;
  readonly #now: () => number;
  readonly #flushIntervalMs: number;
  readonly #queueLimit: number;
  readonly #readHolder: () => Effect.Effect<string | undefined>;
  readonly #confirmAccount: () => Effect.Effect<void>;
  readonly #keptDays: RecordedDayStore;
  readonly #queue: QueuedEvent[] = [];
  readonly #recordedDays = new Map<ProductEventName, Map<string, Map<string, string>>>();
  #armed = false;
  readonly #gate = Semaphore.makeUnsafe(1);

  readonly #tick: Effect.Effect<void> = Effect.suspend(() =>
    Effect.andThen(this.markDayActive(), this.flush),
  );

  readonly flush: Effect.Effect<void> = Effect.suspend(() =>
    this.#gate.withPermits(1)(Effect.provide(this.#flushEffect(), this.#client)),
  );

  readonly drop: Effect.Effect<void> = Effect.sync(() => {
    this.#queue.length = 0;
  });

  private constructor(options: ProductEventSenderOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = options.httpClient ?? FetchHttpClient.layer;
    this.#appVersion = options.appVersion;
    this.#build = {
      [PRODUCT_EVENT_BUILD_FIELD.APP_VERSION]: options.appVersion,
      [PRODUCT_EVENT_BUILD_FIELD.PACKAGED]: options.packaged,
      [PRODUCT_EVENT_BUILD_FIELD.PLATFORM]: options.platform,
    };
    this.#sends = options.sends;
    this.#now = options.now ?? Date.now;
    const credential = resolvedCredential(options.credential);
    this.#readHolder = () =>
      Effect.flatMap(credential, (current) =>
        current.holder === undefined ? Effect.succeed(UNNAMED_ACCOUNT) : current.holder(),
      );
    this.#confirmAccount = options.confirmAccount ?? (() => Effect.void);
    this.#keptDays = options.recordedDays ?? UNKEPT_DAYS;
    this.#flushIntervalMs = positiveInteger(
      options.flushIntervalMs,
      PRODUCT_EVENT_DEFAULTS.FLUSH_INTERVAL_MS,
    );
    this.#queueLimit = positiveInteger(options.queueLimit, PRODUCT_EVENT_DEFAULTS.QUEUE_LIMIT);
  }

  static make(
    options: ProductEventSenderOptions,
  ): Effect.Effect<ProductEventSender, never, Scope.Scope> {
    return Effect.gen(function* () {
      const sender = new ProductEventSender(options);
      if (options.sends) {
        const interval = Duration.millis(sender.#flushIntervalMs);
        yield* scheduleRepeat(Schedule.spaced(interval), Effect.delay(sender.#tick, interval));
      }
      return sender;
    });
  }

  get appVersion(): string {
    return this.#appVersion;
  }

  record<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): void {
    this.#enqueue(name, properties, undefined);
  }

  markDayActive(): Effect.Effect<void> {
    return this.recordOncePerDay(PRODUCT_EVENT.APP_DAY_ACTIVE, DAY_ACTIVE_KEY, {
      app_version: this.#appVersion,
    });
  }

  recordOncePerDay<Name extends ProductEventName>(
    name: Name,
    discriminator: string,
    properties: ProductEventPropertiesFor<Name>,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#allowed()) return;
      const account = yield* this.#readHolder();
      if (account === undefined) return;
      const day = utcDay(this.#now());
      const accounts = this.#recordedDaysOf(name, discriminator);
      if (accounts.get(account) === day) return;
      const kept = yield* this.#keptDays.lastRecordedDay(name, discriminator, account);
      if (accounts.get(account) === day) return;
      accounts.set(account, day);
      if (kept === day) return;
      this.#enqueue(name, properties, { name, discriminator, account, day });
    });
  }

  arm(): void {
    this.#armed = true;
  }

  disarm(): void {
    this.#armed = false;
    this.#queue.length = 0;
    this.#recordedDays.clear();
  }

  #allowed(): boolean {
    return this.#sends && this.#armed;
  }

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
      yield* this.#confirmAccount();
      const holder = yield* this.#readHolder();
      const queued = this.#ownDays(this.#queue.splice(0, PRODUCT_EVENT_BATCH_LIMIT), holder);
      if (queued.length > 0) yield* this.#send(queued);
    });
  }

  #ownDays(queued: QueuedEvent[], holder: string | undefined): QueuedEvent[] {
    if (holder === undefined) return queued;
    return queued.filter(({ recorded }) => {
      if (!recorded || recorded.account === holder) return true;
      this.#recordedDaysOf(recorded.name, recorded.discriminator).delete(recorded.account);
      return false;
    });
  }

  #send(queued: QueuedEvent[]): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.suspend(() =>
      Effect.flatMap(
        Effect.match(
          askHosted(this.#hosted.events.record, {
            events: queued.map(({ event }) => event),
            build: this.#build,
          }),
          {
            onFailure: (failure) =>
              failure instanceof HostedUnanswered ? failure.fault : undefined,
            onSuccess: () => undefined,
          },
        ),
        (fault) => {
          if (fault === undefined) return this.#keepRecordedDays(queued);
          if (fault === CALL_FAULT.NO_CREDENTIAL) {
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
