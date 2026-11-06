import { DICTATION_BOUNDS } from "./dictation-wire.js";

const PATH_PATTERN = /[\w.@-]+(?:\/[\w.@-]+)+/gu;

const FILE_PATTERN =
  /\b[\w-]+\.(?:[cm]?[jt]sx?|json|md|css|html|ya?ml|toml|sql|sh|swift|py|go|rs)\b/gu;

const REFUSED_CHARACTER = /[<>\r\n]/u;

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
