import { DICTATION_BOUNDS } from "./dictation-wire.js";

/**
 * dictation-keywords.ts -- the words a dictated clip is likely to say, read off the task it is about: what tells the transcription model to spell "pnpm" rather than hear "P N P M".
 *
 * The repository's full name and its own name, the task's title, and the
 * paths and file names the task's document spells, in that order and each
 * once, held to the wire's bounds: one line, no angle bracket, a hundred
 * characters, fifty words. A word past a bound is left out rather than cut,
 * because half a path is a word nobody says.
 */

/** A path the plan spells: two segments or more, as `apps/web/server` or `src/index.ts`. */
const PATH_PATTERN = /[\w.@-]+(?:\/[\w.@-]+)+/gu;

/** A file the plan names on its own, as `vercel.json` or `use-dictation.ts`. */
const FILE_PATTERN =
  /\b[\w-]+\.(?:[cm]?[jt]sx?|json|md|css|html|ya?ml|toml|sql|sh|swift|py|go|rs)\b/gu;

/** What the wire refuses in a word: a line break, or an angle bracket. */
const REFUSED_CHARACTER = /[<>\r\n]/u;

/** The words to listen for: the repository, the title, then what the document names, each once and within the bounds. */
export function dictationKeywords(input: {
  readonly repository: string | null;
  readonly title: string | undefined;
  readonly body: string | undefined;
}): readonly string[] {
  const named = [
    input.repository ?? "",
    input.repository?.split("/").at(-1) ?? "",
    input.title ?? "",
    ...(input.body?.match(PATH_PATTERN) ?? []),
    ...(input.body?.match(FILE_PATTERN) ?? []),
  ];
  const kept = new Set<string>();
  for (const word of named) {
    const trimmed = word.trim();
    if (trimmed === "" || trimmed.length > DICTATION_BOUNDS.MAX_KEYWORD_CHARS) continue;
    if (REFUSED_CHARACTER.test(trimmed)) continue;
    kept.add(trimmed);
    if (kept.size === DICTATION_BOUNDS.MAX_KEYWORDS) break;
  }
  return [...kept];
}
