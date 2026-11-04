/**
 * words-task-name.ts -- the name a task made for someone's words is given: their first line, raised and cut near a bound.
 *
 * A task `start_agent` makes for the agent a caller on no task starts is
 * named for the prompt it was handed, since no one names it by hand.
 */

/** The most characters of the first line a task is named with, cut at a word where one ends near it. */
const TASK_NAME_CHARS = 80;

/**
 * What the task is named: the first line of the words with any, its
 * spaces collapsed and its first letter raised, as a sentence-case title
 * opens, cut to the bound at the last word that fits; empty where there are
 * none, which leaves the task untitled until its agent's title names it.
 */
export function taskNameOfWords(text: string): string {
  const line =
    text
      .split("\n")
      .map((each) => each.replace(/\s+/gu, " ").trim())
      .find((each) => each !== "") ?? "";
  const raised = `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
  if (raised.length <= TASK_NAME_CHARS) return raised;
  const cut = raised.slice(0, TASK_NAME_CHARS - 1);
  const word = cut.lastIndexOf(" ");
  return `${(word > TASK_NAME_CHARS / 2 ? cut.slice(0, word) : cut).trimEnd()}…`;
}
