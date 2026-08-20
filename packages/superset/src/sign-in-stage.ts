export const SUPERSET_SIGN_IN_STAGE = {
  IDLE: "idle",
  BROWSER_CODE: "browser-code",
  EXCHANGING: "exchanging",
  ORGANIZATION: "organization",
  SWITCHING: "switching",
  FAILURE: "failure",
  CONNECTED: "connected",
} as const;

export type SupersetSignInStage =
  (typeof SUPERSET_SIGN_IN_STAGE)[keyof typeof SUPERSET_SIGN_IN_STAGE];

export interface SupersetSignInSnapshot {
  stage: SupersetSignInStage;
  failure?: string;
  organizations: readonly SupersetOrganizationChoice[];
}

export interface SupersetOrganizationChoice {
  id: string;
  name: string;
  slug: string;
}
