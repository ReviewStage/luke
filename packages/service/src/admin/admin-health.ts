/**
 * admin-health.ts -- what the Reliability screen's System health says: the
 * database's answer to a probe, and which of the deployment's providers its
 * environment configures.
 *
 * Each provider is reported by the presence of the variables it is read
 * from, never their values, so a maintainer reads that the call avatar is
 * off or the GitHub App unset without any secret crossing into the answer.
 * A provider the environment cannot show without a value, AI Gateway's
 * public catalog or the OIDC token Vercel Sandbox and Vercel Connect run on,
 * is not listed.
 */

import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@luke/features/integration-wire";

export interface AdminDatabaseHealth {
  reachable: boolean;
  /** Round-trip of a trivial probe query, in milliseconds. */
  latencyMs: number;
}

/**
 * Whether one provider is wired, by the presence of its keys alone. The key
 * is stable for anything that keys off the row; the label is the
 * maintainer-facing name.
 */
export interface AdminIntegration {
  key: string;
  label: string;
  configured: boolean;
}

/** The providers the deployment reads from its own environment, in the order the list draws them. */
const ADMIN_INTEGRATION = {
  HOSTED_TIER: { key: "hosted-tier", label: "Hosted voice & attention (OpenAI)" },
  CODING_AGENTS: { key: "coding-agents", label: "Coding agents on Luke's key (Anthropic)" },
  GITHUB_APP: { key: "github-app", label: "GitHub App (installations and webhooks)" },
  GITHUB_SIGN_IN: { key: "github-sign-in", label: "GitHub sign-in" },
  GOOGLE_SIGN_IN: { key: "google-sign-in", label: "Google sign-in" },
  CALL_AVATAR: { key: "call-avatar", label: "Call avatar (Keyframe)" },
  ERROR_REPORTING: { key: "error-reporting", label: "Error reporting (Sentry)" },
  ANALYTICS_RECORDING: { key: "analytics-recording", label: "Product analytics recording" },
  ANALYTICS_ERASURE: { key: "analytics-erasure", label: "Analytics erasure on account delete" },
  SWEEP: { key: "maintenance-sweep", label: "Scheduled maintenance sweep" },
  EVE_DEPLOYMENT: {
    key: "eve-deployment-secret",
    label: "Deployment acting for accounts at eve (voice, browser, automations)",
  },
  OWN_KEYS: { key: "own-key-encryption", label: "Encryption of accounts' own API keys" },
  WORKSPACE_LINEAR: { key: "workspace-linear", label: "Linear for workspaces (Vercel Connect)" },
} as const;

/** Whether each provider's configuration is present — never its value. */
export interface AdminIntegrationPresence {
  hostedTier: boolean;
  codingAgents: boolean;
  githubApp: boolean;
  githubSignIn: boolean;
  googleSignIn: boolean;
  callAvatar: boolean;
  errorReporting: boolean;
  analyticsRecording: boolean;
  analyticsErasure: boolean;
  sweep: boolean;
  /** The deployment's own secret at eve's door, read as unset where it is blank or the cron's own value. */
  eveDeployment: boolean;
  ownKeys: boolean;
  workspaceLinear: boolean;
  /** Each account integration Vercel Connect grants, by whether its connector is named; a provider with no connector is absent. */
  connectors: ReadonlyMap<IntegrationProvider, boolean>;
}

/** The health list, in the fixed order the screen draws it: the deployment's own providers, then each connector. */
export function adminIntegrations(present: AdminIntegrationPresence): AdminIntegration[] {
  const connectors = INTEGRATION_PROVIDER_LIST.flatMap((provider) => {
    const configured = present.connectors.get(provider);
    if (configured === undefined) return [];
    return [{ key: provider, label: `${INTEGRATION_NAME[provider]} (Vercel Connect)`, configured }];
  });
  return [
    { ...ADMIN_INTEGRATION.HOSTED_TIER, configured: present.hostedTier },
    { ...ADMIN_INTEGRATION.CODING_AGENTS, configured: present.codingAgents },
    { ...ADMIN_INTEGRATION.GITHUB_APP, configured: present.githubApp },
    { ...ADMIN_INTEGRATION.GITHUB_SIGN_IN, configured: present.githubSignIn },
    { ...ADMIN_INTEGRATION.GOOGLE_SIGN_IN, configured: present.googleSignIn },
    { ...ADMIN_INTEGRATION.CALL_AVATAR, configured: present.callAvatar },
    { ...ADMIN_INTEGRATION.ERROR_REPORTING, configured: present.errorReporting },
    { ...ADMIN_INTEGRATION.ANALYTICS_RECORDING, configured: present.analyticsRecording },
    { ...ADMIN_INTEGRATION.ANALYTICS_ERASURE, configured: present.analyticsErasure },
    { ...ADMIN_INTEGRATION.SWEEP, configured: present.sweep },
    { ...ADMIN_INTEGRATION.EVE_DEPLOYMENT, configured: present.eveDeployment },
    { ...ADMIN_INTEGRATION.OWN_KEYS, configured: present.ownKeys },
    { ...ADMIN_INTEGRATION.WORKSPACE_LINEAR, configured: present.workspaceLinear },
    ...connectors,
  ];
}
