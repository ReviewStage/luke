/**
 * The agent's identity workspace: a directory of Markdown files the agent
 * reads at the start of every prompt and may edit through its workspace
 * tools. The files are seeded once, when missing, from the seeds the product
 * supplies — this package knows the files' names and bounds, never their
 * words — and never rewritten by an upgrade: a user's edit to AGENTS.md is the
 * user's, and a new build that disagreed would be overwriting a decision. Daily notes live under
 * `memory/` as one file per day; they are never appended to an ordinary
 * prompt, only retrieved when asked for and primed once when a conversation
 * starts fresh. Nothing here touches a provider's transcript or session
 * state: the workspace is Luke's own directory under his own application
 * data, and the tools bounded to it can name nothing outside it.
 */

export const WORKSPACE_FILE = {
  AGENTS: "AGENTS.md",
  IDENTITY: "IDENTITY.md",
  USER: "USER.md",
  MEMORY: "MEMORY.md",
  BOOTSTRAP: "BOOTSTRAP.md",
} as const;

export type WorkspaceFile = (typeof WORKSPACE_FILE)[keyof typeof WORKSPACE_FILE];

/** The bootstrap files in the order the prompt injects them, from OpenClaw `b7528507` (`docs/concepts/system-prompt.md`). */
export const BOOTSTRAP_FILE_ORDER: readonly WorkspaceFile[] = [
  WORKSPACE_FILE.AGENTS,
  WORKSPACE_FILE.IDENTITY,
  WORKSPACE_FILE.USER,
  WORKSPACE_FILE.BOOTSTRAP,
  WORKSPACE_FILE.MEMORY,
];

/** The one file a child's minimal bootstrap carries. */
export const CHILD_BOOTSTRAP_FILES: readonly WorkspaceFile[] = [WORKSPACE_FILE.AGENTS];

export const DAILY_NOTES_DIRECTORY = "memory";

export const BOOTSTRAP_BOUNDS = {
  MAXIMUM_CHARS_PER_FILE: 20_000,
  MAXIMUM_TOTAL_CHARS: 60_000,
} as const;

/**
 * The curated core's own budgets, from OpenClaw's memory architecture
 * (`docs/concepts/memory-architecture.md`): USER.md and MEMORY.md are the two
 * small files the agent keeps current by hand and the prompt injects whole,
 * each under a budget of its own well inside the instruction files' per-file
 * bound, so a fact or a decision worth carrying is condensed rather than
 * piled up, and detail goes to the dated notes under `memory/`.
 */
export const CURATED_FILE_BUDGET = {
  [WORKSPACE_FILE.USER]: 4_000,
  [WORKSPACE_FILE.MEMORY]: 4_000,
} as const;

/**
 * The most characters one workspace file may hold as the prompt reads it and
 * the writer lets it stand: the curated budget for USER.md and MEMORY.md, the
 * per-file bound for every other file and for a dated note.
 */
export function workspaceFileBound(name: string): number {
  if (name === WORKSPACE_FILE.USER || name === WORKSPACE_FILE.MEMORY) {
    return CURATED_FILE_BUDGET[name];
  }
  return BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE;
}

const WORKSPACE_FILE_LIST: readonly string[] = Object.values(WORKSPACE_FILE);

/** Whether a name is one of the bootstrap files, and so a path the workspace tools may name directly. */
export function isWorkspaceFile(name: string): name is WorkspaceFile {
  return WORKSPACE_FILE_LIST.includes(name);
}

/** What each file holds when the workspace is first made. */
export type WorkspaceSeeds = Readonly<Record<WorkspaceFile, string>>;

/** One bootstrap file as the prompt receives it: its text within the bounds, and what the bounds did to it. A dated note bounded the same way names itself by its file name. */
export interface BootstrapFile<Name extends string = WorkspaceFile> {
  readonly name: Name;
  readonly path: string;
  readonly content: string;
  readonly missing: boolean;
  /** How many characters the file held before its own or the total bound cut it; equal to the content's length when uncut. */
  readonly originalChars: number;
  readonly truncated: boolean;
}

/**
 * Applies the bounds to files already read, in order: each file is cut to
 * its own bound from its end, and once the running total reaches the
 * total bound the rest of that file and every file after it are cut, each
 * still listed so the prompt can say which. A missing file is listed as
 * missing with no content; BOOTSTRAP.md is meant to go missing once setup
 * is done, and its absence is not a diagnostic.
 */
export function boundBootstrapFiles<Name extends string>(
  files: readonly { name: Name; path: string; content: string | undefined }[],
): readonly BootstrapFile<Name>[] {
  let remaining = BOOTSTRAP_BOUNDS.MAXIMUM_TOTAL_CHARS;
  return files.map((file) => {
    if (file.content === undefined) {
      return {
        name: file.name,
        path: file.path,
        content: "",
        missing: true,
        originalChars: 0,
        truncated: false,
      };
    }
    const ownBound = file.content.slice(0, workspaceFileBound(file.name));
    const content = ownBound.slice(0, Math.max(0, remaining));
    remaining -= content.length;
    return {
      name: file.name,
      path: file.path,
      content,
      missing: false,
      originalChars: file.content.length,
      truncated: content.length < file.content.length,
    };
  });
}

const DAILY_NOTE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:-[a-z0-9-]+)?\.md$/u;

/** The UTC calendar day an instant falls on, `YYYY-MM-DD`, as a daily note's name spells it. */
export function dailyNoteDay(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

/** A daily note's file name for the day, or for a slugged variant of it. */
export function dailyNoteName(atMs: number, slug?: string): string {
  return `${dailyNoteDay(atMs)}${slug ? `-${slug}` : ""}.md`;
}

/** The day's note as the workspace tools name it, `memory/YYYY-MM-DD.md`, the day being the instant's UTC calendar day. */
export function dailyNotePath(atMs: number): string {
  return `${DAILY_NOTES_DIRECTORY}/${dailyNoteName(atMs)}`;
}

const DAILY_NOTES_PREFIX = `${DAILY_NOTES_DIRECTORY}/`;

/** Whether a name the agent gave is a dated note under `memory/`, slugged variants included. */
export function isDailyNotePath(name: string): boolean {
  return (
    name.startsWith(DAILY_NOTES_PREFIX) &&
    parseDailyNoteName(name.slice(DAILY_NOTES_PREFIX.length)) !== undefined
  );
}

/**
 * A dated note with an entry appended: the entry alone where no note stands
 * or the note held nothing, otherwise the note as it stands with its
 * trailing whitespace dropped, a blank line, and the entry. Nothing already
 * written is reordered or cut; the per-file bound is the caller's to check
 * against the length this answers.
 */
export function appendedDailyNote(existing: string | undefined, entry: string): string {
  const standing = existing?.trimEnd() ?? "";
  return standing.length === 0 ? entry : `${standing}\n\n${entry}`;
}

/** The day a daily note's file name is about, `YYYY-MM-DD`, or nothing for a name that is not a daily note's. */
export function parseDailyNoteName(name: string): { readonly day: string } | undefined {
  const match = DAILY_NOTE_PATTERN.exec(name);
  return match ? { day: `${match[1]}-${match[2]}-${match[3]}` } : undefined;
}

export interface DailyNote {
  readonly name: string;
  readonly path: string;
  readonly content: string;
}

export const WORKSPACE_FILE_REFUSAL = {
  OUTSIDE_WORKSPACE: "not a workspace file",
  TOO_LARGE: "the content exceeds the file's bound",
  NOT_FOUND: "no such workspace file",
  /** A dated note is grown by appending, never replaced whole; the refusal names the tool that grows it. */
  DAILY_NOTE_REWRITE:
    "not run: a dated note under memory/ is appended to with append_daily_note, never rewritten whole",
} as const;

/**
 * The refusal of a write past a file's bound, naming the bound in characters
 * so the writer can read the file back, condense it, and rewrite it to fit;
 * nothing of the refused content is written.
 */
export function tooLargeRefusal(bound: number): string {
  return `${WORKSPACE_FILE_REFUSAL.TOO_LARGE} of ${bound} characters; read it back, condense, and rewrite to fit`;
}

/** One dated note as a listing names it: its path under `memory/` and how many characters it holds, never a word of it. */
export interface DailyNoteListing {
  readonly path: string;
  readonly chars: number;
}
