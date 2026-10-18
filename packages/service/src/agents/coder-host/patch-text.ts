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
 * of a single section. eve seeks each hunk only after the one before it, so
 * they are joined only where every later section's first hunk finds no
 * earlier place in the file than where the sections before it end: a later
 * section aimed above an earlier one could otherwise land on a repeat of its
 * lines further down. A section that moves its file, and an Add or a Delete
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

/** A file's text by its path in the patch, or null where there is none. */
export type ReadPatchFile = (path: string) => PromiseLike<string | null>;

/** The patch given, its markers supplied and its updates of one file joined, where either is needed. */
export async function preparePatch(patchText: string, read: ReadPatchFile): Promise<PreparedPatch> {
  const lines = patchText.replaceAll("\r\n", "\n").split("\n");
  const marked = withMarkers(lines);
  const { lines: joinedLines, joined } = await joiningUpdates(marked, read);
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

/** Whether eve would take the path as one inside the checkout, so reading it here reads only what eve would. */
function isPatchPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/**
 * The lines with every later `*** Update File:` section of a file joined
 * into its first, where none of them moves the file and the sections are
 * written top to bottom. A later section's hunks follow the first's; one
 * that opens without an `@@` line is given one, since eve reads only a
 * section's first hunk without it.
 */
async function joiningUpdates(lines: string[], read: ReadPatchFile): Promise<JoinedLines> {
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

  const byPath = new Map<string, Section[]>();
  const moved = new Set<string>();
  for (const section of sections) {
    const path = sectionPath(section.header);
    if (path === undefined) continue;
    if (section.body[0]?.startsWith(MOVE_TO) === true) moved.add(path);
    byPath.set(path, [...(byPath.get(path) ?? []), section]);
  }
  const joinable = new Set<string>();
  for (const [path, updates] of byPath) {
    if (updates.length < 2 || moved.has(path) || !isPatchPath(path)) continue;
    const contents = await read(path);
    if (contents !== null && inFileOrder(contents, updates)) joinable.add(path);
  }
  if (joinable.size === 0) return { lines, joined: [] };

  const firstOf = new Map<string, Section>();
  const kept: Section[] = [];
  for (const section of sections) {
    const path = sectionPath(section.header);
    if (path === undefined || !joinable.has(path)) {
      kept.push(section);
      continue;
    }
    const into = firstOf.get(path);
    if (into === undefined) {
      const copy = { header: section.header, body: [...section.body] };
      firstOf.set(path, copy);
      kept.push(copy);
      continue;
    }
    if (section.body[0]?.startsWith(CHUNK) !== true) into.body.push(CHUNK);
    into.body.push(...section.body);
  }
  return {
    lines: [...prefix, ...kept.flatMap((section) => [section.header, ...section.body]), ...suffix],
    joined: [...joinable],
  };
}

/** One hunk of a section, as eve seeks it: its `@@` context line, where it names one, and the lines it replaces. */
interface Hunk {
  readonly context: string | undefined;
  readonly old: readonly string[];
}

/** A section's hunks as eve parses them, the first of which may open without an `@@` line. */
function hunksOf(body: readonly string[]): Hunk[] {
  const hunks: { context: string | undefined; old: string[] }[] = [];
  for (const line of body) {
    if (line.startsWith(CHUNK)) {
      hunks.push({ context: line.slice(CHUNK.length).trim() || undefined, old: [] });
      continue;
    }
    if (hunks.length === 0) hunks.push({ context: undefined, old: [] });
    const hunk = hunks.at(-1);
    if (hunk === undefined || line.startsWith("+") || line.startsWith("***")) continue;
    // A blank line is context, as eve reads it; a context or removed line drops its one-character prefix.
    hunk.old.push(line === "" ? "" : line.slice(1));
  }
  return hunks.map(({ context, old }) => ({
    context,
    // eve retries a hunk without its last line where that line is blank, so it is no anchor here.
    old: old.at(-1) === "" ? old.slice(0, -1) : old,
  }));
}

/** The first place at or after `from` where the lines stand in the file, compared without surrounding whitespace, or -1. */
function seekFrom(file: readonly string[], lines: readonly string[], from: number): number {
  if (lines.length === 0) return -1;
  for (let at = from; at <= file.length - lines.length; at += 1) {
    if (lines.every((line, offset) => file[at + offset]?.trim() === line.trim())) return at;
  }
  return -1;
}

/**
 * Whether the sections, joined, seek what each was written for: every hunk
 * is found where eve's forward cursor would look for it, and no later
 * section's first hunk also stands above the place the sections before it
 * end, where that section may have meant it.
 */
function inFileOrder(contents: string, updates: readonly Section[]): boolean {
  const file = contents.replaceAll("\r\n", "\n").split("\n");
  let cursor = 0;
  for (const [order, section] of updates.entries()) {
    for (const [place, hunk] of hunksOf(section.body).entries()) {
      const anchor = hunk.context === undefined ? hunk.old : [hunk.context];
      if (order > 0 && place === 0 && anchor.length > 0 && seekFrom(file, anchor, 0) < cursor)
        return false;
      if (hunk.context !== undefined) {
        const at = seekFrom(file, [hunk.context], cursor);
        if (at === -1) return false;
        cursor = at + 1;
      }
      if (hunk.old.length === 0) continue;
      const at = seekFrom(file, hunk.old, cursor);
      if (at === -1) return false;
      cursor = at + hunk.old.length;
    }
  }
  return true;
}
