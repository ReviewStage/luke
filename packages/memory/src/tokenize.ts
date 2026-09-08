/**
 * The CJK-aware tokenizer and Jaccard similarity the MMR re-ranking reads,
 * ported from OpenClaw `b7528507` (`extensions/memory-core/src/memory/tokenize.ts`).
 */

const CJK_RE = /[぀-ゟ゠-ヿ㐀-䶿一-鿿가-힯ᄀ-ᇿ]/u;

export function tokenize(text: string): Set<string> {
  const lower = text.toLowerCase();
  const ascii = lower.match(/[a-z0-9_]+/g) ?? [];
  const chars = Array.from(lower);
  const cjk: { char: string; index: number }[] = [];
  chars.forEach((char, index) => {
    if (CJK_RE.test(char)) cjk.push({ char, index });
  });
  const bigrams: string[] = [];
  for (let i = 1; i < cjk.length; i += 1) {
    const previous = cjk[i - 1];
    const next = cjk[i];
    if (previous && next && next.index === previous.index + 1) {
      bigrams.push(previous.char + next.char);
    }
  }
  return new Set([...ascii, ...bigrams, ...cjk.map((entry) => entry.char)]);
}

export function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  let intersection = 0;
  for (const token of smaller) if (larger.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Jaccard over tokens, falling back to exact equality when neither side tokenizes at all. */
export function textSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) {
    return left.toLowerCase() === right.toLowerCase() ? 1 : 0;
  }
  return jaccardSimilarity(leftTokens, rightTokens);
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "with",
  "this",
  "from",
  "have",
  "will",
  "your",
  "about",
  "into",
  "there",
  "their",
  "they",
  "them",
  "then",
  "than",
  "what",
  "when",
  "which",
  "would",
  "could",
  "should",
  "these",
  "those",
  "were",
  "been",
  "being",
  "also",
  "just",
  "like",
  "only",
  "over",
  "some",
  "such",
  "very",
  "more",
  "most",
  "much",
  "every",
  "because",
  "while",
  "where",
  "after",
  "before",
  "does",
  "done",
  "doing",
  "luke",
]);

/** Up to three concept tags: the longest distinct words that are not stop words. */
export function conceptTags(text: string, limit = 3): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const token of tokenize(text)) {
    if (token.length < 4 || STOP_WORDS.has(token) || /^\d+$/u.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    words.push(token);
  }
  return words.sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, limit);
}

const BULLET = /^[-*+]\s+/u;

/** The line without its leading Markdown bullet, when it has one. */
export function stripBullet(line: string): string {
  return line.replace(BULLET, "");
}
