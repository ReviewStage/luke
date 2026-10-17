import { desktopSessionPageUrl } from "@luke/features/desktop-session-wire";
import { singleFlightEffect } from "@luke/runtime/effect";
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  PubSub,
  Result,
  type Scope,
  Stream,
} from "effect";
import {
  LOOPBACK_CONSENT_CANCELLED,
  type LoopbackConsent,
  type LoopbackConsentOutcome,
  type LoopbackExchange,
  type OpenConsent,
} from "../consent.js";
import { LOOPBACK_CONNECTION_SOURCE, type LoopbackConnectionSource } from "../loopback-page.js";
import {
  ACCOUNT_FAILURE_ACTION,
  type AccountClient,
  type AccountClientFailure,
  type AccountIdentity,
  accessTokenNeedsRefresh,
  accountFailureAction,
  deleteHostedAccount,
  type StoredAccount,
  withIssuedAccountTokens,
} from "./client.js";
import { ACCOUNT_STATUS, type AccountProvider, type AccountSnapshot } from "./snapshot.js";

/** Why a sign-in again that landed on another account is refused. */
const OTHER_ACCOUNT = "That sign-in is a different Luke account.";

/** Why a session hand-off from a browser signed in as someone else is refused. */
const OTHER_BROWSER_ACCOUNT = "That browser is signed in to a different Luke account.";

/** The path the hosted authorize route sends the code back to. */
const CALLBACK_PATH = "/callback";

/** The path the hand-off page sends the session code back to. */
const SESSION_CALLBACK_PATH = "/session";

/**
 * The landing cards this sign-in leaves the browser on. Every string is fixed
 * by the build; nothing the redirect carried is ever interpolated.
 */
const SIGN_IN_PAGES = {
  granted: {
    badge: "Signed in",
    title: "Signed in to Luke",
    body: "You can close this tab and return to Luke.",
  },
  notGranted: {
    badge: "Not completed",
    title: "Sign-in was not completed",
    body: "Return to Luke and try again.",
  },
} as const;

/**
 * The landing cards the session hand-off leaves the browser on. A sign-in
 * that continues into the hand-off ends on these rather than on the
 * sign-in's own, so a hand-off that fails says the account is signed in
 * all the same.
 */
const SESSION_PAGES = {
  granted: SIGN_IN_PAGES.granted,
  notGranted: {
    badge: "Not completed",
    title: "Workspace access was not completed",
    body: "You're signed in to Luke. To manage a workspace's members, return to Luke and try again.",
  },
} as const;

/**
 * Whose mark the landing card carries. Only the two identity providers have
 * one; anything else draws Luke's own mark alone rather than a wrong badge.
 */
function connectionSource(provider: AccountProvider): LoopbackConnectionSource | undefined {
  if (provider === LOOPBACK_CONNECTION_SOURCE.GOOGLE) return LOOPBACK_CONNECTION_SOURCE.GOOGLE;
  if (provider === LOOPBACK_CONNECTION_SOURCE.GITHUB) return LOOPBACK_CONNECTION_SOURCE.GITHUB;
  return undefined;
}

interface AccountSessionStore {
  readAccount(): Effect.Effect<StoredAccount | undefined>;
  setAccount(account: StoredAccount): Effect.Effect<AccountSnapshot>;
  clearAccount(): Effect.Effect<AccountSnapshot>;
}

/** A sign-in the developer withdrew, or a later attempt took the generation from: an ordinary end, never reported. */
class SignInCancelled extends Data.TaggedError("SignInCancelled") {}

/** A sign-in that could not be completed, worded as the consent's own reason; the panel reports it. */
export class SignInFailed extends Data.TaggedError("SignInFailed")<{
  readonly message: string;
}> {}

/** A deletion asked for with no stored credential to make it under. */
export class NoStoredAccount extends Data.TaggedError("NoStoredAccount")<{
  readonly message: string;
}> {}

/**
 * A step of the sign-out whose failure is written down and never held against
 * the sign-out itself: an account that could not tell the service it was
 * leaving still leaves this machine.
 */
function reportingFailure<A, E>(
  effect: Effect.Effect<A, E>,
  what: string,
  report: (line: string) => void,
): Effect.Effect<void> {
  return Effect.catchCause(effect, (cause) =>
    // An interruption is not a failure of the step and is never written down
    // as one: it is the caller ending this fiber, and it stands.
    Cause.hasInterruptsOnly(cause)
      ? Effect.interrupt
      : Effect.sync(() => {
          report(`${what}: ${Cause.pretty(cause)}`);
        }),
  ).pipe(Effect.asVoid);
}

interface AccountSessionManagerOptions {
  client: AccountClient;
  store: AccountSessionStore;
  hostedServiceBaseUrl: string;
  requiresAccount: boolean;
  openExternal: (url: string) => Promise<void>;
  /**
   * Stands up each consent trip: the desktop's loopback
   * (`@luke/credentials/node`), handed in so this manager reaches no Node.
   */
  openConsent: OpenConsent;
  /** Where a step's failure that is never held against the sign-out is written down. */
  report: (line: string) => void;
  startCapabilities: Effect.Effect<void>;
  stopCapabilities: Effect.Effect<void>;
}

export class AccountSessionManager {
  /**
   * The manager as an effect that builds its own `PubSub`, since Effect gives
   * it no constructor that is not itself an effect: `compose-account.ts`
   * yields one per host lifetime rather than reaching for `new` outside a run.
   */
  static make(options: AccountSessionManagerOptions): Effect.Effect<AccountSessionManager> {
    return Effect.map(
      PubSub.unbounded<AccountSnapshot>(),
      (changesPubSub) => new AccountSessionManager(options, changesPubSub),
    );
  }

  readonly #options: AccountSessionManagerOptions;
  /** One refresh however many callers ask for it at once; every ask joins the flight already under way. */
  readonly refreshOnce: () => Effect.Effect<void>;
  /**
   * One refresh grant however many callers ask for it at once, `refresh`'s
   * own included. Note that two grants on one refresh token are a replay to
   * Better Auth, which answers the second by revoking every token the account
   * holds on this client, so no second flight may ever start beside this one.
   */
  readonly renewOnce: () => Effect.Effect<void>;
  readonly #changesPubSub: PubSub.PubSub<AccountSnapshot>;
  /**
   * Every snapshot this session settles on, in order, as the subscription a
   * subscriber's own fiber pumps rather than a callback this class runs: the
   * subscribe is the acquire (`PubSub.subscribe`, a scoped effect) and the
   * subscriber's scope closing is the release, so nothing here holds a
   * handle to give back.
   */
  readonly changes: Effect.Effect<Stream.Stream<AccountSnapshot>, never, Scope.Scope>;
  #account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
  #generation = 0;
  #signInRunning: Fiber.Fiber<AccountSnapshot, SignInFailed> | undefined;
  #againRunning:
    | { readonly provider: AccountProvider; readonly fiber: Fiber.Fiber<boolean, SignInFailed> }
    | undefined;
  #cancelSignIn: (() => void) | undefined;
  #sessionRunning: Fiber.Fiber<LoopbackConsentOutcome<AccountSnapshot>> | undefined;
  #cancelSession: (() => void) | undefined;
  /** The sign-out a refused renewal started, which `refresh` and a sign-in wait on and no renewal does. */
  #signingOut: Fiber.Fiber<AccountSnapshot> | undefined;
  /** How many cancels were pressed while a sign-in waited on `#signingOut`. */
  #waitCancels = 0;

  private constructor(
    options: AccountSessionManagerOptions,
    changesPubSub: PubSub.PubSub<AccountSnapshot>,
  ) {
    this.#options = options;
    this.#changesPubSub = changesPubSub;
    this.changes = PubSub.subscribe(this.#changesPubSub).pipe(Effect.map(Stream.fromSubscription));
    this.refreshOnce = singleFlightEffect(() => this.refresh());
    this.renewOnce = singleFlightEffect(() => this.#renew());
  }

  #publishChange(): Effect.Effect<void> {
    return PubSub.publish(this.#changesPubSub, this.#account).pipe(Effect.asVoid);
  }

  get snapshot(): AccountSnapshot {
    return this.#account;
  }

  initialize(account: AccountSnapshot): void {
    this.#account = account;
  }

  cancelSignIn(): void {
    this.#cancelSignIn?.();
  }

  signOut(options: { revokeRemote?: boolean } = {}): Effect.Effect<AccountSnapshot> {
    return Effect.gen({ self: this }, function* () {
      // Everything up to the cleared account is one uninterruptible step, as
      // the promise it replaces was by construction: the departure is reported
      // before the credential is cleared and the cadences are disarmed, so a
      // fiber cut between them — a Gateway request whose connection closed, a
      // quit — would leave a panel saying signed out over a credential still
      // on disk and loops still running. The revocation after it is the
      // remote's own business and may be cut like any other call.
      const stored = yield* Effect.uninterruptible(this.#clearAccount());
      if (options.revokeRemote && stored?.refreshToken) {
        yield* reportingFailure(
          this.#options.client.revoke(stored.refreshToken),
          "Account token revocation failed",
          this.#options.report,
        );
      }
      if (options.revokeRemote && stored?.sessionToken) {
        yield* reportingFailure(
          this.#options.client.endSession(stored.sessionToken),
          "Account session sign-out failed",
          this.#options.report,
        );
      }
      return this.#account;
    });
  }

  /** The departure as this machine keeps it, answering the account that left. */
  #clearAccount(): Effect.Effect<StoredAccount | undefined> {
    return Effect.gen({ self: this }, function* () {
      this.#generation += 1;
      this.#cancelSession?.();
      this.#account = { status: ACCOUNT_STATUS.SIGNED_OUT };
      yield* this.#publishChange();
      const stored = yield* this.#options.store.readAccount();
      // The clearing and the capability stop run together rather than in a
      // fixed order: what the sign-out guarantees is that both have settled
      // before the account it reports is the cleared one.
      const [cleared] = yield* Effect.all(
        [this.#options.store.clearAccount(), this.#options.stopCapabilities],
        { concurrency: 2 },
      );
      this.#account = cleared;
      yield* this.#publishChange();
      return stored;
    });
  }

  deleteEverywhere(): Effect.Effect<AccountSnapshot, NoStoredAccount | AccountClientFailure> {
    return Effect.gen({ self: this }, function* () {
      const stored = yield* this.#options.store.readAccount();
      if (!stored) {
        return yield* Effect.fail(
          new NoStoredAccount({ message: "No stored account credential to delete with" }),
        );
      }
      const deleted = yield* Effect.result(this.#deleteHosted(stored.accessToken));
      if (Result.isFailure(deleted)) {
        if (!accessTokenNeedsRefresh(deleted.failure)) return yield* Effect.fail(deleted.failure);
        const generation = this.#generation;
        const tokens = yield* this.#options.client.refresh(stored.refreshToken);
        yield* this.#storeCurrent(generation, { ...stored, ...tokens });
        yield* this.#deleteHosted(tokens.accessToken);
      }
      return yield* this.signOut();
    });
  }

  refresh(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const stored = yield* this.#options.store.readAccount();
      if (!stored || !this.#options.requiresAccount) return;
      const generation = this.#generation;
      const identity = yield* Effect.result(
        this.#options.client.userInfo(stored.accessToken, stored.provider),
      );
      if (Result.isSuccess(identity)) {
        if (sameIdentity(stored, identity.success)) return;
        if (!(yield* this.#storeCurrent(generation, mergedIdentity(stored, identity.success))))
          return;
        yield* this.#publishChange();
        return;
      }
      if (!accessTokenNeedsRefresh(identity.failure)) return;
      yield* this.renewOnce();
      // Note that the launch's refresh holds nothing a teardown needs, so it
      // alone waits for the sign-out a refused renewal started.
      if (this.#signingOut) yield* Fiber.await(this.#signingOut);
    });
  }

  /**
   * The refresh grant, for a caller whose token the service already refused
   * (RFC 6749 section 1.5). The refusal is the verdict, so no userinfo read
   * comes first: Better Auth answers a token it no longer holds with 400
   * `invalid_request` rather than a 401, and a read taking that as a token
   * still good would leave a dead one standing on every call after it.
   *
   * A refusal that signs out starts the sign-out and does not wait on it,
   * because a renewal's caller may hold a lock the sign-out's capability stop
   * needs: the Plans read holds the tasks lock while it waits here, and
   * `tasks.reset` waits on that lock, so waiting would deadlock both.
   */
  #renew(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const stored = yield* this.#options.store.readAccount();
      if (!stored || !this.#options.requiresAccount) return;
      const generation = this.#generation;
      const renewed = yield* Effect.result(this.#options.client.refresh(stored.refreshToken));
      if (Result.isFailure(renewed)) {
        if (
          accountFailureAction(renewed.failure) === ACCOUNT_FAILURE_ACTION.SIGN_OUT &&
          this.#isCurrent(generation)
        ) {
          this.#signingOut = yield* Effect.forkDetach(this.signOut());
        }
        return;
      }
      const tokens = renewed.success;
      // The renewed tokens are already stored by the time the identity read
      // below is made, so a read that fails leaves the account signed in on
      // them rather than undoing the renewal; it is written down, not held.
      yield* reportingFailure(
        Effect.gen({ self: this }, function* () {
          if (!(yield* this.#storeCurrent(generation, { ...stored, ...tokens }))) return;
          const next = yield* this.#options.client.userInfo(tokens.accessToken, stored.provider);
          const merged = mergedIdentity({ ...stored, ...tokens }, next);
          if (!(yield* this.#storeCurrent(generation, merged))) return;
          yield* this.#publishChange();
        }),
        "Renewed account identity read failed",
        this.#options.report,
      );
    });
  }

  /**
   * The one trip, as the fiber every concurrent ask joins. The trip is forked
   * rather than run in the asking fiber, so an ask that is itself interrupted
   * — a Gateway request whose connection closed — leaves the consent standing
   * for the developer's own press rather than ending it, exactly as the held
   * promise it replaces did.
   */
  beginSignIn(provider: AccountProvider): Effect.Effect<AccountSnapshot, SignInFailed> {
    // The decision, the fork, and the store of the fiber are one
    // uninterruptible step, the same guarantee `singleFlightEffect`'s own
    // semaphore states: a second ask landing between them would start a second
    // trip, and an interruption between them would leave the account signing
    // in with no fiber behind it and a cancel that does nothing. Only the join
    // is interruptible, and an ask interrupted there leaves the consent
    // standing for the developer's own press, exactly as the held promise did.
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* () {
        // Note that a sign-out a refused renewal started is let finish first,
        // because its capability stop and cleared account would otherwise
        // land over the session this sign-in starts.
        if (this.#signingOut) {
          // A cancel pressed during the wait withdraws every press waiting,
          // and still reaches a consent already standing, a sign-in again's.
          const cancels = this.#waitCancels;
          const standing = this.#cancelSignIn;
          const cancel = () => {
            this.#waitCancels += 1;
            standing?.();
          };
          this.#cancelSignIn = cancel;
          yield* restore(Fiber.await(this.#signingOut));
          if (this.#cancelSignIn === cancel) this.#cancelSignIn = standing;
          if (this.#waitCancels !== cancels) return this.#account;
        }
        if (this.#account.status === ACCOUNT_STATUS.SIGNED_IN) return this.#account;
        if (this.#signInRunning) return yield* restore(Fiber.join(this.#signInRunning));
        this.#account = { status: ACCOUNT_STATUS.SIGNING_IN };
        const generation = ++this.#generation;
        yield* this.#publishChange();
        const consent = this.#consent(provider, generation);
        const cancel = () => consent.cancel();
        this.#cancelSignIn = cancel;
        const fiber = yield* Effect.forkDetach(this.#trip(consent, generation, cancel));
        this.#signInRunning = fiber;
        return yield* restore(Fiber.join(fiber));
      }),
    );
  }

  /**
   * The trip taken again over a session that stands, for a grant only a new
   * sign-in renews: GitHub's, which the service reads repositories with. The
   * standing session is kept until the new one lands, so a withdrawn or failed
   * trip leaves the developer signed in as before, and a trip that lands on
   * another account is refused, its tokens revoked, rather than swapping the
   * person under the window. Answers whether a new session landed through the
   * provider asked for, so an ask for another provider while one runs
   * answers no rather than joining it; over no session it is the ordinary
   * sign-in.
   */
  signInAgain(provider: AccountProvider): Effect.Effect<boolean, SignInFailed> {
    // The same one uninterruptible decide-fork-store as `beginSignIn`'s.
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* () {
        if (this.#account.status !== ACCOUNT_STATUS.SIGNED_IN) {
          const account = yield* restore(this.beginSignIn(provider));
          return account.status === ACCOUNT_STATUS.SIGNED_IN;
        }
        const running = this.#againRunning;
        if (running !== undefined) {
          if (running.provider !== provider) return false;
          return yield* restore(Fiber.join(running.fiber));
        }
        const consent = this.#consent(provider, this.#generation, { again: true });
        const cancel = () => consent.cancel();
        this.#cancelSignIn = cancel;
        const fiber = yield* Effect.forkDetach(this.#tripAgain(consent, cancel));
        this.#againRunning = { provider, fiber };
        return yield* restore(Fiber.join(fiber));
      }),
    );
  }

  #tripAgain(
    consent: LoopbackConsent<AccountSnapshot>,
    cancel: () => void,
  ): Effect.Effect<boolean, SignInFailed> {
    return Effect.gen(function* () {
      const outcome = yield* Effect.scoped(consent.signInEffect());
      if (!("reason" in outcome)) return true;
      if (outcome.reason === LOOPBACK_CONSENT_CANCELLED) return false;
      return yield* Effect.fail(new SignInFailed({ message: outcome.reason }));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#dropCancel(cancel);
          this.#againRunning = undefined;
        }),
      ),
    );
  }

  /** Lets a trip's cancel go, unless a later trip's now stands in its place. */
  #dropCancel(cancel: () => void): void {
    if (this.#cancelSignIn === cancel) this.#cancelSignIn = undefined;
  }

  #trip(
    consent: LoopbackConsent<AccountSnapshot>,
    generation: number,
    cancel: () => void,
  ): Effect.Effect<AccountSnapshot, SignInFailed> {
    return Effect.gen({ self: this }, function* () {
      const outcome = yield* Effect.scoped(consent.signInEffect());
      if (!("reason" in outcome)) {
        yield* this.#publishChange();
        return this.#account;
      }
      if (this.#isCurrent(generation)) yield* this.signOut();
      // A withdrawn sign-in — the developer's own press, or a later attempt
      // taking the generation out from under this one — is an ordinary end.
      // Anything else is a failure the panel has to be able to report.
      if (outcome.reason === LOOPBACK_CONSENT_CANCELLED) return this.#account;
      return yield* Effect.fail(new SignInFailed({ message: outcome.reason }));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#dropCancel(cancel);
          this.#signInRunning = undefined;
        }),
      ),
    );
  }

  /**
   * A session of the Mac's own asked for apart from a sign-in: for an
   * account signed in before the Mac held one, or one whose session the
   * service no longer takes. Opens the hand-off page in the browser, which
   * signs a signed-out browser in first, and answers whether a session
   * landed; an ask while one is under way joins it.
   */
  obtainSession(): Effect.Effect<boolean, SignInFailed> {
    // The same one uninterruptible decide-fork-store as `beginSignIn`'s.
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* () {
        if (this.#account.status !== ACCOUNT_STATUS.SIGNED_IN) return false;
        const fiber =
          this.#sessionRunning ??
          (yield* this.#startSession(this.#generation, (url) => this.#options.openExternal(url)));
        const outcome = yield* restore(Fiber.join(fiber));
        if (!("reason" in outcome)) return true;
        if (outcome.reason === LOOPBACK_CONSENT_CANCELLED) return false;
        return yield* Effect.fail(new SignInFailed({ message: outcome.reason }));
      }),
    );
  }

  /**
   * Where a sign-in sends the browser once its tokens are stored: on to the
   * hand-off page, through a session trip whose page is handed to the
   * sign-in's own redirect rather than opened in a tab of its own, so the
   * whole sign-in is one trip through the browser. An account that already
   * holds a session, a trip already under way, and a trip that could not
   * listen all answer nothing, and the sign-in ends on its own card.
   */
  #continueToSession(): Effect.Effect<string | undefined> {
    return Effect.gen({ self: this }, function* () {
      const stored = yield* this.#options.store.readAccount();
      if (!stored || stored.sessionToken !== undefined || this.#sessionRunning) return undefined;
      const page = yield* Deferred.make<string | undefined>();
      const settle = (url: string | undefined) => {
        Deferred.doneUnsafe(page, Exit.succeed(url));
      };
      yield* this.#startSession(this.#generation, settle, () => settle(undefined));
      return yield* Deferred.await(page);
    });
  }

  /** Forks one session trip under the generation it was asked in, and holds it until it ends. */
  #startSession(
    generation: number,
    openExternal: (url: string) => void | Promise<void>,
    onEnd?: () => void,
  ): Effect.Effect<Fiber.Fiber<LoopbackConsentOutcome<AccountSnapshot>>> {
    return Effect.gen({ self: this }, function* () {
      const consent = this.#sessionConsent(generation, openExternal);
      const cancel = () => consent.cancel();
      this.#cancelSession = cancel;
      const fiber = yield* Effect.forkDetach(
        Effect.scoped(consent.signInEffect()).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (this.#cancelSession === cancel) {
                this.#cancelSession = undefined;
                this.#sessionRunning = undefined;
              }
              onEnd?.();
            }),
          ),
        ),
      );
      this.#sessionRunning = fiber;
      return fiber;
    });
  }

  #sessionConsent(
    generation: number,
    openExternal: (url: string) => void | Promise<void>,
  ): LoopbackConsent<AccountSnapshot> {
    return this.#options.openConsent<AccountSnapshot>({
      callbackPath: SESSION_CALLBACK_PATH,
      pages: SESSION_PAGES,
      reasons: {
        refused: "Workspace access was not completed.",
        timedOut: "Workspace access timed out.",
      },
      authorizationUrl: ({ state, redirectUri, codeChallenge }) =>
        desktopSessionPageUrl(this.#options.hostedServiceBaseUrl, {
          state,
          codeChallenge,
          returnTo: redirectUri,
        }),
      exchange: (input) => this.#exchangeSession(generation, input),
      openExternal,
    });
  }

  /**
   * Trades the hand-off's code for the Mac's session and keeps it beside the
   * tokens. A session for anyone but the stored account is refused, since a
   * browser signed in as someone else hands that someone's session over; an
   * account stored before it named an id is matched by address and takes the
   * session's id with it. A session nobody keeps — refused, or landed after a sign-out — is ended
   * on the service rather than left live.
   */
  #exchangeSession(
    generation: number,
    input: LoopbackExchange,
  ): Effect.Effect<LoopbackConsentOutcome<AccountSnapshot>> {
    return Effect.gen({ self: this }, function* () {
      const session = yield* this.#options.client.exchangeSessionCode({
        code: input.code,
        state: input.state,
        codeVerifier: input.codeVerifier,
      });
      const stored = yield* this.#options.store.readAccount();
      const ours =
        stored !== undefined &&
        sameAccount(stored, {
          id: session.userId,
          email: session.email,
          provider: stored.provider,
        });
      const kept =
        stored !== undefined &&
        ours &&
        (yield* this.#storeCurrent(generation, {
          ...stored,
          id: session.userId,
          sessionToken: session.sessionToken,
        }));
      if (kept) return this.#account;
      yield* reportingFailure(
        this.#options.client.endSession(session.sessionToken),
        "Refused account session sign-out failed",
        this.#options.report,
      );
      return { reason: ours ? LOOPBACK_CONSENT_CANCELLED : OTHER_BROWSER_ACCOUNT };
    }).pipe(Effect.catch((error) => Effect.succeed({ reason: error.message })));
  }

  #consent(
    provider: AccountProvider,
    generation: number,
    options: { again: boolean } = { again: false },
  ): LoopbackConsent<AccountSnapshot> {
    return this.#options.openConsent<AccountSnapshot>({
      callbackPath: CALLBACK_PATH,
      // The hosted authorize route reads which provider was chosen back off
      // the state it issued, so the choice rides in front of the entropy.
      statePrefix: provider,
      source: connectionSource(provider),
      pages: SIGN_IN_PAGES,
      reasons: {
        refused: "Sign-in was not completed.",
        timedOut: "Sign-in timed out.",
      },
      authorizationUrl: ({ state, redirectUri, codeChallenge }) =>
        this.#options.client.authorizeUrl({
          redirectUri,
          state,
          codeChallenge,
        }),
      exchange: (input) => this.#exchange(provider, generation, input, options),
      continueTo: () => this.#continueToSession(),
      openExternal: (url) => this.#options.openExternal(url),
    });
  }

  /**
   * Trades the code for tokens and stands the session up on them. Everything
   * the tokens are for happens inside the issue-and-use guard, so a sign-in
   * that cannot be completed revokes what it was just issued rather than
   * leaving a live refresh token nobody holds.
   */
  #exchange(
    provider: AccountProvider,
    generation: number,
    input: LoopbackExchange,
    options: { again: boolean },
  ): Effect.Effect<LoopbackConsentOutcome<AccountSnapshot>> {
    return withIssuedAccountTokens({
      issue: this.#options.client.exchangeCode({
        code: input.code,
        codeVerifier: input.codeVerifier,
        redirectUri: input.redirectUri,
      }),
      use: (tokens) =>
        Effect.gen({ self: this }, function* () {
          const identity = yield* this.#options.client.userInfo(tokens.accessToken, provider);
          const replaced = options.again ? yield* this.#options.store.readAccount() : undefined;
          if (!this.#isCurrent(generation)) return yield* Effect.fail(new SignInCancelled());
          if (replaced !== undefined && !sameAccount(replaced, identity)) {
            return yield* Effect.fail(new SignInFailed({ message: OTHER_ACCOUNT }));
          }
          // Note that a sign-in again takes the generation from the session it
          // replaces, so a refresh of the old one still out stores nothing over it.
          const current = options.again ? ++this.#generation : generation;
          // The same person's session outlives a sign-in again, which renews
          // only the OAuth grant.
          const session = replaced?.sessionToken ? { sessionToken: replaced.sessionToken } : {};
          if (!(yield* this.#storeCurrent(current, { ...tokens, ...identity, ...session }))) {
            return yield* Effect.fail(new SignInCancelled());
          }
          if (replaced?.refreshToken) {
            yield* reportingFailure(
              this.#options.client.revoke(replaced.refreshToken),
              "Replaced account token revocation failed",
              this.#options.report,
            );
          }
          yield* this.#options.startCapabilities;
          if (!this.#isCurrent(current)) return yield* Effect.fail(new SignInCancelled());
          return this.#account;
        }),
      revoke: (refreshToken) => this.#options.client.revoke(refreshToken),
      onRevokeFailure: (error) => {
        this.#options.report(`Rejected account token revocation failed: ${error.message}`);
      },
    }).pipe(
      Effect.catchTag("SignInCancelled", () =>
        Effect.succeed({ reason: LOOPBACK_CONSENT_CANCELLED }),
      ),
      Effect.catch((error) => Effect.succeed({ reason: error.message })),
    );
  }

  #storeCurrent(generation: number, stored: StoredAccount): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#isCurrent(generation)) return false;
      const next = yield* this.#options.store.setAccount(stored);
      if (!this.#isCurrent(generation)) return false;
      this.#account = next;
      yield* this.#publishChange();
      return true;
    });
  }

  #isCurrent(generation: number): boolean {
    return generation === this.#generation;
  }

  #deleteHosted(accessToken: string): Effect.Effect<void, AccountClientFailure> {
    return deleteHostedAccount({
      serviceBaseUrl: this.#options.hostedServiceBaseUrl,
      accessToken,
    });
  }
}

/** Whether an identity is the stored account's person: by the service's id where both carry one, else by email. */
function sameAccount(stored: StoredAccount, identity: AccountIdentity): boolean {
  return stored.id !== undefined && identity.id !== undefined
    ? stored.id === identity.id
    : stored.email === identity.email;
}

function sameIdentity(stored: StoredAccount, identity: AccountIdentity): boolean {
  return (
    identity.email === stored.email &&
    identity.name === stored.name &&
    identity.pictureUrl === stored.pictureUrl &&
    identity.provider === stored.provider
  );
}

function mergedIdentity(stored: StoredAccount, identity: AccountIdentity): StoredAccount {
  return {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    ...(stored.sessionToken ? { sessionToken: stored.sessionToken } : undefined),
    ...identity,
  };
}
