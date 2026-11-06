import { INTEGRATION_STATUS } from "./integration-wire.js";

export const INTEGRATION_STATUS_WORDS = {
  [INTEGRATION_STATUS.CONNECTED]: "Connected",
  [INTEGRATION_STATUS.PENDING]: "Connecting",
  [INTEGRATION_STATUS.EXPIRED]: "Sign-in expired",
} as const;
