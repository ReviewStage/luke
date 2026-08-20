import { Effect } from "effect";
import { singleFlight } from "./account-token-lifecycle";
import {
  LINEAR_REFRESH_STATUS,
  type LinearGrant,
  refreshLinearGrant,
  revokeLinearGrant,
} from "./linear-oauth";
import type { FileFailure, Files } from "./services/files";

/** Refreshed a minute early, so a pass never rides a token mid-expiry. */
const ACCESS_TOKEN_EXPIRY_SLACK_MS = 60_000;

export interface LinearCredentialsOptions {
  readGrant: () => Effect.Effect<LinearGrant | undefined, FileFailure, Files>;
  writeGrant: (grant: LinearGrant) => Effect.Effect<void, FileFailure, Files>;
  forgetGrant: () => Effect.Effect<void, FileFailure, Files>;
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
}

export class LinearCredentials {
  readonly #options: LinearCredentialsOptions;
  readonly #now: () => number;
  readonly #renew: () => Effect.Effect<void, unknown, unknown>;
  #disconnecting = false;
  #generation = 0;

  constructor(options: LinearCredentialsOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#renew = singleFlight(() =>
      Effect.gen(this, function* () {
        const generation = this.#generation;
        if (this.#disconnecting) return;
        const grant = yield* this.#options.readGrant();
        if (
          generation !== this.#generation ||
          this.#disconnecting ||
          !grant?.refreshToken ||
          this.#current(grant)
        )
          return;
        const outcome = yield* refreshLinearGrant(grant.refreshToken, {
          ...(this.#options.environment ? { environment: this.#options.environment } : undefined),
          now: this.#now,
        });
        if (outcome.status === LINEAR_REFRESH_STATUS.RENEWED) {
          if (generation !== this.#generation) return;
          yield* this.#options.writeGrant(outcome.grant);
          return;
        }
        if (outcome.status === LINEAR_REFRESH_STATUS.REFUSED) {
          if (generation !== this.#generation) return;
          yield* this.#options.forgetGrant();
        }
      }),
    );
  }

  accessToken(): Effect.Effect<string | undefined, unknown, unknown> {
    return Effect.gen(this, function* () {
      if (this.#disconnecting) return undefined;
      const grant = yield* this.#options.readGrant();
      if (this.#disconnecting || !grant) return undefined;
      if (this.#current(grant)) return grant.accessToken;
      if (!grant.refreshToken) {
        yield* this.#options.forgetGrant();
        return undefined;
      }
      yield* this.#renew();
      if (this.#disconnecting) return undefined;
      const renewed = yield* this.#options.readGrant();
      return !this.#disconnecting && renewed && this.#unexpired(renewed)
        ? renewed.accessToken
        : undefined;
    });
  }

  disconnect(): Effect.Effect<void, unknown, unknown> {
    return Effect.gen(this, function* () {
      this.#disconnecting = true;
      this.#generation += 1;
      try {
        const grant = yield* this.#options.readGrant();
        yield* this.#options.forgetGrant();
        if (grant) {
          yield* revokeLinearGrant(
            grant.refreshToken ?? grant.accessToken,
            grant.refreshToken ? "refresh_token" : "access_token",
          ).pipe(Effect.catchAll(() => Effect.void));
        }
      } finally {
        this.#disconnecting = false;
      }
    });
  }

  #current(grant: LinearGrant): boolean {
    return grant.expiresAt - ACCESS_TOKEN_EXPIRY_SLACK_MS > this.#now();
  }

  #unexpired(grant: LinearGrant): boolean {
    return grant.expiresAt > this.#now();
  }
}
