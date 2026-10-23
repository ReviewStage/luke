/**
 * token-estimate.ts -- eve's own estimate of a text's tokens, the bytes of its JSON over four, kept apart from eve so a route may read it.
 *
 * `context-estimate.ts` estimates an eve step's instructions, tools, and
 * brief with it, and reaches eve's tools to do so; the runner events route
 * (`../native-events/runner-events-app.ts`) estimates a native step's brief
 * with the same rule and may load no eve module.
 */

/** The bytes a token stands for in eve's own estimate. */
const BYTES_PER_TOKEN = 4;

/** The tokens of a value's JSON as eve's compaction estimates them: its bytes over four, rounded up. */
export function estimatedTokens(json: string): number {
  return Math.ceil(new TextEncoder().encode(json).byteLength / BYTES_PER_TOKEN);
}
