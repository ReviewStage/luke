// The same collapsing the account's refresh uses, and for the same reason:
// Linear consumes a refresh token when it is spent, so two refreshes racing
// would have the loser spend one Linear has already rotated away.
import { singleFlight } from "@sidecar/credentials";
import {
  LINEAR_REFRESH_STATUS,
  type LinearGrant,
  refreshLinearGrant,
  revokeLinearGrant,
} from "./oauth.js";

/** Refreshed a minute early, so a pass never rides a token mid-expiry. */
const ACCESS_TOKEN_EXPIRY_SLACK_MS = 60_000;

export interface LinearCredentialsOptions {
  /**
   * Resolved at each ask, so a grant connected or disconnected in settings
   * takes effect on the next pass without this being rebuilt.
   */
  readGrant: () => Promise<LinearGrant | undefined>;
  /** Stores a renewed grant. Always awaited before the grant is used. */
  writeGrant: (grant: LinearGrant) => Promise<void>;
  /** Deletes the stored grant, which is what a refusal from Linear settles. */
  forgetGrant: () => Promise<void>;
  environment?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  now?: () => number;
}

/**
 * Holds the one thing a Linear request needs: an access token that has not
 * lapsed. Linear's access tokens last a day and its refresh tokens rotate
 * when spent, so this is where the two rules that follow from that live —
 * a renewed grant is written before it is used, and only Linear refusing the
 * refresh deletes anything. A network that could not carry the refresh leaves
 * the grant exactly where it was: the next pass is the whole remedy, and a
 * developer must not be disconnected for having closed their laptop.
 */
export class LinearCredentials {
  readonly #options: LinearCredentialsOptions;
  readonly #now: () => number;
  readonly #renew: () => Promise<void>;
  #disconnecting = false;
  #generation = 0;

  constructor(options: LinearCredentialsOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#renew = singleFlight(async () => {
      const generation = this.#generation;
      if (this.#disconnecting) return;
      const grant = await this.#options.readGrant();
      // Another ask may have renewed it while this one waited for the flight,
      // in which case there is nothing left to spend a rotation on.
      if (
        generation !== this.#generation ||
        this.#disconnecting ||
        !grant?.refreshToken ||
        this.#current(grant)
      )
        return;
      const outcome = await refreshLinearGrant(grant.refreshToken, {
        ...(this.#options.environment ? { environment: this.#options.environment } : undefined),
        ...(this.#options.fetchImplementation
          ? { fetchImplementation: this.#options.fetchImplementation }
          : undefined),
        now: this.#now,
      });
      if (outcome.status === LINEAR_REFRESH_STATUS.RENEWED) {
        if (generation !== this.#generation) return;
        await this.#options.writeGrant(outcome.grant);
        return;
      }
      // Linear said no: the grant is spent, withdrawn, or expired, and no
      // number of further passes will change that. Forgetting it is what
      // turns the row back into an offer to connect, which is the only thing
      // that helps.
      if (outcome.status === LINEAR_REFRESH_STATUS.REFUSED) {
        if (generation !== this.#generation) return;
        await this.#options.forgetGrant();
      }
    });
  }

  /**
   * A token that will still be honoured, renewing first when the stored one
   * is spent. Nothing connected, nothing renewable, or a renewal Linear
   * refused all answer the same way — with nothing — because each means the
   * same thing to a caller: no request may be sent.
   */
  async accessToken(): Promise<string | undefined> {
    if (this.#disconnecting) return undefined;
    const grant = await this.#options.readGrant();
    if (this.#disconnecting || !grant) return undefined;
    if (this.#current(grant)) return grant.accessToken;
    if (!grant.refreshToken) {
      // Linear issues some registrations a long-lived token and no way to
      // renew it. Once that one lapses there is nothing to hold, and the row
      // should say connect rather than sit there failing every pass.
      await this.#options.forgetGrant();
      return undefined;
    }
    await this.#renew();
    if (this.#disconnecting) return undefined;
    const renewed = await this.#options.readGrant();
    return !this.#disconnecting && renewed && this.#unexpired(renewed)
      ? renewed.accessToken
      : undefined;
  }

  /**
   * Ends the connection: the grant is revoked at Linear so the access stops
   * there too, and forgotten here either way. The revocation is best effort —
   * the developer asked to disconnect, and a network that cannot carry the
   * message is no reason to keep the grant on this machine.
   */
  async disconnect(): Promise<void> {
    this.#disconnecting = true;
    this.#generation += 1;
    try {
      const grant = await this.#options.readGrant();
      await this.#options.forgetGrant();
      if (grant) {
        await revokeLinearGrant(
          grant.refreshToken ?? grant.accessToken,
          grant.refreshToken ? "refresh_token" : "access_token",
          this.#options.fetchImplementation ?? fetch,
        );
      }
    } finally {
      this.#disconnecting = false;
    }
  }

  #current(grant: LinearGrant): boolean {
    return grant.expiresAt - ACCESS_TOKEN_EXPIRY_SLACK_MS > this.#now();
  }

  #unexpired(grant: LinearGrant): boolean {
    return grant.expiresAt > this.#now();
  }
}
