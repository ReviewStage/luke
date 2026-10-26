/**
 * workspace-key.ts -- the key a window names a workspace's numbered thing by: its workspace's prefix and its number, as `ACME-42`; and the words that name a thing among other words, a task by its key and a channel by its name, `#app`.
 *
 * The prefix is read off the workspace's name rather than kept, so it
 * follows a rename: the initials of a name of several words, or the head of
 * a name of one, upper-cased, so "Acme" is ACME and "Luke Labs" is LL. A
 * task's number is its workspace's, counted from one and never reused, so
 * its key names one task of the workspace for good.
 */

/** The prefix a task's key falls back on where the workspace's name holds no letter or digit. */
const TASK_FALLBACK_PREFIX = "TASK";

/** The most characters a prefix spells. */
const MAX_PREFIX_CHARS = 4;

/** The prefix a workspace's tasks are keyed by, or `TASK_FALLBACK_PREFIX` where its name holds no letter or digit. */
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

/** A task's key in its workspace, as `ACME-42`. */
export function taskKey(workspaceName: string, number: number): string {
  return `${workspacePrefix(workspaceName)}-${number}`;
}

/**
 * What may be a task's key among words: up to four capitals or digits, a
 * hyphen, and a number, standing as a word of its own. Note that a key in a
 * path or an address, before it or after it (`docs/STAG-1`, `STAG-1/notes`,
 * `STAG-1.md`, `#STAG-1`, `STAG-1#plan`), or one joined to more words
 * (`STAG-1-fix`) is no key, while a sentence's stop after one is no word, and that the case is held to, since the
 * keys are capitals and words in prose that happen to share their letters
 * are not keys.
 */
const KEY_IN_WORDS =
  /(?<![\p{L}\p{N}_\-/.#@])[\p{Lu}\p{N}]{1,4}-\d+(?![\p{L}\p{N}_/#]|[-.][\p{L}\p{N}])/gu;

/**
 * What may be a channel's name among words: `#` and a channel's name,
 * lowercase words joined by hyphens, standing as a word of its own, on the
 * same terms as a key: one in a path or an address (`docs/#app`,
 * `page#app`), or joined to more words, is none.
 */
const CHANNEL_IN_WORDS =
  /(?<![\p{L}\p{N}_\-/.#@&])#[a-z0-9]+(?:-[a-z0-9]+)*(?![\p{L}\p{N}_/#]|[-.][\p{L}\p{N}])/gu;

/** One key found among words: the key, and where it stands in them. */
export interface KeySpan<Known> {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly known: Known;
}

/**
 * Each task's key and each channel's name, `#app`, that `known` holds
 * standing among the words, in order; a word shaped like either that
 * `known` does not hold, `UTF-8` or `#1` say, is left as words.
 */
export function keySpansIn<Known>(
  words: string,
  known: ReadonlyMap<string, Known>,
): readonly KeySpan<Known>[] {
  const spans: KeySpan<Known>[] = [];
  for (const match of [...words.matchAll(KEY_IN_WORDS), ...words.matchAll(CHANNEL_IN_WORDS)]) {
    const held = known.get(match[0]);
    if (held === undefined) continue;
    spans.push({
      key: match[0],
      start: match.index,
      end: match.index + match[0].length,
      known: held,
    });
  }
  return spans.toSorted((one, other) => one.start - other.start);
}

/** Whether the words typed are a task's key whole, as `stag-422` is STAG-422: the case and the space around them aside. */
export function namesTaskKey(words: string, key: string): boolean {
  return words.trim().toLocaleUpperCase() === key;
}
