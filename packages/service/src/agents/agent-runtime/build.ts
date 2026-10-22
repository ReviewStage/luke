/**
 * build.ts -- what eve leaves unbundled when it compiles an agent's authored modules.
 *
 * eve compiles every authored file (each tool, hook, channel, subagent) into
 * a bundle of its own, and every one of them reaches `host.ts`, which reaches
 * the web runtime and so all of its server packages. Bundled, that was a
 * 27 MB chunk per file, some forty per agent, and most of each service's
 * build time. Kept external, each chunk holds this repository's own source
 * alone and the packages resolve once, through Node, from the agent's
 * `package.json`, which must declare every name listed here.
 */

/** The server packages an agent's authored modules import and eve keeps external. */
export const AGENT_EXTERNAL_DEPENDENCIES = [
  "@ai-sdk/anthropic",
  "@ai-sdk/openai",
  "@better-auth/drizzle-adapter",
  "@better-auth/electron",
  "@better-auth/oauth-provider",
  "@effect/sql-pg",
  "@sentry/effect",
  "@vercel/connect",
  "@vercel/oidc",
  "ai",
  "better-auth",
  "diff",
  "drizzle-orm",
  "effect",
  "pg",
  "ws",
] as const;
