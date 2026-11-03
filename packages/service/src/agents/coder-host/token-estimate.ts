/**
 * token-estimate.ts -- eve's own estimate of a text's tokens, the bytes of its JSON over four, kept apart from eve so a route may read it.
 *
 * The runner events route (`../native-events/runner-events-app.ts`)
 * estimates a native step's brief with it, the rule an eve step's
 * instructions, tools, and brief were estimated by.
 */

/** The bytes a token stands for in eve's own estimate. */
const BYTES_PER_TOKEN = 4;

/** The tokens of a value's JSON as eve's compaction estimates them: its bytes over four, rounded up. */
export function estimatedTokens(json: string): number {
  return Math.ceil(new TextEncoder().encode(json).byteLength / BYTES_PER_TOKEN);
}
