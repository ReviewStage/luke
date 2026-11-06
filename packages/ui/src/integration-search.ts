import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_PURPOSE,
  type IntegrationProvider,
} from "@repo/features/integration-wire";
import { matchesTokens, searchTokens } from "./search-tokens.js";

/**
 * integration-search.ts -- what a query finds among the integrations, in Settings › Integrations' filter and the MCP popover's search alike.
 *
 * An integration is found by its name, by the line its row says of what it
 * gives agents, and by what it is for, in the words someone looking for it
 * would type ("database" finds Neon and Supabase). Settings' own search
 * finds an integration's row by these same lines, and by a few words naming
 * every integration alike (`packages/panel/src/settings-search.tsx`).
 */

/** What each integration is for, in the words someone looking for it would type. */
const INTEGRATION_KEYWORDS = {
  [INTEGRATION_PROVIDER.EXECUTOR]:
    "executor.sh gateway apps tools automations skills openapi graphql",
  [INTEGRATION_PROVIDER.GITHUB]: "git repositories issues pull requests actions code",
  [INTEGRATION_PROVIDER.GMAIL]: "google email mail inbox messages threads drafts labels workspace",
  [INTEGRATION_PROVIDER.GOOGLE_CALENDAR]: "calendar events meetings schedule invites workspace",
  [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: "drive files folders documents docs sheets slides workspace",
  [INTEGRATION_PROVIDER.GRANOLA]: "meetings notes transcripts calls",
  [INTEGRATION_PROVIDER.LINEAR]: "issues tracker",
  [INTEGRATION_PROVIDER.MERCURY]: "bank banking accounts transactions payments finance",
  [INTEGRATION_PROVIDER.NEON]: "postgres database sql branches",
  [INTEGRATION_PROVIDER.NOTION]: "pages docs wiki databases notes",
  [INTEGRATION_PROVIDER.POSTHOG]: "analytics events feature flags experiments insights",
  [INTEGRATION_PROVIDER.RESEND]: "email mail send transactional broadcasts domains contacts",
  [INTEGRATION_PROVIDER.SENTRY]: "errors crashes exceptions monitoring traces issues",
  [INTEGRATION_PROVIDER.SLACK]: "chat messages channels threads team",
  [INTEGRATION_PROVIDER.STRIPE]:
    "payments billing subscriptions invoices customers refunds checkout revenue",
  [INTEGRATION_PROVIDER.SUPABASE]: "postgres database sql auth storage edge functions",
  [INTEGRATION_PROVIDER.VERCEL]: "deployments hosting logs domains projects",
  [INTEGRATION_PROVIDER.YCOMBINATOR]: "yc bookface startups founders investors hiring",
} as const satisfies Record<IntegrationProvider, string>;

/** The lines an integration itself is found by: its name, what it is for, and the line its row says of what it gives agents. */
export function integrationLines(provider: IntegrationProvider): readonly string[] {
  return [
    INTEGRATION_NAME[provider],
    INTEGRATION_KEYWORDS[provider],
    INTEGRATION_PURPOSE[provider],
  ];
}

/** Whether a query's words find the integration, by its name or what it is for; blank words find it. */
export function integrationFound(
  provider: IntegrationProvider,
  tokens: readonly string[],
): boolean {
  return matchesTokens(integrationLines(provider), tokens);
}

/** Whether a query finds the integration itself, by its name or what it is for. */
export function integrationNamed(provider: IntegrationProvider, query: string): boolean {
  const tokens = searchTokens(query);
  return tokens.length > 0 && integrationFound(provider, tokens);
}
