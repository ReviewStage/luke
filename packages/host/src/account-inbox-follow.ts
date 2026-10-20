import type { AccountInboxAnswer } from "@luke/features/account-inbox-wire";
import {
  type AccountInboxLiveAnswer,
  type AccountInboxLiveRows,
  accountInboxLiveRowSchemas,
  accountInboxOfLiveRows,
  nextFailedRunExpiry,
  type SealedLiveQueryWire,
} from "@luke/features/live-wire";
import type { RealtimeLogEntry } from "@neon/realtime/client";
import {
  Cause,
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  ErrorReporter,
  Fiber,
  Option,
  Queue,
  Schema,
  Stream,
} from "effect";

/**
 * account-inbox-follow.ts -- what waits on the developer across the account, followed over Neon Realtime as Neon's guide says to.
 *
 * The sealed statements are fetched from the service ("Fetch from an API
 * endpoint"), subscribed to at the address the answer names ("Subscribe to
 * the sealed query"), and renewed ten seconds before they expire, a failed
 * fetch asked again a second later ("Renew the sealed query"). Every part's
 * rows are decoded where they arrive, and once every part has its first
 * result each change publishes the account inbox's answer whole, as the held
 * read answered it. The sealed statements stay here, where the account's own
 * bearer is: only the answer built from the rows is published.
 *
 * A seal the service did not answer is asked for again, and a subscription
 * that stops for good started again, after `LIVE_RESTART`.
 *
 * A follow that has published no answer `FIRST_ANSWER_BOUND` after it began,
 * or after it restarted from a subscription it had answered on, is reported
 * once for that silence, as a warning, to the host's line and to whatever
 * error reporter the runtime carries, naming why it last stopped and never an
 * address or a seal, and goes on asking. Realtime's client reconnects a
 * socket that never opens, and asks again to be admitted where Realtime
 * refuses it for now, without end and says nothing of either, so without
 * this a socket the page may not open (the web app's
 * `Content-Security-Policy`), or a Realtime whose backend cannot start,
 * leaves the account's inbox empty in silence. The report says too what
 * Realtime's client last reported going wrong on the attempt whose end it
 * names, by its diagnostic's name and code alone (`troubleOf`), which tells
 * those two apart.
 *
 * Where the shell says when its page came back (`returns`: shown again, or
 * back online), a follow whose subscriptions had been live and dropped,
 * that waits out `LIVE_RESTART`, or that has been connecting past
 * `CONNECT_GRACE` without ever going live, is started again at once rather
 * than after Realtime's own backoff, since a phone drops a page's socket
 * while it is in the background. A follow whose every part is live is left
 * alone, and so is one just begun connecting, which a second return must
 * not tear down; a return within `RETURNS_TAKEN_EVERY` of one that started
 * the follow again is taken as the same.
 */

/** How long before a sealed statement expires it is renewed, as Neon's own bindings renew it. */
const RENEW_EARLY = Duration.seconds(10);
/** How soon a renewal whose fetch failed is asked again, as Neon's own bindings ask. */
const RENEW_RETRY = Duration.seconds(1);
/** How long after a seal went unanswered, or a subscription stopped for good, it is asked again. */
const LIVE_RESTART = Duration.seconds(5);

/** How soon after a return started the follow again a later one is taken as the same, as a restore from the back-forward cache says `pageshow` and `visibilitychange` at once. */
const RETURNS_TAKEN_EVERY = Duration.seconds(1);

/** How long a follow may still be connecting, never yet live, before a return takes it as stalled, as one begun offline is. */
const CONNECT_GRACE = Duration.seconds(5);

/** How long a follow may go without its first answer before it is reported, once. */
const FIRST_ANSWER_BOUND = Duration.seconds(30);

/** How often a follower holding no failed run looks again for one to age out, since one may arrive meanwhile. */
const EXPIRY_RECHECK = Duration.hours(1);

/** A subscription that stopped for good: Realtime said so, its client refused a seal, or a row did not decode. */
class LiveBroken extends Data.TaggedError("LiveBroken")<{ readonly reason: string }> {}

/** A follow that has answered nothing within its bound, reported once as a warning; `reason` is why it last stopped and what Realtime's client last reported, never an address or a seal. */
class LiveUnanswered extends Data.TaggedError("LiveUnanswered")<{ readonly reason: string }> {
  override readonly [ErrorReporter.severity] = "Warn" as const;
  override get message(): string {
    return `the account inbox's live read has not answered in ${Duration.toSeconds(FIRST_ANSWER_BOUND)} seconds: ${this.reason}`;
  }
}

/** Why a follow that never stopped has not answered: its parts have not all delivered, as when the socket never opened. */
const NOT_DELIVERED = "Realtime has not delivered every part";

/**
 * Realtime's diagnostic for an admission it will ask for again, which it
 * reports beneath its warnings although it is what a Realtime that cannot
 * start answers every part with.
 */
const ADMISSION_RETRIED = "subscription_retry_scheduled";

/** A diagnostic's event or code as Realtime's protocol and client spell one; anything else is left unsaid. */
const TROUBLE_WORD = /^[a-z][a-z0-9_]{0,63}$/u;

/** The parts the account inbox is followed in, one sealed statement each. */
const LIVE_PART = {
  ITEMS: "items",
  TASKLESS: "planless",
  PLANS: "plans",
  AUTOMATIONS: "automations",
  FAILED_RUNS: "failedRuns",
  CHAT_ASKS: "chatAsks",
  CHAT_NOTICES: "chatNotices",
} as const;

type Part = (typeof LIVE_PART)[keyof typeof LIVE_PART];

const PARTS: readonly Part[] = Object.values(LIVE_PART);

/** What Realtime calls a subscription that is caught up and following. */
const LIVE_STATUS = "live";

/** One part's subscription, the slice of Realtime's client this reads. */
interface LiveSubscription {
  onChange(
    listener: (snapshot: {
      readonly status: string;
      readonly data: readonly unknown[] | undefined;
    }) => void,
  ): () => void;
  renew(query: SealedLiveQueryWire): Promise<void>;
  unsubscribe(): void;
}

/** One socket to Realtime, every part's subscription on it. */
export interface LiveClient {
  subscribe(query: SealedLiveQueryWire): LiveSubscription;
  close(): void;
}

/** Hears what Realtime's client reported going wrong, in the words `troubleOf` gives it. */
type TroubleHeard = (trouble: string) => void;

/**
 * What one of Realtime's diagnostics says went wrong, or nothing where it
 * says nothing did: a warning, an error, or an admission it will ask for
 * again, named by the diagnostic's event and the code beside it, each only as
 * Realtime spells one (`TROUBLE_WORD`). Note that nothing else of the entry
 * is said, because its error may carry what the proxy answered, while an
 * event's name and a code name no address, seal, or row.
 */
function troubleOf(entry: RealtimeLogEntry): string | undefined {
  const troubling =
    entry.level === "warn" || entry.level === "error" || entry.event === ADMISSION_RETRIED;
  if (!troubling || !TROUBLE_WORD.test(entry.event)) return undefined;
  const code = "code" in entry ? entry.code : undefined;
  return code !== undefined && TROUBLE_WORD.test(code) ? `${entry.event} (${code})` : entry.event;
}

/**
 * Realtime's own client, at the address the service named, loaded only when
 * the account is first followed, so its protocol's validators stay out of the
 * web app's first load, telling `heard` each thing its diagnostics say went
 * wrong.
 */
export const openRealtimeClient = (url: string, heard: TroubleHeard): Promise<LiveClient> =>
  import("@neon/realtime/client").then(({ createRealtimeClient }) =>
    createRealtimeClient({
      url,
      // Note that the client reports a retried admission only at its debug level.
      logLevel: "debug",
      logger: (entry) => {
        const trouble = troubleOf(entry);
        if (trouble !== undefined) heard(trouble);
      },
    }),
  );

export interface AccountInboxFollowDependencies {
  /** The sealed statements, fetched from the service; a failure where it answered none. */
  readonly live: () => Effect.Effect<AccountInboxLiveAnswer | { readonly failure: string }>;
  /** Realtime's client at the address the service named, loaded where it must be, telling `heard` what it reports going wrong. */
  readonly openLive: (url: string, heard: TroubleHeard) => LiveClient | PromiseLike<LiveClient>;
  /** Now, by the host's own clock: when an answer was read, and how far back a failed run is still told. */
  readonly now: () => number;
  /** The answer, each time it changes. */
  readonly publish: (answer: AccountInboxAnswer) => void;
  /** Each time the page the host runs in came back, where the shell can tell; nothing where it cannot. */
  readonly returns: Stream.Stream<void>;
}

/** The earliest any of the answer's sealed statements expires, in epoch milliseconds. */
function earliestExpiry(answer: AccountInboxLiveAnswer): number {
  return Math.min(...Object.values(answer.queries).map((query) => query.expiresAt));
}

/** The rows as every part last delivered them, or nothing before each has its first result. */
interface PartRows {
  items?: AccountInboxLiveRows["items"];
  planless?: AccountInboxLiveRows["planless"];
  plans?: AccountInboxLiveRows["plans"];
  automations?: AccountInboxLiveRows["automations"];
  failedRuns?: AccountInboxLiveRows["failedRuns"];
  chatAsks?: AccountInboxLiveRows["chatAsks"];
  chatNotices?: AccountInboxLiveRows["chatNotices"];
}

function whole(rows: PartRows): Option.Option<AccountInboxLiveRows> {
  const { items, planless, plans, automations, failedRuns, chatAsks, chatNotices } = rows;
  return items && planless && plans && automations && failedRuns && chatAsks && chatNotices
    ? Option.some({ items, planless, plans, automations, failedRuns, chatAsks, chatNotices })
    : Option.none();
}

/**
 * The answers the live rows make, for as long as the subscriptions stand:
 * each part subscribed to, its rows decoded as they arrive, and every seal
 * renewed before it expires, what Realtime's client reports going wrong told
 * to `heard`. It fails where a subscription stops for good.
 */
function liveAnswers(
  dependencies: AccountInboxFollowDependencies,
  first: AccountInboxLiveAnswer,
  heard: TroubleHeard,
  answering: (every: boolean) => void,
): Stream.Stream<AccountInboxAnswer, LiveBroken> {
  return Stream.callback<AccountInboxAnswer, LiveBroken>((queue) =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => dependencies.openLive(first.url, heard),
          catch: () => new LiveBroken({ reason: "Realtime's client did not load" }),
        }),
        (opened) => Effect.sync(() => opened.close()),
      );
      const rows: PartRows = {};
      // The parts whose subscription Realtime last said is live.
      const live = new Set<Part>();
      const broken = (reason: string) =>
        Queue.failCauseUnsafe(queue, Cause.fail(new LiveBroken({ reason })));
      const changed = () => {
        const read = whole(rows);
        if (Option.isSome(read))
          Queue.offerUnsafe(queue, accountInboxOfLiveRows(read.value, dependencies.now()));
      };
      /** One part followed: its rows decoded as they arrive and kept under its key. */
      const follow = <Row, Encoded>(
        part: Part,
        schema: Schema.Codec<Row, Encoded>,
        keep: (decoded: readonly Row[]) => void,
      ): LiveSubscription => {
        const subscription = client.subscribe(first.queries[part]);
        const decode = Schema.decodeUnknownOption(Schema.Array(schema));
        subscription.onChange((snapshot) => {
          if (snapshot.status === LIVE_STATUS) live.add(part);
          else live.delete(part);
          answering(live.size === PARTS.length);
          if (snapshot.status === "error") {
            broken("the subscription stopped");
            return;
          }
          if (snapshot.data === undefined) return;
          const decoded = decode(snapshot.data);
          if (Option.isNone(decoded)) {
            broken("a row did not decode");
            return;
          }
          keep(decoded.value);
          changed();
        });
        return subscription;
      };
      // Note that Realtime's client throws where it refuses a seal, and a throw here would end the whole follow in silence.
      const subscriptions = yield* Effect.acquireRelease(
        Effect.try({
          try: () => ({
            items: follow(LIVE_PART.ITEMS, accountInboxLiveRowSchemas.items, (read) => {
              rows.items = read;
            }),
            planless: follow(LIVE_PART.TASKLESS, accountInboxLiveRowSchemas.planless, (read) => {
              rows.planless = read;
            }),
            plans: follow(LIVE_PART.PLANS, accountInboxLiveRowSchemas.plans, (read) => {
              rows.plans = read;
            }),
            automations: follow(
              LIVE_PART.AUTOMATIONS,
              accountInboxLiveRowSchemas.automations,
              (read) => {
                rows.automations = read;
              },
            ),
            failedRuns: follow(
              LIVE_PART.FAILED_RUNS,
              accountInboxLiveRowSchemas.failedRuns,
              (read) => {
                rows.failedRuns = read;
              },
            ),
            chatAsks: follow(LIVE_PART.CHAT_ASKS, accountInboxLiveRowSchemas.chatAsks, (read) => {
              rows.chatAsks = read;
            }),
            chatNotices: follow(
              LIVE_PART.CHAT_NOTICES,
              accountInboxLiveRowSchemas.chatNotices,
              (read) => {
                rows.chatNotices = read;
              },
            ),
          }),
          catch: () => new LiveBroken({ reason: "Realtime's client refused a seal" }),
        }),
        (standing) =>
          Effect.sync(() => {
            for (const subscription of Object.values(standing)) subscription.unsubscribe();
          }),
      );
      // A failed run ages out of the last week with no row moving, so the answer is published again as it does.
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.suspend(() => {
            const now = dependencies.now();
            const next =
              rows.failedRuns === undefined ? undefined : nextFailedRunExpiry(rows.failedRuns, now);
            return next === undefined
              ? Effect.sleep(EXPIRY_RECHECK)
              : Effect.andThen(Effect.sleep(Duration.millis(next - now + 1)), Effect.sync(changed));
          }),
        ),
      );
      let expiresAt = earliestExpiry(first);
      const renewal = Effect.gen(function* () {
        const wait = expiresAt - Duration.toMillis(RENEW_EARLY) - dependencies.now();
        yield* Effect.sleep(Duration.millis(Math.max(0, wait)));
        let next = yield* dependencies.live();
        while ("failure" in next) {
          yield* Effect.sleep(RENEW_RETRY);
          next = yield* dependencies.live();
        }
        const renewed = next;
        yield* Effect.forEach(
          PARTS,
          (part) =>
            Effect.tryPromise({
              try: () => subscriptions[part].renew(renewed.queries[part]),
              catch: () => new LiveBroken({ reason: "a renewal was refused" }),
            }),
          { discard: true },
        );
        expiresAt = earliestExpiry(renewed);
      });
      yield* Effect.forkScoped(
        Effect.forever(renewal).pipe(
          Effect.catch((failure) => Effect.sync(() => broken(failure.reason))),
        ),
      );
    }),
  );
}

/**
 * What waits across the account, followed live until interrupted.
 */
export function followAccountInbox(
  dependencies: AccountInboxFollowDependencies,
): Effect.Effect<never> {
  return Effect.gen(function* () {
    let answered = false;
    let stopped = NOT_DELIVERED;
    // What Realtime's client last reported going wrong on the attempt `stopped` describes, if anything.
    let trouble: string | undefined;
    const heard: TroubleHeard = (said) => {
      trouble = said;
    };
    const watchdog = Effect.forkChild(
      Effect.gen(function* () {
        yield* Effect.sleep(FIRST_ANSWER_BOUND);
        if (answered) return;
        const unanswered = new LiveUnanswered({
          reason:
            trouble === undefined
              ? stopped
              : `${stopped}; Realtime's client last reported ${trouble}`,
        });
        yield* Effect.logWarning(unanswered.message);
        yield* ErrorReporter.report(Cause.fail(unanswered));
      }),
    );
    let watching = yield* watchdog;
    // Whether this attempt's every part has been live, whether a return should start it again
    // (it dropped since, or waits to start again), when it began, when a return last woke it, and
    // what a return wakes.
    let beenLive = false;
    let restartable = false;
    let startedAt = yield* Clock.currentTimeMillis;
    let wokenAt = Number.NEGATIVE_INFINITY;
    let wake = yield* Deferred.make<void>();
    const returned = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      // Note that only a return that woke the follow holds the next back, so a return that found it live hides no drop after it.
      if (now - wokenAt < Duration.toMillis(RETURNS_TAKEN_EVERY)) return;
      const stalled = !beenLive && now - startedAt >= Duration.toMillis(CONNECT_GRACE);
      if (!restartable && !stalled) return;
      wokenAt = now;
      yield* Deferred.succeed(wake, undefined);
    });
    yield* Effect.forkChild(Stream.runForEach(dependencies.returns, () => returned));
    /** Waits out the pause before the next attempt, which a return may cut short. */
    const pause = Effect.andThen(
      Effect.sync(() => {
        restartable = true;
      }),
      Effect.sleep(LIVE_RESTART),
    );
    const work = Effect.gen(function* () {
      const sealed = yield* dependencies.live();
      if ("failure" in sealed) {
        stopped = `the service sealed nothing (${sealed.failure})`;
        trouble = undefined;
        return yield* pause;
      }
      stopped = NOT_DELIVERED;
      trouble = undefined;
      const answers = liveAnswers(dependencies, sealed, heard, (every) => {
        if (every) beenLive = true;
        restartable = beenLive && !every;
      });
      yield* Stream.runForEach(answers, (answer) =>
        Effect.sync(() => {
          answered = true;
          dependencies.publish(answer);
        }),
      ).pipe(
        Effect.catch((failure) =>
          Effect.andThen(
            Effect.sync(() => {
              stopped = failure.reason;
            }),
            pause,
          ),
        ),
      );
    });
    const attempt = Effect.gen(function* () {
      // Note that a follow that answered and then stopped is watched afresh from its restart,
      // because otherwise one that dies after its first answer would go silent for good.
      if (answered) {
        answered = false;
        yield* Fiber.interrupt(watching);
        watching = yield* watchdog;
      }
      beenLive = false;
      restartable = false;
      startedAt = yield* Clock.currentTimeMillis;
      wake = yield* Deferred.make<void>();
      // A return to a follow that dropped, or waits, ends the attempt, and its wait, at once.
      yield* Effect.race(work, Deferred.await(wake));
    });
    return yield* Effect.forever(attempt);
  });
}
