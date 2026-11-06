const TASK_FALLBACK_PREFIX = "TASK";

const MAX_PREFIX_CHARS = 4;

function workspacePrefix(workspaceName: string): string {
  const words = workspaceName
    .replaceAll(/['’]/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) return TASK_FALLBACK_PREFIX;
  const prefix =
    words.length === 1
      ? Array.from(words[0] ?? "").slice(0, MAX_PREFIX_CHARS)
      : words.slice(0, MAX_PREFIX_CHARS).map((word) => Array.from(word)[0] ?? "");
  return prefix.join("").toLocaleUpperCase();
}

export function taskKey(workspaceName: string, number: number): string {
  return `${workspacePrefix(workspaceName)}-${number}`;
}

const KEY_IN_WORDS =
  /(?<![\p{L}\p{N}_\-/.#@])[\p{Lu}\p{N}]{1,4}-\d+(?![\p{L}\p{N}_/#]|[-.][\p{L}\p{N}])/gu;

export interface KeySpan<Known> {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly known: Known;
}

export function keySpansIn<Known>(
  words: string,
  known: ReadonlyMap<string, Known>,
): readonly KeySpan<Known>[] {
  const spans: KeySpan<Known>[] = [];
  for (const match of words.matchAll(KEY_IN_WORDS)) {
    const held = known.get(match[0]);
    if (held === undefined) continue;
    spans.push({
      key: match[0],
      start: match.index,
      end: match.index + match[0].length,
      known: held,
    });
  }
  return spans;
}

export function namesTaskKey(words: string, key: string): boolean {
  return words.trim().toLocaleUpperCase() === key;
}
