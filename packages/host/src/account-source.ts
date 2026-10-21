/**
 * Where the account's identity and credentials come from, as the shell
 * chooses it: the desktop's OAuth sign-in over the loopback, keeping its
 * tokens sealed in the settings file (`oauth-account-source.ts`), or a
 * browser's cookie session, which keeps none. The account composer opens the
 * session over what the host built and reads everything of the account
 * through it, so nothing else in the host knows which source it stands on.
 */
import type { AccountProvider, AccountSnapshot } from "@luke/credentials/snapshot";
import type { AccountToken, CallCredential } from "@luke/features";
import type { Effect, Scope, Stream } from "effect";
import type { RunMode } from "./run-mode.js";
import type { SecretCipher, SettingsStore } from "./settings-store.js";

/** What the host hands a source as the account composer opens it. */
export interface AccountSourceHost {
  /** The settings file's account record, for a source that keeps its account there. */
  readonly store: Pick<
    SettingsStore,
    "readAccount" | "setAccount" | "clearAccount" | "accountSnapshot" | "settleSessionAccount"
  >;
  readonly accountBaseUrl: string;
  readonly hostedServiceBaseUrl: string;
  readonly runMode: RunMode;
  readonly report: (message: string) => void;
  /** An address the sign-in needs opened, through the client's own node. */
  readonly openExternal: (url: string) => Promise<void>;
  /** The account gate's own pair, awaited late: opening it arms every cadence a signed-in account may have. */
  readonly startCapabilities: Effect.Effect<void>;
  readonly stopCapabilities: Effect.Effect<void>;
}

/** The account's session, open for the account composer's own lifetime. */
export interface AccountSession {
  /** The account as it stands now. */
  readonly snapshot: () => AccountSnapshot;
  /** Every account this session settles on, in order, for as long as the subscriber's scope stands. */
  readonly changes: Effect.Effect<Stream.Stream<AccountSnapshot>, never, Scope.Scope>;
  /** Reads the account this launch starts with and settles on it, answering it. */
  readonly initialize: Effect.Effect<AccountSnapshot>;
  readonly beginSignIn: (provider: AccountProvider) => Effect.Effect<AccountSnapshot, Error>;
  /** Signs the same account in again; answers whether a session landed. */
  readonly signInAgain: (provider: AccountProvider) => Effect.Effect<boolean, Error>;
  readonly cancelSignIn: () => void;
  /**
   * Signs the account out. A source whose sign-out only the service can carry
   * out (a cookie session) fails where the service did not, and the account
   * then stands as it was.
   */
  readonly signOut: (options: {
    readonly revokeRemote?: boolean;
  }) => Effect.Effect<AccountSnapshot, Error>;
  /** Deletes the account on the service, then signs out. */
  readonly deleteEverywhere: () => Effect.Effect<AccountSnapshot, Error>;
  /**
   * The launch's check of the account against the service: one check however
   * many ask at once, which a source may retry a few times where the service
   * did not answer, before the account stands as it was settled.
   */
  readonly refreshOnce: () => Effect.Effect<void>;
  /**
   * Settles on the account the service names now, right before a write keyed
   * on the account, for a source whose account can change without this host
   * hearing of it (a cookie another tab signed in under). A source whose
   * account changes only through this host omits it.
   */
  readonly confirmAccount?: (() => Effect.Effect<void>) | undefined;
  /**
   * The account's own token reads, where the source holds a token: the
   * terminal socket's bearer and the voice credential's renewal read them. A
   * source that holds none reads nothing.
   */
  readonly token: AccountToken;
  /** What a hosted client's call carries for the account. */
  readonly credential: CallCredential;
  /** What a call that writes through Better Auth's organization endpoints carries. */
  readonly sessionCredential: CallCredential;
}

export interface AccountSourceSeam {
  /**
   * What the settings file seals this source's tokens with. A source that
   * keeps none there, such as a cookie session, hands none, and the store
   * then holds no account.
   */
  readonly tokenCipher: SecretCipher | undefined;
  /** Opens the account's session over what the host built for it. */
  readonly open: (host: AccountSourceHost) => Effect.Effect<AccountSession, never, Scope.Scope>;
}
