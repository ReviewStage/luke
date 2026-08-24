import { singleFlight } from "@sidecar/oauth";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
} from "../../../apps/desktop/src/shared/contracts.js";
import type { AccountClient, AccountIdentity, AccountTokens, StoredAccount } from "./client.js";
import { deleteHostedAccount } from "./deletion.js";
import { ACCOUNT_FAILURE_ACTION, accessTokenNeedsRefresh, accountFailureAction } from "./gate.js";
import {
  isSignInCancellation,
  SIGN_IN_CANCELLED_MESSAGE,
  startAccountLoopback,
} from "./loopback.js";
import { withIssuedAccountTokens } from "./token-lifecycle.js";

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
}

/** The continue page's one button, worded for whose sign-in it opens. */
const CONTINUE_ACTION = {
  [ACCOUNT_PROVIDER.GOOGLE]: "Continue with Google",
  [ACCOUNT_PROVIDER.GITHUB]: "Continue with GitHub",
} satisfies Record<AccountProvider, string>;

export class AccountSessionManager {
  readonly #options: AccountSessionManagerOptions;
  readonly refreshOnce: () => Promise<void>;
  #account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
  #generation = 0;
  #signInRunning: Promise<AccountSnapshot> | undefined;
  #cancelSignIn: (() => void) | undefined;

  constructor(options: AccountSessionManagerOptions) {
    this.#options = options;
    this.refreshOnce = singleFlight(() => this.refresh());
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
      await this.#options.client.revoke(stored.refreshToken).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Account token revocation failed: ${message}\n`);
      });
    }
    return this.#account;
  }

  async deleteEverywhere(): Promise<AccountSnapshot> {
    const stored = await this.#options.store.readAccount();
    if (!stored) throw new Error("No stored account credential to delete with");
    try {
      await this.#deleteHosted(stored.accessToken);
    } catch (error) {
      if (!(error instanceof Error) || !accessTokenNeedsRefresh(error)) throw error;
      const generation = this.#generation;
      const tokens = await this.#options.client.refresh(stored.refreshToken);
      await this.#storeCurrent(generation, { ...stored, ...tokens });
      await this.#deleteHosted(tokens.accessToken);
    }
    return this.signOut();
  }

  async refresh(): Promise<void> {
    const stored = await this.#options.store.readAccount();
    if (!stored || !this.#options.requiresAccount) return;
    const generation = this.#generation;
    try {
      const identity = await this.#options.client.userInfo(stored.accessToken, stored.provider);
      if (!sameIdentity(stored, identity)) {
        if (!(await this.#storeCurrent(generation, mergedIdentity(stored, identity)))) return;
        this.#options.onChange(this.#account);
      }
      return;
    } catch (error) {
      if (!(error instanceof Error) || !accessTokenNeedsRefresh(error)) return;
    }
    let tokens: AccountTokens;
    try {
      tokens = await this.#options.client.refresh(stored.refreshToken);
    } catch (error) {
      if (
        error instanceof Error &&
        accountFailureAction(error) === ACCOUNT_FAILURE_ACTION.SIGN_OUT &&
        this.#isCurrent(generation)
      ) {
        await this.signOut();
      }
      return;
    }
    try {
      if (!(await this.#storeCurrent(generation, { ...stored, ...tokens }))) return;
      const identity = await this.#options.client.userInfo(tokens.accessToken, stored.provider);
      if (
        !(await this.#storeCurrent(generation, mergedIdentity({ ...stored, ...tokens }, identity)))
      ) {
        return;
      }
      this.#options.onChange(this.#account);
    } catch {}
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
          activeLoopback.serveContinue({
            authorizationUrl: this.#options.client.authorizeUrl({
              redirectUri: activeLoopback.redirectUri,
              state: activeLoopback.state,
              codeChallenge: activeLoopback.codeChallenge,
            }),
            action: CONTINUE_ACTION[provider],
          }),
        );
        const code = await activeLoopback.waitForCode;
        await withIssuedAccountTokens({
          issue: () =>
            this.#options.client.exchangeCode({
              code,
              codeVerifier: activeLoopback.codeVerifier,
              redirectUri: activeLoopback.redirectUri,
            }),
          use: async (tokens) => {
            const identity = await this.#options.client.userInfo(tokens.accessToken, provider);
            if (!(await this.#storeCurrent(generation, { ...tokens, ...identity }))) {
              throw new Error(SIGN_IN_CANCELLED_MESSAGE);
            }
            await this.#options.startCapabilities();
            if (!this.#isCurrent(generation)) throw new Error(SIGN_IN_CANCELLED_MESSAGE);
          },
          revoke: (refreshToken) => this.#options.client.revoke(refreshToken),
          onRevokeFailure: (error) => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Rejected account token revocation failed: ${message}\n`);
          },
        });
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

  #deleteHosted(accessToken: string): Promise<void> {
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
