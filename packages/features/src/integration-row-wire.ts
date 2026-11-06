export const INTEGRATION_ROW_STATUS = {
  PENDING: "pending",
  CONNECTED: "connected",
  EXPIRED: "expired",
} as const;

export type IntegrationRowStatus =
  (typeof INTEGRATION_ROW_STATUS)[keyof typeof INTEGRATION_ROW_STATUS];
