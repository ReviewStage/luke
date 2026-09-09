import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The agent's identity workspace: a directory of Markdown files the agent
 * reads at the start of every prompt and may edit through its workspace
 * tools. The files are seeded once, when missing, from the seeds the product
 * supplies — this package knows the files' names and bounds, never their
 * words — and never rewritten by an upgrade: a user's edit to SOUL.md is the
 * user's, and a new build that disagreed would be overwriting a decision. Daily notes live under
 * `memory/` as one file per day; they are never appended to an ordinary
 * prompt, only retrieved when asked for and primed once when a conversation
 * starts fresh. Nothing here touches a provider's transcript or session
 * state: the workspace is Luke's own directory under his own application
 * data, and the tools bounded to it can name nothing outside it.
 */

export const WORKSPACE_FILE = {
  AGENTS: "AGENTS.md",
  SOUL: "SOUL.md",
  IDENTITY: "IDENTITY.md",
  USER: "USER.md",
  MEMORY: "MEMORY.md",
  BOOTSTRAP: "BOOTSTRAP.md",
} as const;

export type WorkspaceFile = (typeof WORKSPACE_FILE)[keyof typeof WORKSPACE_FILE];

/** The bootstrap files in the order the prompt injects them, from OpenClaw `b7528507` (`docs/concepts/system-prompt.md`). */
export const BOOTSTRAP_FILE_ORDER: readonly WorkspaceFile[] = [
  WORKSPACE_FILE.AGENTS,
  WORKSPACE_FILE.SOUL,
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

const WORKSPACE_FILE_LIST: readonly string[] = Object.values(WORKSPACE_FILE);

export function isWorkspaceFile(name: string): name is WorkspaceFile {
  return WORKSPACE_FILE_LIST.includes(name);
}

export interface WorkspaceSeeding {
  readonly directory: string;
  /** The files written because they were missing; an existing file, edited or not, is never listed. */
  readonly seeded: readonly WorkspaceFile[];
}

/** What each file holds when the workspace is first made. */
export type WorkspaceSeeds = Readonly<Record<WorkspaceFile, string>>;

/**
 * Creates the workspace directory and every missing file. A file that
 * exists is left exactly as it is, whatever it says and whichever build
 * wrote it: the seed is written with the exclusive flag, and the refusal of
 * an existing file is the whole check.
 */
export async function seedWorkspace(
  directory: string,
  seeds: WorkspaceSeeds,
): Promise<WorkspaceSeeding> {
  await fs.mkdir(path.join(directory, DAILY_NOTES_DIRECTORY), { recursive: true, mode: 0o700 });
  const seeded: WorkspaceFile[] = [];
  for (const name of Object.values(WORKSPACE_FILE)) {
    const file = path.join(directory, name);
    try {
      await fs.writeFile(file, seeds[name], { flag: "wx", mode: 0o600 });
      seeded.push(name);
    } catch (error) {
      // SAFETY: fs rejects with an ErrnoException; only its code is read, and any other error is rethrown.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return { directory, seeded };
}

/** One bootstrap file as the prompt receives it: its text within the bounds, and what the bounds did to it. */
export interface BootstrapFile {
  readonly name: WorkspaceFile;
  readonly path: string;
  readonly content: string;
  readonly missing: boolean;
  /** How many characters the file held before the per-file or total bound cut it; equal to the content's length when uncut. */
  readonly originalChars: number;
  readonly truncated: boolean;
}

async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    // SAFETY: fs rejects with an ErrnoException; only its code is read, and any other error is rethrown.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Applies the bounds to files already read, in order: each file is cut to
 * the per-file bound from its end, and once the running total reaches the
 * total bound the rest of that file and every file after it are cut, each
 * still listed so the prompt can say which. A missing file is listed as
 * missing with no content; BOOTSTRAP.md is meant to go missing once setup
 * is done, and its absence is not a diagnostic.
 */
export function boundBootstrapFiles(
  files: readonly { name: WorkspaceFile; path: string; content: string | undefined }[],
): readonly BootstrapFile[] {
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
    const perFile = file.content.slice(0, BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE);
    const content = perFile.slice(0, Math.max(0, remaining));
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

/** Reads the named bootstrap files from the workspace and bounds them. */
export async function readBootstrapFiles(
  directory: string,
  names: readonly WorkspaceFile[] = BOOTSTRAP_FILE_ORDER,
): Promise<readonly BootstrapFile[]> {
  const read = await Promise.all(
    names.map(async (name) => {
      const file = path.join(directory, name);
      return { name, path: file, content: await readIfPresent(file) };
    }),
  );
  return boundBootstrapFiles(read);
}

const DAILY_NOTE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:-[a-z0-9-]+)?\.md$/u;

function dayStamp(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

/** A daily note's file name for the day, or for a slugged variant of it. */
export function dailyNoteName(atMs: number, slug?: string): string {
  return `${dayStamp(atMs)}${slug ? `-${slug}` : ""}.md`;
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

/**
 * Today's and yesterday's notes, slugged variants included, for priming a
 * conversation that just started fresh. Read only when asked: an ordinary
 * turn never sees them.
 */
export async function recentDailyNotes(
  directory: string,
  now: number,
): Promise<readonly DailyNote[]> {
  const notes = path.join(directory, DAILY_NOTES_DIRECTORY);
  let names: string[];
  try {
    names = await fs.readdir(notes);
  } catch {
    return [];
  }
  const days = new Set([dayStamp(now), dayStamp(now - 24 * 60 * 60 * 1000)]);
  const eligible = names
    .filter((name) => {
      const match = DAILY_NOTE_PATTERN.exec(name);
      return match !== null && days.has(name.slice(0, 10));
    })
    .sort();
  const read: DailyNote[] = [];
  let remaining = BOOTSTRAP_BOUNDS.MAXIMUM_TOTAL_CHARS;
  for (const name of eligible) {
    const file = path.join(notes, name);
    const content = await readIfPresent(file);
    if (content === undefined) continue;
    const cut = content.slice(
      0,
      Math.min(BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE, Math.max(0, remaining)),
    );
    remaining -= cut.length;
    read.push({ name, path: file, content: cut });
  }
  return read;
}

export const WORKSPACE_FILE_REFUSAL = {
  OUTSIDE_WORKSPACE: "not a workspace file",
  TOO_LARGE: "the content exceeds the per-file bound",
  NOT_FOUND: "no such workspace file",
} as const;

/**
 * Resolves a name the agent gave to a file inside the workspace, or nothing:
 * one of the fixed bootstrap files, or a daily note under
 * `memory/` named by the day's pattern. A path that escapes the directory,
 * names anything else, or carries a separator the pattern does not allow
 * is refused, so the workspace tools can reach nothing but the workspace.
 */
export function workspaceFilePath(directory: string, name: string): string | undefined {
  if (isWorkspaceFile(name)) return path.join(directory, name);
  const prefix = `${DAILY_NOTES_DIRECTORY}/`;
  if (!name.startsWith(prefix)) return undefined;
  const note = name.slice(prefix.length);
  if (!DAILY_NOTE_PATTERN.test(note)) return undefined;
  const resolved = path.resolve(directory, DAILY_NOTES_DIRECTORY, note);
  const root = path.resolve(directory, DAILY_NOTES_DIRECTORY);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : undefined;
}

export type WorkspaceReadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: string };

export type WorkspaceWriteResult =
  | { readonly ok: true; readonly chars: number }
  | { readonly ok: false; readonly reason: string };

/** Reads one workspace file for the agent, bounded like a bootstrap file. */
export async function readWorkspaceFile(
  directory: string,
  name: string,
): Promise<WorkspaceReadResult> {
  const file = workspaceFilePath(directory, name);
  if (!file) return { ok: false, reason: WORKSPACE_FILE_REFUSAL.OUTSIDE_WORKSPACE };
  const content = await readIfPresent(file);
  if (content === undefined) return { ok: false, reason: WORKSPACE_FILE_REFUSAL.NOT_FOUND };
  return { ok: true, content: content.slice(0, BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE) };
}

/** Writes one workspace file whole for the agent; a content past the per-file bound is refused rather than cut. */
export async function writeWorkspaceFile(
  directory: string,
  name: string,
  content: string,
): Promise<WorkspaceWriteResult> {
  const file = workspaceFilePath(directory, name);
  if (!file) return { ok: false, reason: WORKSPACE_FILE_REFUSAL.OUTSIDE_WORKSPACE };
  if (content.length > BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE) {
    return { ok: false, reason: WORKSPACE_FILE_REFUSAL.TOO_LARGE };
  }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, { mode: 0o600 });
  await fs.rename(temporary, file);
  return { ok: true, chars: content.length };
}
