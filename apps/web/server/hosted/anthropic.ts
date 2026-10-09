/**
 * anthropic.ts -- how the coding-agent service reaches Anthropic on Luke's own key.
 *
 * The key comes from the deployment's environment and never appears in a
 * response, a log line, an error, or a sandbox; without one a coding agent
 * on an Anthropic model cannot run and its step fails saying so.
 */

export const HOSTED_ANTHROPIC_ENVIRONMENT = {
  API_KEY: "ANTHROPIC_API_KEY",
} as const;
