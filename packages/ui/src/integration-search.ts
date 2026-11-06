import type { IntegrationTool } from "@repo/features/integration-health";
import { byName } from "@repo/features/integration-tool-model";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_PURPOSE,
  type IntegrationProvider,
} from "@repo/features/integration-wire";
import { matchesTokens, searchTokens } from "./search-tokens.js";

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

export interface IntegrationMatch {
  readonly named: boolean;
  readonly tools: readonly IntegrationTool[];
}

export function shownTools(
  match: IntegrationMatch | undefined,
  tools: readonly IntegrationTool[],
): readonly IntegrationTool[] {
  if (match === undefined) return [];
  return match.tools.length > 0 ? match.tools : tools;
}

export function integrationLines(provider: IntegrationProvider): readonly string[] {
  return [
    INTEGRATION_NAME[provider],
    INTEGRATION_KEYWORDS[provider],
    INTEGRATION_PURPOSE[provider],
  ];
}

export function integrationNamed(provider: IntegrationProvider, query: string): boolean {
  const tokens = searchTokens(query);
  return tokens.length > 0 && matchesTokens(integrationLines(provider), tokens);
}

export function matchIntegration(
  provider: IntegrationProvider,
  tools: readonly IntegrationTool[],
  tokens: readonly string[],
): IntegrationMatch | undefined {
  if (tokens.length === 0) return { named: true, tools: [] };
  const name = INTEGRATION_NAME[provider];
  const named = matchesTokens(integrationLines(provider), tokens);
  const found = matchesTokens([name], tokens)
    ? []
    : byName(tools).filter((tool) =>
        matchesTokens([tool.name, tool.title ?? "", tool.description, name], tokens),
      );
  return named || found.length > 0 ? { named, tools: found } : undefined;
}
