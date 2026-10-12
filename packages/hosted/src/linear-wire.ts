import { Schema as EffectSchema } from "effect";

/**
 * linear-wire.ts -- an account's Linear connection, as the desktop reads and changes it.
 *
 * `GET /api/account/linear` answers where the signed-in account's
 * connection stands, in one word. `POST /api/account/linear/connect` begins
 * a browser sign-in through Vercel Connect and answers the address the
 * browser opens, which the desktop opens and never draws.
 * `POST /api/account/linear/disconnect` ends the connection and answers its
 * word. The browser returns from the sign-in to the service's own callback,
 * which settles the sign-in and sends the browser on to the landing page
 * below with one word of its own. No answer carries a token or a Linear
 * identity.
 */

/** Where an account's Linear connection stands. */
export const LINEAR_STATUS = {
  /** Luke's agents may use the account's Linear. */
  CONNECTED: "connected",
  /** A sign-in was begun and has not completed. */
  PENDING: "pending",
  /** The account was connected, and Linear's grant has since stopped working; connect again. */
  EXPIRED: "expired",
  /** The account has no connection. */
  DISCONNECTED: "disconnected",
  /** This deployment of Luke offers no Linear connection at all. */
  UNAVAILABLE: "unavailable",
} as const;

export type LinearStatus = (typeof LINEAR_STATUS)[keyof typeof LINEAR_STATUS];

/** Where the connection stands (GET), and what a Disconnect leaves (POST). */
export const linearStatusAnswerSchema = EffectSchema.Struct({
  status: EffectSchema.Literals(Object.values(LINEAR_STATUS)),
});

export type LinearStatusAnswer = typeof linearStatusAnswerSchema.Type;

/** The address a sign-in opens in the browser (POST): https, and nothing else. */
export const linearConnectAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isPattern(/^https:\/\/\S+$/)),
});

export type LinearConnectAnswer = typeof linearConnectAnswerSchema.Type;

/** The page the browser lands on once a sign-in settled, and the one word it carries. */
export const LINEAR_LANDING = {
  PATH: "/linear-connected.html",
  STATUS_PARAM: "status",
} as const;

/** How a browser sign-in settled, as the landing page says it. */
export const LINEAR_LANDING_STATUS = {
  /** The account is connected. */
  CONNECTED: "connected",
  /** The sign-in did not give Luke a grant: declined, cancelled, or abandoned. */
  NOT_COMPLETED: "not-completed",
  /** The sign-in's link was not one Luke issued, or it is too old to finish. */
  EXPIRED: "expired",
  /** Luke could not reach Vercel Connect to settle the sign-in. */
  UNAVAILABLE: "unavailable",
} as const;

export type LinearLandingStatus =
  (typeof LINEAR_LANDING_STATUS)[keyof typeof LINEAR_LANDING_STATUS];

const LANDING_STATUSES: ReadonlySet<string> = new Set(Object.values(LINEAR_LANDING_STATUS));

/** The landing's status as the address spells it; anything else is no status. */
export function linearLandingStatusFromWire(value: string | null): LinearLandingStatus | undefined {
  // SAFETY: membership in the set built from LINEAR_LANDING_STATUS's values is what the union names.
  return value !== null && LANDING_STATUSES.has(value) ? (value as LinearLandingStatus) : undefined;
}

/** The landing page's path for one status, relative so it lands on whichever host the browser is on. */
export function linearLandingPath(status: LinearLandingStatus): string {
  return `${LINEAR_LANDING.PATH}?${LINEAR_LANDING.STATUS_PARAM}=${status}`;
}
