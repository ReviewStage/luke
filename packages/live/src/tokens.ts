/**
 * The one token estimate every bound in this package is measured by. The Live
 * API bounds an append at 500 tokens and the startup history at 8,192, and
 * it counts them with a tokenizer this build does not carry, so the bounds
 * are held against a conservative estimate rather than left to the service
 * to refuse: four characters to a token is how the rest of the repository
 * estimates too, and an estimate that errs high keeps a bounded value under
 * the real bound.
 */
export const ESTIMATED_CHARS_PER_TOKEN = 4;

export function estimatedTokens(text: string): number {
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}
