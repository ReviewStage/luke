import {
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
  isAccountProvider,
} from "@repo/credentials/snapshot";
import {
  type AccountCallEffects,
  type AccountToken,
  accountCall,
  type CallCredential,
  callAnswered,
  HOSTED_SERVICE_PATH,
  NO_CREDENTIAL,
} from "@repo/features";
import { pinnedPictureUrl } from "@repo/features/account-picture";
import { HTTP_METHOD, HTTP_STATUS } from "@repo/wire";
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

const AUTH_PATH = {
  GET_SESSION: "/get-session",
  SIGN_IN_SOCIAL: "/sign-in/social",
  LINK_SOCIAL: "/link-social",
  SIGN_OUT: "/sign-out",
} as const;

const LAUNCH_REREAD = {
  FIRST: Duration.seconds(1),
  TIMES: 5,
} as const;

const REVISIT_WINDOW = Duration.seconds(1);

const SessionAnswerSchema = Schema.fromJsonString(
  Schema.NullOr(
    Schema.Struct({
      session: Schema.optionalKey(
        Schema.Struct({ impersonatedBy: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
      ),
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

const RedirectAnswerSchema = Schema.fromJsonString(Schema.Struct({ url: Schema.NonEmptyString }));

const decodeSessionAnswer = Schema.decodeUnknownResult(SessionAnswerSchema);
const decodeRedirectAnswer = Schema.decodeUnknownResult(RedirectAnswerSchema);

type CallRequest = Parameters<AccountCallEffects["send"]>[0];
type CallAnswer = Effect.Success<ReturnType<AccountCallEffects["send"]>>;

const SIGNED_OUT: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };

export interface CookieSessionDoor {
  readonly currentAddress: () => string;
  readonly navigate: (url: string, signingIn: boolean) => Effect.Effect<void>;
  readonly returnedFromSignIn: Effect.Effect<boolean>;
  readonly revisits: Stream.Stream<void>;
}

export class CookieSessionFailed extends Data.TaggedError("CookieSessionFailed")<{
  readonly message: string;
}> {}

class SessionUnreadable extends Data.TaggedError("SessionUnreadable") {}

class ReadSuperseded extends Data.TaggedError("ReadSuperseded") {}

type SessionRead =
  | { readonly signedIn: true; readonly account: AccountSnapshot }
  | { readonly signedIn: false };

function accountOf(
  user: {
    readonly id: string;
    readonly email: string;
    readonly name?: string | null;
    readonly image?: string | null;
    readonly lastLoginMethod?: string | null;
  },
  impersonated: boolean,
): SessionRead {
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
      ...(impersonated ? { impersonated: true } : undefined),
    },
  };
}

function signedInId(snapshot: AccountSnapshot): string | undefined {
  return snapshot.status === ACCOUNT_STATUS.SIGNED_IN ? snapshot.id : undefined;
}

function sameAccount(left: AccountSnapshot, right: AccountSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

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

const openCookieSession = Effect.fnUntraced(function* (
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
  let generation = 0;
  let departedAt: number | undefined;
  let arrival: { readonly asOf: number; readonly shown: Deferred.Deferred<void> } | undefined;
  let closed = false;
  const sessionScope = yield* Effect.scope;
  yield* Effect.addFinalizer(() =>
    Effect.suspend(() => {
      closed = true;
      return arrival ? Deferred.succeed(arrival.shown, undefined) : Effect.void;
    }),
  );
  const gateMoves = yield* Semaphore.make(1);

  const send = (call: AccountCallEffects, request: CallRequest): Effect.Effect<CallAnswer> =>
    Effect.provideService(call.send(request), HttpClient.HttpClient, client);

  const failed = (what: string, answer: CallAnswer) =>
    new CookieSessionFailed({
      message: callAnswered(answer)
        ? `${what}: the service answered ${answer.response.status}`
        : `${what}: ${answer.errorName ?? answer.fault}`,
    });

  const moveGate = (move: Effect.Effect<void>): Effect.Effect<void> =>
    gateMoves.withPermits(1)(Effect.suspend(() => (closed ? Effect.void : move)));

  const closings = new Set<Deferred.Deferred<void>>();

  const depart: Effect.Effect<Deferred.Deferred<void>> = Effect.map(
    Deferred.make<void>(),
    (closing) => {
      generation += 1;
      closings.add(closing);
      return closing;
    },
  );

  const close = (closing: Deferred.Deferred<void>): Effect.Effect<void> =>
    Effect.ensuring(
      moveGate(host.stopCapabilities),
      Effect.suspend(() => {
        closings.delete(closing);
        return Deferred.succeed(closing, undefined);
      }),
    );

  const settingsStep = (step: Effect.Effect<unknown, Error>, what: string): Effect.Effect<void> =>
    Effect.catch(Effect.asVoid(step), (error) =>
      Effect.sync(() => {
        report(`${what} failed: ${error.message}`);
      }),
    );

  const forgetDeparted = settingsStep(
    host.store.clearAccount(),
    "Dropping the departed account's settings",
  );

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

  const settleOnAsOf = (asOf: number, next: AccountSnapshot): Effect.Effect<void> =>
    Effect.suspend(() => (asOf === generation && !closed ? settleOn(next) : Effect.void));

  const arrive = (
    asOf: number,
    arriving: AccountSnapshot,
    afterSomeone: boolean,
    shown: Deferred.Deferred<void>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (afterSomeone) yield* host.stopCapabilities;
      if (asOf !== generation) return;
      yield* settleArrival(arriving);
      yield* settleOnAsOf(asOf, arriving);
      yield* Deferred.succeed(shown, undefined);
      if (asOf !== generation) return;
      yield* host.startCapabilities;
    });

  const settleNobody: Effect.Effect<void> = Effect.suspend(() => {
    if (account.status === ACCOUNT_STATUS.SIGNING_IN && departedAt !== generation) {
      return Effect.void;
    }
    generation += 1;
    return account.status === ACCOUNT_STATUS.SIGNING_IN ? settleOn(SIGNED_OUT) : Effect.void;
  });

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
      : accountOf(decoded.success.user, Boolean(decoded.success.session?.impersonatedBy));
  });

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
          const closing = yield* depart;
          const steps = yield* Effect.exit(Effect.andThen(settleOn(SIGNED_OUT), forgetDeparted));
          const moved = yield* Effect.forkIn(close(closing), sessionScope);
          yield* steps;
          return moved;
        }
        if (standing !== undefined && standing === signedInId(read.account)) {
          if (!sameAccount(account, read.account)) yield* settleOn(read.account);
          return undefined;
        }
        const asOf = ++generation;
        if (standing !== undefined) {
          yield* settleOn(SIGNED_OUT);
          yield* forgetDeparted;
        }
        const shown = yield* Deferred.make<void>();
        arrival = { asOf, shown };
        const departures = [...closings];
        return yield* Effect.forkIn(
          Effect.ensuring(
            Effect.andThen(
              Effect.forEach(departures, Deferred.await, { discard: true }),
              moveGate(arrive(asOf, read.account, standing !== undefined, shown)),
            ),
            Deferred.succeed(shown, undefined),
          ),
          sessionScope,
        );
      }),
    );
  });

  const joinRead = yield* Effect.cachedWithTTL(settleRead, Duration.zero);
  const reread = Effect.retry(joinRead, {
    while: (error) => error._tag === "ReadSuperseded",
  });

  const arrivalSettled: Effect.Effect<void> = Effect.suspend(() =>
    arrival?.asOf === generation ? Deferred.await(arrival.shown) : Effect.void,
  );

  const confirmAccount = (): Effect.Effect<void> =>
    Effect.andThen(Effect.ignore(reread), arrivalSettled);

  const token: AccountToken = {
    readAccessToken: () => Effect.succeed(undefined),
    refreshAccount: () => Effect.ignore(reread),
    readAccountKey: () =>
      Effect.sync(() => (account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined)),
  };

  const signedInCredential: CallCredential = {
    renew: token.refreshAccount,
    holder: () => Effect.sync(() => signedInId(account)),
  };
  const signedOutCredential: CallCredential = {
    authorization: () => Effect.succeed(undefined),
    renew: token.refreshAccount,
    holder: () => Effect.succeed(undefined),
  };
  const credential: CallCredential = {
    resolve: () =>
      Effect.sync(() =>
        signedInId(account) === undefined ? signedOutCredential : signedInCredential,
      ),
  };

  const leave: Effect.Effect<void> = Effect.uninterruptible(
    Effect.gen(function* () {
      const closing = yield* depart;
      yield* Effect.ensuring(Effect.andThen(settleOn(SIGNED_OUT), forgetDeparted), close(closing));
    }),
  );

  const leaveFor = (path: string, provider: AccountProvider, signingIn: boolean) =>
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
      if (asked !== generation) return false;
      yield* door.navigate(redirect.success.url, signingIn);
      return true;
    });

  const beginSignIn = (provider: AccountProvider) =>
    Effect.gen(function* () {
      if (account.status !== ACCOUNT_STATUS.SIGNED_OUT) return account;
      generation += 1;
      const started = generation;
      yield* settleOn({ status: ACCOUNT_STATUS.SIGNING_IN });
      const left = yield* Effect.result(leaveFor(AUTH_PATH.SIGN_IN_SOCIAL, provider, true));
      if (Result.isFailure(left)) {
        if (started === generation) yield* settleOn(SIGNED_OUT);
        return yield* Effect.fail(left.failure);
      }
      if (left.success) departedAt = generation;
      return account;
    });

  const settled = (read: typeof reread): Effect.Effect<void> =>
    read.pipe(
      Effect.flatMap((moved) => (moved === undefined ? Effect.void : Fiber.await(moved))),
      Effect.ignore,
    );

  const refreshOnce = (): Effect.Effect<void> =>
    settled(
      Effect.retry(reread, {
        schedule: Schedule.exponential(LAUNCH_REREAD.FIRST),
        times: LAUNCH_REREAD.TIMES,
      }),
    );

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
      if (asked === generation) {
        yield* settleArrival(initial);
        account = initial;
      } else {
        yield* arrivalSettled;
      }
      yield* Deferred.succeed(initialized, undefined);
      return account;
    }),
    returnedFromSignIn: door.returnedFromSignIn,
    beginSignIn,
    signInAgain: (provider) =>
      account.status === ACCOUNT_STATUS.SIGNED_IN
        ? Effect.as(leaveFor(AUTH_PATH.LINK_SOCIAL, provider, false), false)
        : Effect.as(beginSignIn(provider), false),
    cancelSignIn: () => {
      if (account.status !== ACCOUNT_STATUS.SIGNING_IN) return;
      generation += 1;
      account = SIGNED_OUT;
      PubSub.publishUnsafe(changesPubSub, account);
    },
    signOut: (options) =>
      Effect.gen(function* () {
        if (options.revokeRemote) {
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
        yield* leave;
        return account;
      }),
    refreshOnce,
    confirmAccount,
    token,
    credential,
    sessionCredential: credential,
  };
});
