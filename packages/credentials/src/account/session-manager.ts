import {
  LOOPBACK_CONSENT_CANCELLED,
  type LoopbackConsent,
  type LoopbackConsentOutcome,
  type LoopbackExchange,
  loopbackConsent,
} from "../loopback-consent.js";
import { LOOPBACK_CONNECTION_SOURCE, type LoopbackConnectionSource } from "../loopback-page.js";
import { singleFlight } from "../single-flight.js";
import {
  ACCOUNT_FAILURE_ACTION,
  type AccountClient,
  type AccountIdentity,
  type AccountTokens,
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
    const consent = this.#consent(provider, generation);
    this.#cancelSignIn = () => consent.cancel();
    this.#signInRunning = (async () => {
      try {
        const outcome = await consent.signIn();
        if (!("reason" in outcome)) {
          this.#options.onChange(this.#account);
          return this.#account;
        }
        if (this.#isCurrent(generation)) await this.signOut();
        // A withdrawn sign-in — the developer's own press, or a later attempt
        // taking the generation out from under this one — is an ordinary end.
        // Anything else is a failure the panel has to be able to report.
        if (outcome.reason === LOOPBACK_CONSENT_CANCELLED) return this.#account;
        throw new Error(outcome.reason);
      } finally {
        this.#cancelSignIn = undefined;
        this.#signInRunning = undefined;
      }
    })();
    return this.#signInRunning;
  }

  #consent(provider: AccountProvider, generation: number): LoopbackConsent<AccountSnapshot> {
    const source = connectionSource(provider);
    return loopbackConsent<AccountSnapshot>({
      callbackPath: CALLBACK_PATH,
      // The hosted authorize route reads which provider was chosen back off
      // the state it issued, so the choice rides in front of the entropy.
      statePrefix: provider,
      ...(source ? { source } : undefined),
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
  async #exchange(
    provider: AccountProvider,
    generation: number,
    input: LoopbackExchange,
  ): Promise<LoopbackConsentOutcome<AccountSnapshot>> {
    try {
      return await withIssuedAccountTokens({
        issue: () =>
          this.#options.client.exchangeCode({
            code: input.code,
            codeVerifier: input.codeVerifier,
            redirectUri: input.redirectUri,
          }),
        use: async (tokens) => {
          const identity = await this.#options.client.userInfo(tokens.accessToken, provider);
          if (!(await this.#storeCurrent(generation, { ...tokens, ...identity }))) {
            throw new Error(LOOPBACK_CONSENT_CANCELLED);
          }
          await this.#options.startCapabilities();
          if (!this.#isCurrent(generation)) throw new Error(LOOPBACK_CONSENT_CANCELLED);
          return this.#account;
        },
        revoke: (refreshToken) => this.#options.client.revoke(refreshToken),
        onRevokeFailure: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`Rejected account token revocation failed: ${message}\n`);
        },
      });
    } catch (error) {
      return { reason: error instanceof Error ? error.message : String(error) };
    }
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
