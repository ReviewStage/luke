/**
 * markdown-fence.ts -- words fenced as a Markdown code block that nothing inside can close: its fence a backtick longer than any run of them in the words, and never shorter than three.
 */

/** The fewest backticks a fence is written with. */
const FENCE_LEAST = 3;

/** A run of backticks. */
const BACKTICKS = /`+/gu;

/** The words as a fenced block whose opening fence names `info`, its fence longer than any run of backticks they hold. */
export function fencedBlock(words: string, info: string): string {
  const longest = Math.max(0, ...[...words.matchAll(BACKTICKS)].map(([run]) => run.length));
  const fence = "`".repeat(Math.max(FENCE_LEAST, longest + 1));
  return `${fence}${info}\n${words}\n${fence}`;
}
