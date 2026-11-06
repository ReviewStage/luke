import type { AdminIntegration } from "@repo/features/admin-answer-wire";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@repo/features/integration-wire";

const ADMIN_INTEGRATION = {
  GITHUB_APP: { key: "github-app", label: "GitHub App (installations and webhooks)" },
  GITHUB_SIGN_IN: { key: "github-sign-in", label: "GitHub sign-in" },
  GOOGLE_SIGN_IN: { key: "google-sign-in", label: "Google sign-in" },
  ERROR_REPORTING: { key: "error-reporting", label: "Error reporting (Sentry)" },
  ANALYTICS_RECORDING: { key: "analytics-recording", label: "Product analytics recording" },
  ANALYTICS_ERASURE: { key: "analytics-erasure", label: "Analytics erasure on account delete" },
  SWEEP: { key: "maintenance-sweep", label: "Scheduled maintenance sweep" },
  OWN_KEYS: { key: "own-key-encryption", label: "Encryption of accounts' own API keys" },
} as const;

export interface AdminIntegrationPresence {
  githubApp: boolean;
  githubSignIn: boolean;
  googleSignIn: boolean;
  errorReporting: boolean;
  analyticsRecording: boolean;
  analyticsErasure: boolean;
  sweep: boolean;
  ownKeys: boolean;
  connectors: ReadonlyMap<IntegrationProvider, boolean>;
}

export function adminIntegrations(present: AdminIntegrationPresence): AdminIntegration[] {
  const connectors = INTEGRATION_PROVIDER_LIST.flatMap((provider) => {
    const configured = present.connectors.get(provider);
    if (configured === undefined) return [];
    return [{ key: provider, label: `${INTEGRATION_NAME[provider]} (Vercel Connect)`, configured }];
  });
  return [
    { ...ADMIN_INTEGRATION.GITHUB_APP, configured: present.githubApp },
    { ...ADMIN_INTEGRATION.GITHUB_SIGN_IN, configured: present.githubSignIn },
    { ...ADMIN_INTEGRATION.GOOGLE_SIGN_IN, configured: present.googleSignIn },
    { ...ADMIN_INTEGRATION.ERROR_REPORTING, configured: present.errorReporting },
    { ...ADMIN_INTEGRATION.ANALYTICS_RECORDING, configured: present.analyticsRecording },
    { ...ADMIN_INTEGRATION.ANALYTICS_ERASURE, configured: present.analyticsErasure },
    { ...ADMIN_INTEGRATION.SWEEP, configured: present.sweep },
    { ...ADMIN_INTEGRATION.OWN_KEYS, configured: present.ownKeys },
    ...connectors,
  ];
}
