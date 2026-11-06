/**
 * token-estimate.ts -- a step's estimate of a text's tokens, the bytes of its JSON over four, kept in a module of its own so a route may read it.
 *
 * The runner events route (`../native-events/runner-events-app.ts`)
 * estimates a native step's brief with it, the rule the retired runtime's
 * steps' instructions, tools, and brief were estimated by.
 */

/** The bytes a token stands for in a step's estimate. */
const BYTES_PER_TOKEN = 4;

/** The tokens of a value's JSON as a step's estimate tells them: its bytes over four, rounded up. */
export function estimatedTokens(json: string): number {
  return Math.ceil(new TextEncoder().encode(json).byteLength / BYTES_PER_TOKEN);
}
