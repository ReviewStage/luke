const FENCE_LEAST = 3;

const BACKTICKS = /`+/gu;

export function fencedBlock(words: string, info: string): string {
  const longest = Math.max(0, ...[...words.matchAll(BACKTICKS)].map(([run]) => run.length));
  const fence = "`".repeat(Math.max(FENCE_LEAST, longest + 1));
  return `${fence}${info}\n${words}\n${fence}`;
}
