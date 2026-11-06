export {
  INTEGRATION_ROW_STATUS,
  type IntegrationRowStatus,
} from "@repo/features/integration-row-wire";

export const INTEGRATION_INSTALLATION_STATUS = {
  ACTIVE: "active",
  DELETED: "deleted",
} as const;

export type IntegrationInstallationStatus =
  (typeof INTEGRATION_INSTALLATION_STATUS)[keyof typeof INTEGRATION_INSTALLATION_STATUS];
