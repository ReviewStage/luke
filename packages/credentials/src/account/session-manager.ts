import { Cause, Effect, Either, Fiber } from "effect";
import {
  LOOPBACK_CONSENT_CANCELLED,
  type LoopbackConsent,
  type LoopbackConsentOutcome,
  type LoopbackExchange,
  loopbackConsent,
} from "../loopback-consent.js";
import { LOOPBACK_CONNECTION_SOURCE, type LoopbackConnectionSource } from "../loopback-page.js";
import { singleFlightEffect } from "../single-flight.js";
import {
  ACCOUNT_FAILURE_ACTION,
  type AccountClient,
  type AccountIdentity,
  accessTokenNeedsRefresh,
  accountFailureAction,
  deleteHostedAccount,
  type StoredAccount,
  withIssuedAccountTokens,
} from "./client.js";
import { ACCOUNT_STATUS, type AccountProvider, type AccountSnapshot } from "./snapshot.js";

/** The path the hosted authorize route sends the code back to. */
const CALLBACK_PATH = "/callback";

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

/**
 * A rejected client call as the failure channel's own value. Everything that
 * reads one below — the renewal decision, the deletion's retry, the sentence
 * a row shows — reads an `Error`, so a rejection that carried something else
 * is worded here rather than carried on as an unknown.
 */
function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * A step of the sign-out whose failure is written down and never held against
 * the sign-out itself: an account that could not tell the service it was
 * leaving still leaves this machine.
 */
function reportingFailure<A, E>(effect: Effect.Effect<A, E>, what: string): Effect.Effect<void> {
  return Effect.catchAllCause(effect, (cause) =>
    // An interruption is not a failure of the step and is never written down
    // as one: it is the caller ending this fiber, and it stands.
    Cause.isInterruptedOnly(cause)
      ? Effect.interrupt
      : Effect.sync(() => {
          process.stderr.write(`${what}: ${asError(Cause.squash(cause)).message}\n`);
        }),
  ).pipe(Effect.asVoid);
}

export interface AccountSessionManagerOptions {
  client: AccountClient;
  store: AccountSessionStore;
  hostedServiceBaseUrl: string;
  requiresAccount: boolean;
  openExternal: (url: string) => Promise<void>;
  startCapabilities: Effect.Effect<void>;
  stopCapabilities: Effect.Effect<void>;
  /**
   * The last thing the departing account is used for, before its credential
   * is cleared: what the account signed this installation up for on the
   * service (its device row) is told to let go while the token still stands
   * to say so. A failure here never holds up the sign-out.
   */
  onSignOut?: (account: StoredAccount) => Effect.Effect<void, Error>;
  onChange: (account: AccountSnapshot) => void;
}

export class AccountSessionManager {
  readonly #options: AccountSessionManagerOptions;
  /** One refresh however many callers ask for it at once; every ask joins the flight already under way. */
  readonly refreshOnce: () => Effect.Effect<void, unknown>;
  #account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
  #generation = 0;
  #signInRunning: Fiber.RuntimeFiber<AccountSnapshot, Error> | undefined;
  #cancelSignIn: (() => void) | undefined;

  constructor(options: AccountSessionManagerOptions) {
    this.#options = options;
    this.refreshOnce = singleFlightEffect(() => this.refresh());
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
    return Effect.gen(this, function* () {
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
          Effect.tryPromise({
            try: () => this.#options.client.revoke(stored.refreshToken),
            catch: asError,
          }),
          "Account token revocation failed",
        );
      }
      return this.#account;
    });
  }

  /** The departure as this machine keeps it, answering the account that left. */
  #clearAccount(): Effect.Effect<StoredAccount | undefined> {
    return Effect.gen(this, function* () {
      this.#generation += 1;
      this.#account = { status: ACCOUNT_STATUS.SIGNED_OUT };
      this.#options.onChange(this.#account);
      const stored = yield* this.#options.store.readAccount();
      if (stored && this.#options.onSignOut) {
        yield* reportingFailure(this.#options.onSignOut(stored), "Account sign-out release failed");
      }
      // The clearing and the capability stop run together rather than in a
      // fixed order: what the sign-out guarantees is that both have settled
      // before the account it reports is the cleared one.
      const [cleared] = yield* Effect.all(
        [this.#options.store.clearAccount(), this.#options.stopCapabilities],
        { concurrency: 2 },
      );
      this.#account = cleared;
      this.#options.onChange(this.#account);
      return stored;
    });
  }

  deleteEverywhere(): Effect.Effect<AccountSnapshot, Error> {
    return Effect.gen(this, function* () {
      const stored = yield* this.#options.store.readAccount();
      if (!stored)
        return yield* Effect.fail(new Error("No stored account credential to delete with"));
      const deleted = yield* Effect.either(this.#deleteHosted(stored.accessToken));
      if (Either.isLeft(deleted)) {
        if (!accessTokenNeedsRefresh(deleted.left)) return yield* Effect.fail(deleted.left);
        const generation = this.#generation;
        const tokens = yield* Effect.tryPromise({
          try: () => this.#options.client.refresh(stored.refreshToken),
          catch: asError,
        });
        yield* this.#storeCurrent(generation, { ...stored, ...tokens });
        yield* this.#deleteHosted(tokens.accessToken);
      }
      return yield* this.signOut();
    });
  }

  refresh(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const stored = yield* this.#options.store.readAccount();
      if (!stored || !this.#options.requiresAccount) return;
      const generation = this.#generation;
      const identity = yield* Effect.either(
        Effect.tryPromise({
          try: () => this.#options.client.userInfo(stored.accessToken, stored.provider),
          catch: asError,
        }),
      );
      if (Either.isRight(identity)) {
        if (sameIdentity(stored, identity.right)) return;
        if (!(yield* this.#storeCurrent(generation, mergedIdentity(stored, identity.right))))
          return;
        this.#options.onChange(this.#account);
        return;
      }
      if (!accessTokenNeedsRefresh(identity.left)) return;
      const renewed = yield* Effect.either(
        Effect.tryPromise({
          try: () => this.#options.client.refresh(stored.refreshToken),
          catch: asError,
        }),
      );
      if (Either.isLeft(renewed)) {
        if (
          accountFailureAction(renewed.left) === ACCOUNT_FAILURE_ACTION.SIGN_OUT &&
          this.#isCurrent(generation)
        ) {
          yield* this.signOut();
        }
        return;
      }
      const tokens = renewed.right;
      // The renewed tokens are already stored by the time the identity read
      // below is made, so a read that fails leaves the account signed in on
      // them rather than undoing the renewal.
      yield* Effect.ignore(
        Effect.gen(this, function* () {
          if (!(yield* this.#storeCurrent(generation, { ...stored, ...tokens }))) return;
          const next = yield* Effect.tryPromise({
            try: () => this.#options.client.userInfo(tokens.accessToken, stored.provider),
            catch: asError,
          });
          const merged = mergedIdentity({ ...stored, ...tokens }, next);
          if (!(yield* this.#storeCurrent(generation, merged))) return;
          this.#options.onChange(this.#account);
        }),
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
  beginSignIn(provider: AccountProvider): Effect.Effect<AccountSnapshot, Error> {
    // The decision, the fork, and the store of the fiber are one
    // uninterruptible step, the same guarantee `singleFlightEffect`'s own
    // semaphore states: a second ask landing between them would start a second
    // trip, and an interruption between them would leave the account signing
    // in with no fiber behind it and a cancel that does nothing. Only the join
    // is interruptible, and an ask interrupted there leaves the consent
    // standing for the developer's own press, exactly as the held promise did.
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(this, function* () {
        if (this.#account.status === ACCOUNT_STATUS.SIGNED_IN) return this.#account;
        if (this.#signInRunning) return yield* restore(Fiber.join(this.#signInRunning));
        this.#account = { status: ACCOUNT_STATUS.SIGNING_IN };
        const generation = ++this.#generation;
        this.#options.onChange(this.#account);
        const consent = this.#consent(provider, generation);
        this.#cancelSignIn = () => consent.cancel();
        // `Effect.interruptible` because a fork inherits the mask above, and
        // the trip's own scope has to be able to close on the deadline and on
        // a withdrawal rather than run to its end whatever happens.
        const fiber = yield* Effect.forkDaemon(
          Effect.interruptible(this.#trip(consent, generation)),
        );
        this.#signInRunning = fiber;
        return yield* restore(Fiber.join(fiber));
      }),
    );
  }

  #trip(
    consent: LoopbackConsent<AccountSnapshot>,
    generation: number,
  ): Effect.Effect<AccountSnapshot, Error> {
    return Effect.gen(this, function* () {
      const outcome = yield* Effect.scoped(consent.signInEffect());
      if (!("reason" in outcome)) {
        this.#options.onChange(this.#account);
        return this.#account;
      }
      if (this.#isCurrent(generation)) yield* this.signOut();
      // A withdrawn sign-in — the developer's own press, or a later attempt
      // taking the generation out from under this one — is an ordinary end.
      // Anything else is a failure the panel has to be able to report.
      if (outcome.reason === LOOPBACK_CONSENT_CANCELLED) return this.#account;
      return yield* Effect.fail(new Error(outcome.reason));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#cancelSignIn = undefined;
          this.#signInRunning = undefined;
        }),
      ),
    );
  }

  #consent(provider: AccountProvider, generation: number): LoopbackConsent<AccountSnapshot> {
    return loopbackConsent<AccountSnapshot>({
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
        this.#options.client.authorizeUrl({ redirectUri, state, codeChallenge }),
      exchange: (input) => this.#exchange(provider, generation, input),
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
  ): Effect.Effect<LoopbackConsentOutcome<AccountSnapshot>> {
    return withIssuedAccountTokens({
      issue: Effect.tryPromise({
        try: () =>
          this.#options.client.exchangeCode({
            code: input.code,
            codeVerifier: input.codeVerifier,
            redirectUri: input.redirectUri,
          }),
        catch: asError,
      }),
      use: (tokens) =>
        Effect.gen(this, function* () {
          const identity = yield* Effect.tryPromise({
            try: () => this.#options.client.userInfo(tokens.accessToken, provider),
            catch: asError,
          });
          if (!(yield* this.#storeCurrent(generation, { ...tokens, ...identity }))) {
            return yield* Effect.fail(new Error(LOOPBACK_CONSENT_CANCELLED));
          }
          yield* this.#options.startCapabilities;
          if (!this.#isCurrent(generation)) {
            return yield* Effect.fail(new Error(LOOPBACK_CONSENT_CANCELLED));
          }
          return this.#account;
        }),
      revoke: (refreshToken) =>
        Effect.tryPromise({
          try: () => this.#options.client.revoke(refreshToken),
          catch: asError,
        }),
      onRevokeFailure: (error) => {
        process.stderr.write(`Rejected account token revocation failed: ${error.message}\n`);
      },
    }).pipe(Effect.catchAll((error) => Effect.succeed({ reason: error.message })));
  }

  #storeCurrent(generation: number, stored: StoredAccount): Effect.Effect<boolean> {
    return Effect.gen(this, function* () {
      if (!this.#isCurrent(generation)) return false;
      const next = yield* this.#options.store.setAccount(stored);
      if (!this.#isCurrent(generation)) return false;
      this.#account = next;
      this.#options.onChange(this.#account);
      return true;
    });
  }

  #isCurrent(generation: number): boolean {
    return generation === this.#generation;
  }

  #deleteHosted(accessToken: string): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: () =>
        deleteHostedAccount({
          serviceBaseUrl: this.#options.hostedServiceBaseUrl,
          accessToken,
        }),
      catch: asError,
    });
  }
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
  return { accessToken: stored.accessToken, refreshToken: stored.refreshToken, ...identity };
}
