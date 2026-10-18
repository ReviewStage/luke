/**
 * patch-text.ts -- a model's patch, put in the shape eve's `apply_patch` parses where what it means is plain.
 *
 * eve's parser refuses two shapes a model writes often and whose meaning is
 * not in doubt. One is a patch whose file sections stand without the
 * `*** Begin Patch` and `*** End Patch` lines around them, or without one of
 * the two. The other names one file in two `*** Update File:` sections,
 * which eve refuses as overlapping file operations, though the model only
 * meant to change the file in two places. Here the missing marker is
 * supplied, and the sections updating one file are joined into the first of
 * them, their hunks in the order written, which is how eve applies the hunks
 * of a single section. A section that moves its file, and an Add or a Delete
 * beside another section for the same file, are left as written: what those
 * mean together is a guess, so eve's refusal stands. Anything else is left
 * as written too, and eve's own parser says what is wrong with it.
 */

const BEGIN_PATCH = "*** Begin Patch";
const END_PATCH = "*** End Patch";
const MOVE_TO = "*** Move to:";
const CHUNK = "@@";
/** A file section's header, as eve reads one: its operation and the path after the colon. */
const FILE_HEADER = /^\*\*\* (Add|Update|Delete) File:(.*)$/u;

/** A patch's text as eve is handed it, and the files whose update sections were joined into one. */
export interface PreparedPatch {
  readonly text: string;
  readonly joined: readonly string[];
}

/** A patch's lines after joining, and the files whose sections were joined. */
interface JoinedLines {
  readonly lines: string[];
  readonly joined: string[];
}

interface Section {
  readonly header: string;
  readonly body: string[];
}

/** The patch given, its markers supplied and its updates of one file joined, where either is needed. */
export function preparePatch(patchText: string): PreparedPatch {
  const lines = patchText.replaceAll("\r\n", "\n").split("\n");
  const marked = withMarkers(lines);
  const { lines: joinedLines, joined } = joiningUpdates(marked);
  if (marked === lines && joined.length === 0) return { text: patchText, joined };
  return { text: joinedLines.join("\n"), joined };
}

/**
 * The lines with the Begin and End markers a patch lacks, where its body
 * opens on a file section; the lines as given otherwise, so that eve
 * refuses what is not a patch.
 */
function withMarkers(lines: string[]): string[] {
  const begin = lines.findIndex((line) => line.trim() === BEGIN_PATCH);
  const end = lines.findIndex((line) => line.trim() === END_PATCH);
  if (begin !== -1 && end !== -1) return lines;
  const body = lines.findIndex((line, index) => index > begin && line.trim().length > 0);
  if (body === -1 || !FILE_HEADER.test(lines[body] ?? "")) return lines;
  const opened = begin === -1 ? [BEGIN_PATCH, ...lines] : lines;
  if (end !== -1) return opened;
  const last = opened.findLastIndex((line) => line.trim().length > 0);
  return [...opened.slice(0, last + 1), END_PATCH];
}

/** A section's path as eve resolves it, so two spellings of one file are one. */
function sectionPath(header: string): string | undefined {
  const match = FILE_HEADER.exec(header);
  if (match?.[1] !== "Update") return undefined;
  return (match[2] ?? "").trim().replaceAll("\\", "/");
}

/**
 * The lines with every later `*** Update File:` section of a file joined
 * into its first, where none of them moves the file. A later section's
 * hunks follow the first's; one that opens without an `@@` line is given
 * one, since eve reads only a section's first hunk without it.
 */
function joiningUpdates(lines: string[]): JoinedLines {
  const first = lines.findIndex((line) => FILE_HEADER.test(line));
  if (first === -1) return { lines, joined: [] };
  const prefix = lines.slice(0, first);
  const sections: Section[] = [];
  let index = first;
  while (index < lines.length && FILE_HEADER.test(lines[index] ?? "")) {
    const header = lines[index] ?? "";
    const body: string[] = [];
    index += 1;
    while (index < lines.length) {
      const line = lines[index] ?? "";
      if (FILE_HEADER.test(line) || line.trim() === END_PATCH) break;
      body.push(line);
      index += 1;
    }
    sections.push({ header, body });
  }
  const suffix = lines.slice(index);

  const moved = new Set<string>();
  for (const section of sections) {
    const path = sectionPath(section.header);
    if (path !== undefined && section.body[0]?.startsWith(MOVE_TO) === true) moved.add(path);
  }
  const firstOf = new Map<string, Section>();
  const kept: Section[] = [];
  const joined = new Set<string>();
  for (const section of sections) {
    const path = sectionPath(section.header);
    const into = path === undefined || moved.has(path) ? undefined : firstOf.get(path);
    if (path === undefined || into === undefined) {
      if (path !== undefined && !moved.has(path)) firstOf.set(path, section);
      kept.push(section);
      continue;
    }
    if (section.body[0]?.startsWith(CHUNK) !== true) into.body.push(CHUNK);
    into.body.push(...section.body);
    joined.add(path);
  }
  if (joined.size === 0) return { lines, joined: [] };
  return {
    lines: [...prefix, ...kept.flatMap((section) => [section.header, ...section.body]), ...suffix],
    joined: [...joined],
  };
}
