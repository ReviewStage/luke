import { diffArrays } from "diff";

const MAX_READ_TOKENS = 4_000;

const TOKEN =
  /!\[(?:\\.|[^\]\\\n]){0,1000}\]\((?:\\.|\([^()\s]{0,2000}\)|[^()\\\n]){0,2000}\)|\n|[^\S\n]|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

function tokens(words: string): readonly string[] {
  return words.match(TOKEN) ?? [];
}

export interface WordChange {
  readonly words: string;
  readonly added: boolean;
  readonly removed: boolean;
}

export function wordChanges(old: string, next: string): readonly WordChange[] {
  if (old === next) return old === "" ? [] : [{ words: old, added: false, removed: false }];
  const changes = diffArrays([...tokens(old)], [...tokens(next)], {
    maxEditLength: MAX_READ_TOKENS,
  });
  if (changes === undefined) {
    return [
      { words: old, added: false, removed: true },
      { words: next, added: true, removed: false },
    ].filter((change) => change.words !== "");
  }
  return changes.map((change) => ({
    words: change.value.join(""),
    added: change.added,
    removed: change.removed,
  }));
}
