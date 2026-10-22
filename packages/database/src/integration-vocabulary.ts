/**
 * integration-vocabulary.ts -- the status words of an integration row, declared on the wire below this package
 * (`@luke/features/integration-row-wire`) because the admin pages draw them too.
 */
export {
  INTEGRATION_ROW_STATUS,
  type IntegrationRowStatus,
} from "@luke/features/integration-row-wire";

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
