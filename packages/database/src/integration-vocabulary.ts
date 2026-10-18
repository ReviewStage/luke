/**
 * integration-vocabulary.ts -- the words an integration row's status is spelled in, for an account's row and a workspace's alike.
 *
 * No row is a disconnected provider; these are what a row that stands says.
 */
export const INTEGRATION_ROW_STATUS = {
  /** A first sign-in is under way and has not completed. */
  PENDING: "pending",
  /** A sign-in completed and Connect last answered with a token. */
  CONNECTED: "connected",
  /** It was connected, and Connect then answered it holds no grant it can use. */
  EXPIRED: "expired",
} as const;

export type IntegrationRowStatus =
  (typeof INTEGRATION_ROW_STATUS)[keyof typeof INTEGRATION_ROW_STATUS];

/**
 * Where an integration's installation on a workspace stands, as its
 * provider last said: active until the provider tells Luke it was
 * uninstalled, and then deleted, kept so a late delivery under it is known
 * and refused rather than unknown.
 */
export const INTEGRATION_INSTALLATION_STATUS = {
  ACTIVE: "active",
  DELETED: "deleted",
} as const;

export type IntegrationInstallationStatus =
  (typeof INTEGRATION_INSTALLATION_STATUS)[keyof typeof INTEGRATION_INSTALLATION_STATUS];
