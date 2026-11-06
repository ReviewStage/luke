import { Data, type Effect } from "effect";

export class AccountRefreshFailed extends Data.TaggedError("AccountRefreshFailed")<{
  readonly message: string;
}> {}
export interface AccountToken {
  readAccessToken: () => Effect.Effect<string | undefined>;
  refreshAccount: () => Effect.Effect<void, AccountRefreshFailed>;
  readAccountKey?: (() => Effect.Effect<string | undefined>) | undefined;
}

export interface AccountSessionToken {
  readSessionToken: () => Effect.Effect<string | undefined>;
  obtainSession: () => Effect.Effect<void, AccountRefreshFailed>;
}
