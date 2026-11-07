/**
 * experiment-words.ts -- what of a tool's words and input would tell an agent of Task descriptions, Pilot, or Memory, for a test that holds them to telling nothing of one that is off.
 */

/** Words that name Task descriptions, Pilot, or Memory to an agent: a task's description or its comments, a pilot, or the workspace's memory. */
const EXPERIMENT_WORDS =
  /\b(?:task's description|its description|the description|description's|descriptions?\b(?! of)|pilot|memor(?:y|ies))/iu;

/** Words that say the same of something else: a pull request's own description, and the conversation an automation's runs share. */
const ELSEWHERE_WORDS =
  /body its description in Markdown|adds nothing to the description|edit-description|an edit of the description|runs share its memory/gu;

/** Every string a value holds: a tool's description, and each description and string its JSON Schema names, keys aside. */
function wordsIn(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(wordsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(wordsIn);
  return [];
}

/** Each of the tools' words that names an experiment, as `<tool>: <words>`; none where none does. */
export function experimentWordsIn(
  tools: readonly {
    readonly name: string;
    readonly description?: string | undefined;
    readonly inputSchema: unknown;
  }[],
): readonly string[] {
  return tools.flatMap((tool) =>
    wordsIn({ description: tool.description, input: tool.inputSchema })
      .filter((words) => EXPERIMENT_WORDS.test(words.replace(ELSEWHERE_WORDS, "")))
      .map((words) => `${tool.name}: ${words}`),
  );
}
