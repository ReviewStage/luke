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

/**
 * The startup history is held under a stricter estimate than an append,
 * because it is the one bound a session is refused its creation over and the
 * one whose text is whatever was said or written: three ASCII characters to
 * a token, which code and Markdown punctuation come near and prose stays well
 * over, and every other UTF-16 unit a token of its own, since a CJK character
 * or half an emoji is at least one where four characters to a token counted a
 * quarter.
 */
export const STARTUP_ASCII_CHARS_PER_TOKEN = 3;

const ASCII_LIMIT = 0x80;

function startupCost(ascii: number, other: number): number {
  return Math.ceil(ascii / STARTUP_ASCII_CHARS_PER_TOKEN) + other;
}

/** The startup history's estimate of one message's text. */
export function startupTokens(text: string): number {
  let ascii = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) < ASCII_LIMIT) ascii += 1;
  }
  return startupCost(ascii, text.length - ascii);
}

/**
 * The longest start of `text` the startup estimate holds within `tokens`,
 * never ending between the two halves of a surrogate pair.
 */
export function startupPrefix(text: string, tokens: number): string {
  let ascii = 0;
  let other = 0;
  let end = 0;
  while (end < text.length) {
    const code = text.charCodeAt(end);
    const isAscii = code < ASCII_LIMIT;
    if (startupCost(ascii + (isAscii ? 1 : 0), other + (isAscii ? 0 : 1)) > tokens) break;
    if (isAscii) ascii += 1;
    else other += 1;
    end += 1;
  }
  const last = text.charCodeAt(end - 1);
  const splitsPair = end > 0 && end < text.length && last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, splitsPair ? end - 1 : end);
}
