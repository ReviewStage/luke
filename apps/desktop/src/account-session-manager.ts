import { Effect } from "effect";
import type { AccountClient, AccountIdentity } from "./account-client";
import { deleteHostedAccount } from "./account-deletion";
import {
  ACCOUNT_FAILURE_ACTION,
  accessTokenNeedsRefresh,
  accountFailureAction,
} from "./account-gate";
import {
  isSignInCancellation,
  SIGN_IN_CANCELLED_MESSAGE,
  startAccountLoopback,
} from "./account-loopback";
import { singleFlight, withIssuedAccountTokens } from "./account-token-lifecycle";
import type { StoredAccount } from "./settings-store";
import { ACCOUNT_STATUS, type AccountProvider, type AccountSnapshot } from "./shared/contracts";

export interface AccountSessionStore {
  readAccount(): Promise<StoredAccount | undefined>;
  setAccount(account: StoredAccount): Promise<AccountSnapshot>;
  clearAccount(): Promise<AccountSnapshot>;
}

export interface AccountSessionManagerOptions {
  client: AccountClient;
  store: AccountSessionStore;
  hostedServiceBaseUrl: string;
  requiresAccount: boolean;
  openExternal: (url: string) => Promise<void>;
  startCapabilities: () => Promise<void>;
  stopCapabilities: () => Promise<void>;
  onChange: (account: AccountSnapshot) => void;
  runEffect: <A, E>(effect: Effect.Effect<A, E, unknown>) => Promise<A>;
}

export class AccountSessionManager {
  readonly #options: AccountSessionManagerOptions;
  readonly refreshOnce: () => Promise<void>;
  #account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
  #generation = 0;
  #signInRunning: Promise<AccountSnapshot> | undefined;
  #cancelSignIn: (() => void) | undefined;

  constructor(options: AccountSessionManagerOptions) {
    this.#options = options;
    const flight = singleFlight(() => this.#refreshEffect());
    this.refreshOnce = () => options.runEffect(flight());
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

  async signOut(options: { revokeRemote?: boolean } = {}): Promise<AccountSnapshot> {
    this.#generation += 1;
    this.#account = { status: ACCOUNT_STATUS.SIGNED_OUT };
    this.#options.onChange(this.#account);
    const stored = options.revokeRemote ? await this.#options.store.readAccount() : undefined;
    const clearing = this.#options.store.clearAccount();
    await this.#options.stopCapabilities();
    this.#account = await clearing;
    this.#options.onChange(this.#account);
    if (stored?.refreshToken) {
      await this.#options.runEffect(
        this.#options.client.revoke(stored.refreshToken).pipe(
          Effect.catchAll((error) => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Account token revocation failed: ${message}\n`);
            return Effect.void;
          }),
        ),
      );
    }
    return this.#account;
  }

  async deleteEverywhere(): Promise<AccountSnapshot> {
    const stored = await this.#options.store.readAccount();
    if (!stored) throw new Error("No stored account credential to delete with");
    try {
      await this.#options.runEffect(this.#deleteHosted(stored.accessToken));
    } catch (error) {
      if (!(error instanceof Error) || !accessTokenNeedsRefresh(error)) throw error;
      const generation = this.#generation;
      const tokens = await this.#options.runEffect(
        this.#options.client.refresh(stored.refreshToken),
      );
      await this.#storeCurrent(generation, { ...stored, ...tokens });
      await this.#options.runEffect(this.#deleteHosted(tokens.accessToken));
    }
    return this.signOut();
  }

  #refreshEffect(): Effect.Effect<void, unknown, unknown> {
    return Effect.gen(this, function* () {
      const stored = yield* Effect.promise(() => this.#options.store.readAccount());
      if (!stored || !this.#options.requiresAccount) return;
      const generation = this.#generation;
      const identity = yield* this.#options.client
        .userInfo(stored.accessToken, stored.provider)
        .pipe(Effect.either);
      if (identity._tag === "Right") {
        if (!sameIdentity(stored, identity.right)) {
          if (
            !(yield* Effect.promise(() =>
              this.#storeCurrent(generation, mergedIdentity(stored, identity.right)),
            ))
          ) {
            return;
          }
          this.#options.onChange(this.#account);
        }
        return;
      }
      const error = identity.left;
      if (!(error instanceof Error) || !accessTokenNeedsRefresh(error)) return;

      const refreshed = yield* this.#options.client
        .refresh(stored.refreshToken)
        .pipe(Effect.either);
      if (refreshed._tag === "Left") {
        const refreshError = refreshed.left;
        if (
          refreshError instanceof Error &&
          accountFailureAction(refreshError) === ACCOUNT_FAILURE_ACTION.SIGN_OUT &&
          this.#isCurrent(generation)
        ) {
          yield* Effect.promise(() => this.signOut());
        }
        return;
      }
      const tokens = refreshed.right;
      if (
        !(yield* Effect.promise(() => this.#storeCurrent(generation, { ...stored, ...tokens })))
      ) {
        return;
      }
      const verified = yield* this.#options.client
        .userInfo(tokens.accessToken, stored.provider)
        .pipe(Effect.either);
      if (verified._tag === "Left") return;
      if (
        !(yield* Effect.promise(() =>
          this.#storeCurrent(generation, mergedIdentity({ ...stored, ...tokens }, verified.right)),
        ))
      ) {
        return;
      }
      this.#options.onChange(this.#account);
    });
  }

  beginSignIn(provider: AccountProvider): Promise<AccountSnapshot> {
    if (this.#account.status === ACCOUNT_STATUS.SIGNED_IN) return Promise.resolve(this.#account);
    if (this.#signInRunning) return this.#signInRunning;
    this.#account = { status: ACCOUNT_STATUS.SIGNING_IN };
    const generation = ++this.#generation;
    this.#options.onChange(this.#account);
    let cancelled = false;
    this.#cancelSignIn = () => {
      cancelled = true;
    };
    this.#signInRunning = (async () => {
      let loopback: Awaited<ReturnType<typeof startAccountLoopback>> | undefined;
      try {
        const activeLoopback = await startAccountLoopback({ providerHint: provider });
        loopback = activeLoopback;
        this.#cancelSignIn = () => activeLoopback.cancel();
        if (cancelled) activeLoopback.cancel();
        await this.#options.openExternal(
          this.#options.client.authorizeUrl({
            redirectUri: activeLoopback.redirectUri,
            state: activeLoopback.state,
            codeChallenge: activeLoopback.codeChallenge,
          }),
        );
        const code = await activeLoopback.waitForCode;
        await this.#options.runEffect(
          withIssuedAccountTokens({
            issue: () =>
              this.#options.client.exchangeCode({
                code,
                codeVerifier: activeLoopback.codeVerifier,
                redirectUri: activeLoopback.redirectUri,
              }),
            use: (tokens) =>
              Effect.gen(this, function* () {
                const identity = yield* this.#options.client.userInfo(tokens.accessToken, provider);
                if (
                  !(yield* Effect.promise(() =>
                    this.#storeCurrent(generation, { ...tokens, ...identity }),
                  ))
                ) {
                  return yield* Effect.fail(new Error(SIGN_IN_CANCELLED_MESSAGE));
                }
                yield* Effect.promise(() => this.#options.startCapabilities());
                if (!this.#isCurrent(generation)) {
                  return yield* Effect.fail(new Error(SIGN_IN_CANCELLED_MESSAGE));
                }
              }),
            revoke: (refreshToken) => this.#options.client.revoke(refreshToken),
            onRevokeFailure: (error) => {
              const message = error instanceof Error ? error.message : String(error);
              process.stderr.write(`Rejected account token revocation failed: ${message}\n`);
            },
          }) as Effect.Effect<void, unknown, unknown>,
        );
        this.#options.onChange(this.#account);
        return this.#account;
      } catch (error) {
        if (this.#isCurrent(generation)) await this.signOut();
        if (error instanceof Error && isSignInCancellation(error)) return this.#account;
        throw error;
      } finally {
        this.#cancelSignIn = undefined;
        await loopback?.close();
        this.#signInRunning = undefined;
      }
    })();
    return this.#signInRunning;
  }

  async #storeCurrent(generation: number, stored: StoredAccount): Promise<boolean> {
    if (!this.#isCurrent(generation)) return false;
    const next = await this.#options.store.setAccount(stored);
    if (!this.#isCurrent(generation)) return false;
    this.#account = next;
    this.#options.onChange(this.#account);
    return true;
  }

  #isCurrent(generation: number): boolean {
    return generation === this.#generation;
  }

  #deleteHosted(accessToken: string): Effect.Effect<void, unknown, unknown> {
    return deleteHostedAccount({
      serviceBaseUrl: this.#options.hostedServiceBaseUrl,
      accessToken,
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
