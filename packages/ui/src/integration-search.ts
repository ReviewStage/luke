import type { IntegrationTool } from "@luke/features/integration-health";
import { byName } from "@luke/features/integration-tool-model";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  type IntegrationProvider,
} from "@luke/features/integration-wire";
import { matchesTokens, searchTokens } from "./search-tokens.js";

/**
 * integration-search.ts -- what a query finds among the integrations and their tools, in Settings › Integrations' filter and the MCP popover's search alike.
 *
 * An integration is found by its name and by what it is for, in the words
 * someone looking for it would type ("database" finds Neon and Supabase),
 * and its tools by their names, titles, and descriptions, a word naming the
 * integration counting toward each of its tools ("vercel logs"). Note that a
 * query its name alone answers ("vercel") finds the whole integration rather
 * than the tools that happen to repeat its name, so it finds no tool by
 * itself. Settings' own search finds an integration's row by these same
 * lines, and by a few words naming every integration alike
 * (`packages/panel/src/settings-search.tsx`).
 */

/** What each integration is for, in the words someone looking for it would type. */
const INTEGRATION_KEYWORDS = {
  [INTEGRATION_PROVIDER.EXECUTOR]:
    "executor.sh gateway apps tools automations skills openapi graphql",
  [INTEGRATION_PROVIDER.GITHUB]: "git repositories issues pull requests actions code",
  [INTEGRATION_PROVIDER.GRANOLA]: "meetings notes transcripts calls",
  [INTEGRATION_PROVIDER.LINEAR]: "issues tracker",
  [INTEGRATION_PROVIDER.MERCURY]: "bank banking accounts transactions payments finance",
  [INTEGRATION_PROVIDER.NEON]: "postgres database sql branches",
  [INTEGRATION_PROVIDER.NOTION]: "pages docs wiki databases notes",
  [INTEGRATION_PROVIDER.POSTHOG]: "analytics events feature flags experiments insights",
  [INTEGRATION_PROVIDER.SENTRY]: "errors crashes exceptions monitoring traces issues",
  [INTEGRATION_PROVIDER.SLACK]: "chat messages channels threads team",
  [INTEGRATION_PROVIDER.SUPABASE]: "postgres database sql auth storage edge functions",
  [INTEGRATION_PROVIDER.VERCEL]: "deployments hosting logs domains projects",
  [INTEGRATION_PROVIDER.YCOMBINATOR]: "yc bookface startups founders investors hiring",
} as const satisfies Record<IntegrationProvider, string>;

/** What a query found of one integration. */
export interface IntegrationMatch {
  /** Its name or what it is for holds every word, so the integration itself was found. */
  readonly named: boolean;
  /** The tools found, alphabetical; none where its name alone answers the query, which finds every one. */
  readonly tools: readonly IntegrationTool[];
}

/**
 * The tools one integration's list shows for what a query found of it: the
 * tools it found, else every one where it found the integration itself,
 * else none.
 */
export function shownTools(
  match: IntegrationMatch | undefined,
  tools: readonly IntegrationTool[],
): readonly IntegrationTool[] {
  if (match === undefined) return [];
  return match.tools.length > 0 ? match.tools : tools;
}

/** The lines an integration itself is found by: its name, and what it is for. */
export function integrationLines(provider: IntegrationProvider): readonly string[] {
  return [INTEGRATION_NAME[provider], INTEGRATION_KEYWORDS[provider]];
}

/** Whether a query finds the integration itself, by its name or what it is for. */
export function integrationNamed(provider: IntegrationProvider, query: string): boolean {
  const tokens = searchTokens(query);
  return tokens.length > 0 && matchesTokens(integrationLines(provider), tokens);
}

/**
 * What a query's words find of one integration and the tools its server
 * listed, or nothing where they find neither. Blank words find it whole.
 */
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
