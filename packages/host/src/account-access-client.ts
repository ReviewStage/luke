/**
 * account-access-client.ts -- what the signed-in account may open in the app, as the service answers it, held for the account it was read for.
 *
 * Today that is whether the account is an admin, which a window reads to
 * offer the admin dashboard. It draws by it and authorizes nothing: the
 * dashboard's own gate decides every admin read on the service. A read
 * that fails, or an answer that is not the shape the wire declares, is
 * read as no admin, so a doubt never offers the dashboard.
 */
import type { CallCredential } from "@luke/features";
import { askHosted, type HostedClient, hostedClient } from "@luke/features/hosted-link";
import { Effect, type Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import type { AppAccessSlice } from "./app-state.js";

interface AccountAccessClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
}

/** Reads the signed-in account's access through the same account call every hosted client makes. */
export class AccountAccessClient {
  readonly #hosted: HostedClient;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: AccountAccessClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
    });
    this.#client = options.httpClient ?? FetchHttpClient.layer;
  }

  /** Whether the signed-in account is an admin; no for any failure. */
  readAdmin(): Effect.Effect<boolean> {
    return askHosted(this.#hosted.account.access, undefined).pipe(
      Effect.map((answer) => answer.admin),
      Effect.orElseSucceed(() => false),
      Effect.provide(this.#client),
    );
  }
}

interface AccountAccessHolderOptions {
  readonly client: Pick<AccountAccessClient, "readAdmin">;
  /** Who is signed in now, as the host keys an account, or nobody. */
  readonly accountKey: () => string | undefined;
  /** Hands the access on whenever what it answers may have moved. */
  readonly publish: (access: AppAccessSlice) => void;
}

export interface AccountAccessHolder {
  /** The access of whoever is signed in now. */
  readonly current: () => AppAccessSlice;
  /** Reads the signed-in account's access afresh and publishes it, unless the account changed while it read. */
  readonly refresh: Effect.Effect<void>;
  /** The account moved: publishes what stands for whoever is signed in now, and forgets every read on a sign-out. */
  readonly accountChanged: Effect.Effect<void>;
}

/**
 * The access as the host holds it: the last read, kept beside the account it
 * was read for, so it answers for that account alone. Note that the account
 * is compared at every answer rather than the read cleared when the account
 * moves, because the change and a sign-in's read land in either order, and a
 * clear that landed after the read would drop it.
 */
export function accountAccessHolder(options: AccountAccessHolderOptions): AccountAccessHolder {
  const { client, accountKey, publish } = options;
  let held: { readonly accountKey: string; readonly admin: boolean } | undefined;

  const current = (): AppAccessSlice => {
    const key = accountKey();
    return { admin: key !== undefined && held?.accountKey === key && held.admin };
  };

  const refresh = Effect.gen(function* () {
    const key = accountKey();
    if (key === undefined) return;
    const admin = yield* client.readAdmin();
    if (accountKey() !== key) return;
    held = { accountKey: key, admin };
    publish(current());
  });

  const accountChanged = Effect.sync(() => {
    if (accountKey() === undefined) held = undefined;
    publish(current());
  });

  return { current, refresh, accountChanged };
}
