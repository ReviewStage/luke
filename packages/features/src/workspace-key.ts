/**
 * workspace-key.ts -- the key a window names a workspace's numbered thing by: its workspace's prefix and its number, as `ACME-42`.
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
