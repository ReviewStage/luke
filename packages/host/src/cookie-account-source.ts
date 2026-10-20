/**
 * cookie-account-source.ts -- the account of a host in a browser tab on the service's own origin: the Better Auth cookie session, read and ended through the service, keeping no secret of its own.
 *
 * The cookie is the browser's, set by the service and sent by the tab's own
 * fetch on every same-origin request, so nothing here reads, keeps, or
 * forwards it: every request below goes out with no `Authorization`, and the
 * only things read off an answer are the user's id, address, name, picture
 * and how they last signed in. A refused hosted call re-reads the session,
 * which is how a session that ended elsewhere signs this tab out.
 */

import {
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
  isAccountProvider,
} from "@luke/credentials/snapshot";
import {
  type AccountCallEffects,
  type AccountToken,
  accountCall,
  type CallCredential,
  callAnswered,
  HOSTED_SERVICE_PATH,
  NO_CREDENTIAL,
} from "@luke/features";
import { pinnedPictureUrl } from "@luke/features/account-picture";
import { HTTP_METHOD, HTTP_STATUS } from "@luke/wire";
import {
  Data,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  PubSub,
  Result,
  Schedule,
  Schema,
  type Scope,
  Semaphore,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountSession, AccountSourceHost } from "./account-source.js";
import { AccountSource } from "./effect/seams.js";

/** Better Auth's own paths, under the account service's address (`<origin>/api/auth`). */
const AUTH_PATH = {
  GET_SESSION: "/get-session",
  SIGN_IN_SOCIAL: "/sign-in/social",
  LINK_SOCIAL: "/link-social",
  SIGN_OUT: "/sign-out",
} as const;

/**
 * How the launch's own read retries a service it could not read: soon, a few
 * times, and then the account stands as it was settled, so a blip at launch
 * does not leave a signed-in person on the sign-in screen.
 */
const LAUNCH_REREAD = {
  FIRST: Duration.seconds(1),
  TIMES: 5,
} as const;

/**
 * Returns to the tab that come this close together are one return: a tab
 * shown again is focused as well, and both events say so.
 */
const REVISIT_WINDOW = Duration.seconds(1);

/** The answer `get-session` gives: the session's user, or `null` for none. */
const SessionAnswerSchema = Schema.fromJsonString(
  Schema.NullOr(
    Schema.Struct({
      user: Schema.Struct({
        id: Schema.NonEmptyString,
        email: Schema.NonEmptyString,
        name: Schema.optionalKey(Schema.NullOr(Schema.String)),
        image: Schema.optionalKey(Schema.NullOr(Schema.String)),
        lastLoginMethod: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    }),
  ),
);

/** The answer a social sign-in or link gives: the provider's address to go to. */
const RedirectAnswerSchema = Schema.fromJsonString(Schema.Struct({ url: Schema.NonEmptyString }));

const decodeSessionAnswer = Schema.decodeUnknownResult(SessionAnswerSchema);
const decodeRedirectAnswer = Schema.decodeUnknownResult(RedirectAnswerSchema);

/** One request and its answer, as the account call states them. */
type CallRequest = Parameters<AccountCallEffects["send"]>[0];
type CallAnswer = Effect.Success<ReturnType<AccountCallEffects["send"]>>;

const SIGNED_OUT: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };

/**
 * What the shell hands the source for the one thing a sign-in needs of the
 * tab: where it stands, and how to leave it for the provider. The package
 * reaches no `window` of its own.
 */
export interface CookieSessionDoor {
  /** Where the tab stands, as a path with its query and fragment, for a sign-in to come back to. */
  readonly currentAddress: () => string;
  /** Takes the tab to an address, such as the provider's consent a sign-in leaves for. */
  readonly navigate: (url: string) => Effect.Effect<void>;
  /**
   * Each return to the tab (shown again, or focused), built by the shell from
   * the page's own events. The session is read again on each, because the
   * cookie is the browser's: another tab may have signed out, or in as
   * someone else, and no call of this one need be refused to show it.
   */
  readonly revisits: Stream.Stream<void>;
}

/** A session step the service did not carry, worded by status or by the kind of fault, never by a body. */
export class CookieSessionFailed extends Data.TaggedError("CookieSessionFailed")<{
  readonly message: string;
}> {}

/** A session read the service did not answer: an outage, never a sign-out. */
class SessionUnreadable extends Data.TaggedError("SessionUnreadable") {}

/** A session read a change of the account overtook while it was asked, which settles nothing. */
class ReadSuperseded extends Data.TaggedError("ReadSuperseded") {}

/** The account a session read settled on. */
type SessionRead =
  | { readonly signedIn: true; readonly account: AccountSnapshot }
  | { readonly signedIn: false };

/**
 * The account a session's user is, as the desktop reads a stored account:
 * one whose last sign-in names no provider this build knows is no account,
 * exactly as the settings store drops a stored account without one.
 */
function accountOf(user: {
  readonly id: string;
  readonly email: string;
  readonly name?: string | null;
  readonly image?: string | null;
  readonly lastLoginMethod?: string | null;
}): SessionRead {
  const provider = user.lastLoginMethod;
  if (!isAccountProvider(provider)) return { signedIn: false };
  const pictureUrl = pinnedPictureUrl(user.image);
  return {
    signedIn: true,
    account: {
      status: ACCOUNT_STATUS.SIGNED_IN,
      id: user.id,
      email: user.email,
      ...(user.name ? { name: user.name } : undefined),
      ...(pictureUrl ? { pictureUrl } : undefined),
      provider,
    },
  };
}

/** The signed-in person's id, and nothing for any other status. */
function signedInId(snapshot: AccountSnapshot): string | undefined {
  return snapshot.status === ACCOUNT_STATUS.SIGNED_IN ? snapshot.id : undefined;
}

/** Whether two signed-in reads name the same person drawn the same way. */
function sameAccount(left: AccountSnapshot, right: AccountSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The browser's account source: a Better Auth cookie session on the
 * service's own origin. It hands the settings store no cipher, so the store
 * keeps no account, and every account read in the host goes through the
 * session it opens. The requests go out on the `HttpClient` the host was
 * composed with, whose same-origin fetch sends the cookie.
 */
export const cookieAccountSourceLayer = (
  door: CookieSessionDoor,
): Layer.Layer<AccountSource, never, HttpClient.HttpClient> =>
  Layer.effect(
    AccountSource,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return {
        tokenCipher: undefined,
        open: (host: AccountSourceHost) => openCookieSession(host, door, client),
      };
    }),
  );

const openCookieSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  host: AccountSourceHost,
  door: CookieSessionDoor,
  client: HttpClient.HttpClient,
): Effect.fn.Return<AccountSession, never, Scope.Scope> {
  const { runMode, report } = host;
  const authCall = accountCall({ baseUrl: host.accountBaseUrl, credential: NO_CREDENTIAL });
  const serviceCall = accountCall({
    baseUrl: host.hostedServiceBaseUrl,
    credential: NO_CREDENTIAL,
  });
  const changesPubSub = yield* PubSub.unbounded<AccountSnapshot>();
  let account: AccountSnapshot = SIGNED_OUT;
  /**
   * Moved by every change of the account, a press's or a read's, so a read
   * begun before one settles nothing and a gate move made for one is passed
   * over once a later change stands.
   */
  let generation = 0;
  /** The generation a sign-in left the tab for the provider at, and nothing before it left. */
  let departedAt: number | undefined;
  // Note that a read or a gate move ending after the session closed settles
  // nothing, because the composers it would move have stopped.
  let closed = false;
  const sessionScope = yield* Effect.scope;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }),
  );
  const gateMoves = yield* Semaphore.make(1);

  const send = (call: AccountCallEffects, request: CallRequest): Effect.Effect<CallAnswer> =>
    Effect.provideService(call.send(request), HttpClient.HttpClient, client);

  /** A step's failure, by status or the kind of fault alone. */
  const failed = (what: string, answer: CallAnswer) =>
    new CookieSessionFailed({
      message: callAnswered(answer)
        ? `${what}: the service answered ${answer.response.status}`
        : `${what}: ${answer.errorName ?? answer.fault}`,
    });

  /**
   * One move of the capability gate, taken in turn with every other, and
   * passed over where a later change of the account superseded it, so a
   * slow opening can never land after the closing a sign-out made.
   */
  const moveGate = (asOf: number, move: Effect.Effect<void>): Effect.Effect<void> =>
    gateMoves.withPermits(1)(
      Effect.suspend(() => (asOf === generation && !closed ? move : Effect.void)),
    );

  /** A gate move forked into the session's own scope, so it ends with the session. */
  const forkMove = (asOf: number, move: Effect.Effect<void>) =>
    Effect.forkIn(moveGate(asOf, move), sessionScope);

  /** A settings step of an account change, whose failure is reported and never holds the change up. */
  const settingsStep = (step: Effect.Effect<unknown, Error>, what: string): Effect.Effect<void> =>
    Effect.catch(Effect.asVoid(step), (error) =>
      Effect.sync(() => {
        report(`${what} failed: ${error.message}`);
      }),
    );

  /**
   * What the settings kept for a departed account (its synced preferences and
   * experiments) dropped, so the next person on this browser starts from
   * none of it. Run once the departure is published, so no write for the one
   * leaving lands after it, and before the gate's closing, whose settings
   * snapshot then carries the cleared choices.
   */
  const forgetDeparted = settingsStep(
    host.store.clearAccount(),
    "Dropping the departed account's settings",
  );

  /**
   * What the settings learn of an arriving account before it is published:
   * where what they keep is someone else's, it goes, so no choice of a
   * person who never signed out here stands in for the arrival's.
   */
  const settleArrival = (arriving: AccountSnapshot): Effect.Effect<void> =>
    arriving.status === ACCOUNT_STATUS.SIGNED_IN
      ? settingsStep(
          host.store.settleSessionAccount(arriving.email),
          "Settling the settings on the signed-in account",
        )
      : Effect.void;

  const settleOn = (next: AccountSnapshot): Effect.Effect<void> =>
    Effect.suspend(() => {
      account = next;
      return Effect.asVoid(PubSub.publish(changesPubSub, next));
    });

  /** Settles on `next` only while no later change stands, checked as it is published. */
  const settleOnAsOf = (asOf: number, next: AccountSnapshot): Effect.Effect<void> =>
    Effect.suspend(() => (asOf === generation && !closed ? settleOn(next) : Effect.void));

  /**
   * An arrival, as a gate move: the capabilities of whoever stood before
   * stopped first where someone did, so the arrival is never drawn over the
   * previous person's tasks, terminals or agents; then the settings settled
   * on the arrival, the arrival shown, and its capabilities started. Each
   * step is passed over once a later change stands.
   */
  const arrive = (
    asOf: number,
    arriving: AccountSnapshot,
    afterSomeone: boolean,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (afterSomeone) yield* host.stopCapabilities;
      if (asOf !== generation) return;
      yield* settleArrival(arriving);
      yield* settleOnAsOf(asOf, arriving);
      if (asOf !== generation) return;
      yield* host.startCapabilities;
    });

  /**
   * A read that names nobody while nobody stands. An arrival still on its
   * way is passed over; and a sign-in the tab came back from unfinished,
   * such as through the back button from the provider's page restoring this
   * one, ends. A sign-in still asking the service for the provider's address
   * stands, since that read may predate the session it is about to make.
   */
  const settleNobody: Effect.Effect<void> = Effect.suspend(() => {
    if (account.status === ACCOUNT_STATUS.SIGNING_IN && departedAt !== generation) {
      return Effect.void;
    }
    generation += 1;
    return account.status === ACCOUNT_STATUS.SIGNING_IN ? settleOn(SIGNED_OUT) : Effect.void;
  });

  /** One read of the session: who it names, nobody, or no answer at all. */
  const readSession: Effect.Effect<SessionRead, SessionUnreadable> = Effect.gen(function* () {
    const answer = yield* send(authCall, {
      method: HTTP_METHOD.GET,
      path: AUTH_PATH.GET_SESSION,
    });
    if (!callAnswered(answer)) return yield* new SessionUnreadable();
    if (answer.response.status === HTTP_STATUS.UNAUTHORIZED) return { signedIn: false } as const;
    if (!answer.response.ok) return yield* new SessionUnreadable();
    const body = yield* Effect.orElseSucceed(
      Effect.tryPromise(() => answer.response.text()),
      () => undefined,
    );
    const decoded = decodeSessionAnswer(body);
    if (Result.isFailure(decoded)) return yield* new SessionUnreadable();
    return decoded.success === null
      ? ({ signedIn: false } as const)
      : accountOf(decoded.success.user);
  });

  /**
   * One read settled on: a departure published at once, and the capability
   * gate's move, with any arrival inside it, forked rather than run, because
   * a refused call's renewal may hold a lock the gate's closing needs (the
   * Plans read holds the tasks lock, and `tasks.reset` waits on it). Answers
   * the gate's move, for a caller that holds no such lock to wait on. A read
   * a change overtook fails with `ReadSuperseded`.
   */
  const settleRead: Effect.Effect<
    Fiber.Fiber<void> | undefined,
    SessionUnreadable | ReadSuperseded
  > = Effect.gen(function* () {
    if (!runMode.requiresAccount || !runMode.sendsNetwork) return undefined;
    const asked = generation;
    const read = yield* readSession;
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        if (closed) return undefined;
        if (asked !== generation) return yield* new ReadSuperseded();
        const standing = signedInId(account);
        if (!read.signedIn) {
          if (standing === undefined) return yield* Effect.as(settleNobody, undefined);
          const asOf = ++generation;
          yield* settleOn(SIGNED_OUT);
          yield* forgetDeparted;
          return yield* forkMove(asOf, host.stopCapabilities);
        }
        // The same person, drawn anew where anything of them changed.
        if (standing !== undefined && standing === signedInId(read.account)) {
          if (!sameAccount(account, read.account)) yield* settleOn(read.account);
          return undefined;
        }
        // Note that another person's session, such as a sign-in in another
        // tab, is a departure and an arrival, never a swap under the gate:
        // the departure is shown now, the arrival only once the gate closed.
        const asOf = ++generation;
        if (standing !== undefined) {
          yield* settleOn(SIGNED_OUT);
          yield* forgetDeparted;
        }
        return yield* forkMove(asOf, arrive(asOf, read.account, standing !== undefined));
      }),
    );
  });

  // One read at a time however many ask at once, every ask joining the one
  // under way; a read that ended is never reused, so the next ask reads again.
  const joinRead = yield* Effect.cachedWithTTL(settleRead, Duration.zero);
  // Note that an ask that joined a read a change then overtook, such as a
  // sign-out pressed while it was asked, reads again rather than settling on
  // nothing, so a confirmation always answers for a read begun after it asked.
  const reread = Effect.retry(joinRead, {
    while: (error) => error._tag === "ReadSuperseded",
  });

  const token: AccountToken = {
    // A cookie session holds no bearer: what reads one reads nothing.
    readAccessToken: () => Effect.succeed(undefined),
    refreshAccount: () => Effect.ignore(reread),
    readAccountKey: () =>
      Effect.sync(() => (account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined)),
  };

  // No header at all: the cookie rides the request, a refusal re-reads the
  // session, and the holder is the person the session named when the call began.
  const credential: CallCredential = {
    renew: token.refreshAccount,
    holder: () => Effect.sync(() => signedInId(account)),
  };

  /**
   * The departure as this tab keeps it, waited for: the account cleared and
   * its settings dropped, then the gate closed in turn after any move still
   * under way.
   */
  const leave: Effect.Effect<void> = Effect.uninterruptible(
    Effect.gen(function* () {
      const asOf = ++generation;
      yield* settleOn(SIGNED_OUT);
      yield* forgetDeparted;
      yield* moveGate(asOf, host.stopCapabilities);
    }),
  );

  /** Asks the service for the provider's address and leaves the tab for it. */
  const leaveFor = (path: string, provider: AccountProvider) =>
    Effect.gen(function* () {
      const asked = generation;
      const answer = yield* send(authCall, {
        method: HTTP_METHOD.POST,
        path,
        body: JSON.stringify({ provider, callbackURL: door.currentAddress() }),
      });
      const body =
        callAnswered(answer) && answer.response.ok
          ? yield* Effect.orElseSucceed(
              Effect.tryPromise(() => answer.response.text()),
              () => undefined,
            )
          : undefined;
      const redirect = decodeRedirectAnswer(body);
      if (Result.isFailure(redirect)) return yield* failed("Sign-in could not start", answer);
      // A cancel pressed while the service answered keeps the tab where it is.
      if (asked !== generation) return false;
      yield* door.navigate(redirect.success.url);
      return true;
    });

  const beginSignIn = (provider: AccountProvider) =>
    Effect.gen(function* () {
      if (account.status !== ACCOUNT_STATUS.SIGNED_OUT) return account;
      generation += 1;
      const started = generation;
      yield* settleOn({ status: ACCOUNT_STATUS.SIGNING_IN });
      const left = yield* Effect.result(leaveFor(AUTH_PATH.SIGN_IN_SOCIAL, provider));
      if (Result.isFailure(left)) {
        if (started === generation) yield* settleOn(SIGNED_OUT);
        return yield* Effect.fail(left.failure);
      }
      if (left.success) departedAt = generation;
      // The tab is leaving for the provider; the account lands on the page it comes back to.
      return account;
    });

  /** A read settled on, and the gate's move it made waited for. */
  const settled = (read: typeof reread): Effect.Effect<void> =>
    read.pipe(
      Effect.flatMap((moved) => (moved === undefined ? Effect.void : Fiber.await(moved))),
      Effect.ignore,
    );

  // The launch's own check, which alone retries a service it could not read.
  const refreshOnce = (): Effect.Effect<void> =>
    settled(
      Effect.retry(reread, {
        schedule: Schedule.exponential(LAUNCH_REREAD.FIRST),
        times: LAUNCH_REREAD.TIMES,
      }),
    );

  // Every return to the tab reads the session again, once and unretried, for
  // as long as the session stands open, but only once the launch's own read
  // has settled, so that read's older answer can never land over a newer one.
  // Note that returns made while a read is under way keep only the latest,
  // and returns close together are one, so an outage piles up no reads.
  const initialized = yield* Deferred.make<void>();
  const returns = door.revisits.pipe(
    Stream.buffer({ capacity: 1, strategy: "sliding" }),
    Stream.throttle({ cost: () => 1, units: 1, duration: REVISIT_WINDOW, strategy: "enforce" }),
  );
  yield* Effect.forkScoped(
    Stream.runForEach(returns, () => Effect.andThen(Deferred.await(initialized), settled(reread))),
  );

  return {
    snapshot: () => account,
    changes: PubSub.subscribe(changesPubSub).pipe(Effect.map(Stream.fromSubscription)),
    initialize: Effect.gen(function* () {
      // Note that an outage reads as signed out, there being no account to
      // name, and the launch's own `refreshOnce` reads again soon after.
      const asked = generation;
      const settled = yield* Effect.result(
        runMode.requiresAccount && runMode.sendsNetwork
          ? readSession
          : Effect.succeed({ signedIn: false } as const),
      );
      const initial =
        Result.isSuccess(settled) && settled.success.signedIn
          ? settled.success.account
          : SIGNED_OUT;
      // A change that landed while the launch read, a refused call's, stands over it.
      if (asked === generation) {
        yield* settleArrival(initial);
        account = initial;
      }
      yield* Deferred.succeed(initialized, undefined);
      return account;
    }),
    beginSignIn,
    // Over a session that stands, the provider is linked to the same person
    // again, which renews its grant: Better Auth refuses a link to an
    // identity another account holds, so the person never changes under the
    // tab. Nothing lands on this page either way, since it leaves.
    signInAgain: (provider) =>
      account.status === ACCOUNT_STATUS.SIGNED_IN
        ? Effect.as(leaveFor(AUTH_PATH.LINK_SOCIAL, provider), false)
        : Effect.as(beginSignIn(provider), false),
    cancelSignIn: () => {
      if (account.status !== ACCOUNT_STATUS.SIGNING_IN) return;
      generation += 1;
      account = SIGNED_OUT;
      PubSub.publishUnsafe(changesPubSub, account);
    },
    // Note that the service is asked first, because the cookie is the whole
    // credential and only the service ends it: a tab that left on its own
    // would read the same live session back on its next load.
    signOut: (options) =>
      Effect.gen(function* () {
        if (options.revokeRemote) {
          // A read under way when the sign-out was pressed settles nothing over it.
          generation += 1;
          const answer = yield* send(authCall, {
            method: HTTP_METHOD.POST,
            path: AUTH_PATH.SIGN_OUT,
            body: "{}",
          });
          const ended =
            callAnswered(answer) &&
            (answer.response.ok || answer.response.status === HTTP_STATUS.UNAUTHORIZED);
          if (!ended) return yield* failed("Signing out of the browser session failed", answer);
        }
        yield* leave;
        return account;
      }),
    deleteEverywhere: () =>
      Effect.gen(function* () {
        const answer = yield* send(serviceCall, {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.ACCOUNT_DELETE,
        });
        if (!callAnswered(answer) || !answer.response.ok) {
          return yield* failed("Account deletion failed", answer);
        }
        // The deletion ended the session with the account, so there is nothing left to sign out of remotely.
        yield* leave;
        return account;
      }),
    refreshOnce,
    confirmAccount: () => Effect.ignore(reread),
    token,
    credential,
    sessionCredential: credential,
  };
});
