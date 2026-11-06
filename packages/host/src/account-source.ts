import type { AccountProvider, AccountSnapshot } from "@repo/credentials/snapshot";
import type { AccountToken, CallCredential } from "@repo/features";
import type { Effect, Scope, Stream } from "effect";
import type { RunMode } from "./run-mode.js";
import type { SecretCipher, SettingsStore } from "./settings-store.js";

export interface AccountSourceHost {
  readonly store: Pick<
    SettingsStore,
    "readAccount" | "setAccount" | "clearAccount" | "accountSnapshot" | "settleSessionAccount"
  >;
  readonly accountBaseUrl: string;
  readonly hostedServiceBaseUrl: string;
  readonly runMode: RunMode;
  readonly report: (message: string) => void;
  readonly openExternal: (url: string) => Promise<void>;
  readonly startCapabilities: Effect.Effect<void>;
  readonly stopCapabilities: Effect.Effect<void>;
}

export interface AccountSession {
  readonly snapshot: () => AccountSnapshot;
  readonly changes: Effect.Effect<Stream.Stream<AccountSnapshot>, never, Scope.Scope>;
  readonly initialize: Effect.Effect<AccountSnapshot>;
  readonly returnedFromSignIn?: Effect.Effect<boolean> | undefined;
  readonly beginSignIn: (provider: AccountProvider) => Effect.Effect<AccountSnapshot, Error>;
  readonly signInAgain: (provider: AccountProvider) => Effect.Effect<boolean, Error>;
  readonly cancelSignIn: () => void;
  readonly signOut: (options: {
    readonly revokeRemote?: boolean;
  }) => Effect.Effect<AccountSnapshot, Error>;
  readonly deleteEverywhere: () => Effect.Effect<AccountSnapshot, Error>;
  readonly refreshOnce: () => Effect.Effect<void>;
  readonly confirmAccount?: (() => Effect.Effect<void>) | undefined;
  readonly token: AccountToken;
  readonly credential: CallCredential;
  readonly sessionCredential: CallCredential;
}

export interface AccountSourceSeam {
  readonly tokenCipher: SecretCipher | undefined;
  readonly open: (host: AccountSourceHost) => Effect.Effect<AccountSession, never, Scope.Scope>;
}
