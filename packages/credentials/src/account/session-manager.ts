import { desktopSessionPageUrl } from "@repo/features/desktop-session-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { SIGN_IN_FAILURE, type SignInFailure } from "@repo/features/words";
import { singleFlightEffect } from "@repo/runtime/effect";
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
  LOOPBACK_CONSENT_CANCELED,
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

const OTHER_ACCOUNT = `That sign-in is a different ${PRODUCT_NAME} account.`;

const OTHER_BROWSER_ACCOUNT = `That browser is signed in to a different ${PRODUCT_NAME} account.`;

const CALLBACK_PATH = "/callback";

const SESSION_CALLBACK_PATH = "/session";

const SIGN_IN_PAGES = {
  granted: {
    badge: "Signed in",
    title: `Signed in to ${PRODUCT_NAME}`,
    body: `You can close this tab and return to ${PRODUCT_NAME}.`,
  },
  notGranted: {
    badge: "Not completed",
    title: "Sign-in was not completed",
    body: `Return to ${PRODUCT_NAME} and try again.`,
  },
} as const;

const SESSION_PAGES = {
  granted: SIGN_IN_PAGES.granted,
  notGranted: {
    badge: "Not completed",
    title: "Workspace access was not completed",
    body: `You're signed in to ${PRODUCT_NAME}. To manage a workspace's members, return to ${PRODUCT_NAME} and try again.`,
  },
} as const;

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

class SignInCanceled extends Data.TaggedError("SignInCanceled") {}

export class SignInFailed extends Data.TaggedError("SignInFailed")<{
  readonly failure: SignInFailure;
  readonly message: string;
}> {}

function signInFailed(outcome: {
  reason: string;
  failure?: SignInFailure | undefined;
}): SignInFailed {
  return new SignInFailed({
    failure: outcome.failure ?? SIGN_IN_FAILURE.UNFINISHED,
    message: outcome.reason,
  });
}

export class NoStoredAccount extends Data.TaggedError("NoStoredAccount")<{
  readonly message: string;
}> {}

function reportingFailure<A, E>(
  effect: Effect.Effect<A, E>,
  what: string,
  report: (line: string) => void,
): Effect.Effect<void> {
  return Effect.catchCause(effect, (cause) =>
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
  openConsent: OpenConsent;
  report: (line: string) => void;
  startCapabilities: Effect.Effect<void>;
  stopCapabilities: Effect.Effect<void>;
}

export class AccountSessionManager {
  static make(options: AccountSessionManagerOptions): Effect.Effect<AccountSessionManager> {
    return Effect.map(
      PubSub.unbounded<AccountSnapshot>(),
      (changesPubSub) => new AccountSessionManager(options, changesPubSub),
    );
  }

  readonly #options: AccountSessionManagerOptions;
  readonly refreshOnce: () => Effect.Effect<void>;
  readonly renewOnce: () => Effect.Effect<void>;
  readonly #changesPubSub: PubSub.PubSub<AccountSnapshot>;
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
  #signingOut: Fiber.Fiber<AccountSnapshot> | undefined;
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

  #clearAccount(): Effect.Effect<StoredAccount | undefined> {
    return Effect.gen({ self: this }, function* () {
      this.#generation += 1;
      this.#cancelSession?.();
      this.#account = { status: ACCOUNT_STATUS.SIGNED_OUT };
      yield* this.#publishChange();
      const stored = yield* this.#options.store.readAccount();
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
      if (this.#signingOut) yield* Fiber.await(this.#signingOut);
    });
  }

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

  beginSignIn(provider: AccountProvider): Effect.Effect<AccountSnapshot, SignInFailed> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* () {
        if (this.#signingOut) {
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

  signInAgain(provider: AccountProvider): Effect.Effect<boolean, SignInFailed> {
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
      if (outcome.reason === LOOPBACK_CONSENT_CANCELED) return false;
      return yield* Effect.fail(signInFailed(outcome));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#dropCancel(cancel);
          this.#againRunning = undefined;
        }),
      ),
    );
  }

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
      if (outcome.reason === LOOPBACK_CONSENT_CANCELED) return this.#account;
      return yield* Effect.fail(signInFailed(outcome));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#dropCancel(cancel);
          this.#signInRunning = undefined;
        }),
      ),
    );
  }

  obtainSession(): Effect.Effect<boolean, SignInFailed> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* () {
        if (this.#account.status !== ACCOUNT_STATUS.SIGNED_IN) return false;
        const fiber =
          this.#sessionRunning ??
          (yield* this.#startSession(this.#generation, (url) => this.#options.openExternal(url)));
        const outcome = yield* restore(Fiber.join(fiber));
        if (!("reason" in outcome)) return true;
        if (outcome.reason === LOOPBACK_CONSENT_CANCELED) return false;
        return yield* Effect.fail(signInFailed(outcome));
      }),
    );
  }

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
      return { reason: ours ? LOOPBACK_CONSENT_CANCELED : OTHER_BROWSER_ACCOUNT };
    }).pipe(Effect.catch((error) => Effect.succeed({ reason: error.message })));
  }

  #consent(
    provider: AccountProvider,
    generation: number,
    options: { again: boolean } = { again: false },
  ): LoopbackConsent<AccountSnapshot> {
    return this.#options.openConsent<AccountSnapshot>({
      callbackPath: CALLBACK_PATH,
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
          if (!this.#isCurrent(generation)) return yield* Effect.fail(new SignInCanceled());
          if (replaced !== undefined && !sameAccount(replaced, identity)) {
            return yield* Effect.fail(
              new SignInFailed({ failure: SIGN_IN_FAILURE.UNFINISHED, message: OTHER_ACCOUNT }),
            );
          }
          const current = options.again ? ++this.#generation : generation;
          const session = replaced?.sessionToken ? { sessionToken: replaced.sessionToken } : {};
          if (!(yield* this.#storeCurrent(current, { ...tokens, ...identity, ...session }))) {
            return yield* Effect.fail(new SignInCanceled());
          }
          if (replaced?.refreshToken) {
            yield* reportingFailure(
              this.#options.client.revoke(replaced.refreshToken),
              "Replaced account token revocation failed",
              this.#options.report,
            );
          }
          yield* this.#options.startCapabilities;
          if (!this.#isCurrent(current)) return yield* Effect.fail(new SignInCanceled());
          return this.#account;
        }),
      revoke: (refreshToken) => this.#options.client.revoke(refreshToken),
      onRevokeFailure: (error) => {
        this.#options.report(`Rejected account token revocation failed: ${error.message}`);
      },
    }).pipe(
      Effect.catchTag("SignInCanceled", () =>
        Effect.succeed({ reason: LOOPBACK_CONSENT_CANCELED }),
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

function sameAccount(stored: StoredAccount, identity: AccountIdentity): boolean {
  return stored.id !== undefined && identity.id !== undefined
    ? stored.id === identity.id
    : stored.email === identity.email;
}

function sameIdentity(stored: StoredAccount, identity: AccountIdentity): boolean {
  return (
    (identity.id === undefined || identity.id === stored.id) &&
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
