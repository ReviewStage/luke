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
  /** Reads the signed-in account's access afresh and publishes it, unless the account changed or signed out while it read. */
  readonly refresh: Effect.Effect<void>;
  /** The account moved: publishes what stands for whoever is signed in now. */
  readonly accountChanged: Effect.Effect<void>;
  /** The account gate closed (a sign-out, or a switch away): forgets every read, and every read still out, and publishes no admin. */
  readonly forget: Effect.Effect<void>;
}

/**
 * The access as the host holds it: the last read, kept beside the account it
 * was read for, so it answers for that account alone. Note that the account
 * is compared at every answer rather than the read cleared when the change
 * event arrives, because that event and a sign-in's read land in either
 * order, and a clear that landed after the read would drop it. What clears
 * it is the gate closing (`forget`), which runs in order with the gate's
 * opening, so a sign-out and the same account's return still forget the
 * answer read before, and a read still out across them is dropped by its
 * generation rather than by the account it names.
 */
export function accountAccessHolder(options: AccountAccessHolderOptions): AccountAccessHolder {
  const { client, accountKey, publish } = options;
  let held: { readonly accountKey: string; readonly admin: boolean } | undefined;
  let generation = 0;

  const current = (): AppAccessSlice => {
    const key = accountKey();
    return { admin: key !== undefined && held?.accountKey === key && held.admin };
  };

  const refresh = Effect.gen(function* () {
    const key = accountKey();
    if (key === undefined) return;
    const asked = generation;
    const admin = yield* client.readAdmin();
    if (generation !== asked || accountKey() !== key) return;
    held = { accountKey: key, admin };
    publish(current());
  });

  const accountChanged = Effect.sync(() => publish(current()));

  const forget = Effect.sync(() => {
    generation += 1;
    held = undefined;
    publish(current());
  });

  return { current, refresh, accountChanged, forget };
}
