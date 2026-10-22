/**
 * skill-paste.ts -- what a member pasted into the Add skill box, read as what to install.
 *
 * The box takes either a `skills add` command, as the `skills` command-line
 * tool's README and skills.sh print one (`npx skills add owner/repo --skill
 * name`), or a skill's own text. Luke never runs the command: it reads it
 * for the GitHub repository, the ref and folder where one is named, and
 * the skills asked for, and the service fetches the files itself. So the
 * desktop can say what it detected as the member types, and the service
 * reads the same paste again on install.
 *
 * A command names its runner or none (`npx`, `pnpx`, `pnpm dlx`, `bunx`,
 * `yarn dlx`, with `-y` where `npx` takes it), then `skills add` and a
 * source. The flags that place a skill in a local agent's folders (`-g`,
 * `-a`, `-y`, `--copy`, `-l`) mean nothing here and are passed over; scope
 * is the dialog's to choose. A source on any host but GitHub, over ssh, on
 * disk, or as a download is named unsupported, with a reason the window
 * words.
 *
 * Anything else is a skill's text, held to the convention's rules: its
 * frontmatter's name and description where it opens with one, and
 * otherwise a name suggested from its first heading and no description,
 * which the member fills in. What breaks a rule is listed as a problem
 * rather than refused, so the window can say what to fix.
 */

import { Schema } from "effect";
import { readSkillFile, SKILL_FILE_BOUNDS, SKILL_KEY, SKILL_NAME_RULE } from "./skill-file.js";
import { TASK_SKILL_BOUNDS } from "./task-wire.js";

/** What a paste was read as. */
export const SKILL_PASTE_KIND = {
  /** A `skills add` command naming a GitHub repository. */
  SOURCE: "source",
  /** A `skills add` command, or an address, naming what Luke does not install from. */
  UNSUPPORTED: "unsupported",
  /** A skill's own text. */
  TEXT: "text",
  /** Nothing but white space. */
  EMPTY: "empty",
} as const;

/** The hosts a source is read from. */
export const SKILL_SOURCE_HOST = {
  GITHUB: "github",
} as const;

/** Every skill a repository holds, as `--all` or `--skill '*'` asks. */
export const ALL_SKILLS = "all";

/** Why a command's source is not one Luke installs from. */
export const SKILL_PASTE_UNSUPPORTED = {
  /** A GitLab repository. */
  GITLAB: "gitlab",
  /** An Azure DevOps repository. */
  AZURE_DEVOPS: "azure-devops",
  /** A git repository on another host. */
  OTHER_HOST: "other-host",
  /** A repository named by an ssh address (`git@host:owner/repo`, `ssh://`). */
  SSH: "ssh",
  /** A folder on the member's own disk. */
  LOCAL_PATH: "local-path",
  /** An archive or other file to download. */
  DOWNLOAD_URL: "download-url",
  /** A `skills` command other than `add` (`skills find`, `skills list`). */
  OTHER_COMMAND: "other-command",
  /** A `skills add` command naming no source. */
  NO_SOURCE: "no-source",
  /** A source that names no repository Luke can read. */
  UNREADABLE_SOURCE: "unreadable-source",
} as const;

/** What a skill's text breaks of the convention. */
export const SKILL_TEXT_PROBLEM = {
  /** It names no skill, and no heading suggests one. */
  NAME_MISSING: "name-missing",
  /** Its name breaks the rule: lowercase letters and digits in words joined by single hyphens, at most 64. */
  NAME_INVALID: "name-invalid",
  /** It carries no description, which a model routes on. */
  DESCRIPTION_MISSING: "description-missing",
  /** Its description is longer than the convention allows. */
  DESCRIPTION_TOO_LONG: "description-too-long",
  /** It opens a frontmatter fence and never closes it. */
  FRONTMATTER_UNCLOSED: "frontmatter-unclosed",
  /** It is larger than a `SKILL.md` may be. */
  TOO_LARGE: "too-large",
} as const;

const skillPasteSourceSchema = Schema.Struct({
  kind: Schema.Literal(SKILL_PASTE_KIND.SOURCE),
  host: Schema.Literals(Object.values(SKILL_SOURCE_HOST)),
  owner: Schema.String,
  repo: Schema.String,
  /** The branch, tag, or commit named; the default branch where none is. */
  ref: Schema.optionalKey(Schema.String),
  /** The folder of one skill, from the repository's root, where the source names one. */
  path: Schema.optionalKey(Schema.String),
  /** The skills asked for by name, every one, or none named, which leaves the member to choose. */
  skills: Schema.optionalKey(
    Schema.Union([Schema.Literal(ALL_SKILLS), Schema.Array(Schema.String)]),
  ),
});

const skillPasteUnsupportedSchema = Schema.Struct({
  kind: Schema.Literal(SKILL_PASTE_KIND.UNSUPPORTED),
  reason: Schema.Literals(Object.values(SKILL_PASTE_UNSUPPORTED)),
});

const skillPasteTextSchema = Schema.Struct({
  kind: Schema.Literal(SKILL_PASTE_KIND.TEXT),
  /** The text as pasted, white space around it taken off. */
  markdown: Schema.String,
  /** The frontmatter's name, or one suggested from the first heading. */
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  problems: Schema.Array(Schema.Literals(Object.values(SKILL_TEXT_PROBLEM))),
});

const skillPasteEmptySchema = Schema.Struct({
  kind: Schema.Literal(SKILL_PASTE_KIND.EMPTY),
});

/** What a paste was read as. */
export const skillPasteSchema = Schema.Union([
  skillPasteSourceSchema,
  skillPasteUnsupportedSchema,
  skillPasteTextSchema,
  skillPasteEmptySchema,
]);

export type SkillPaste = typeof skillPasteSchema.Type;
export type SkillPasteSource = typeof skillPasteSourceSchema.Type;
export type SkillPasteText = typeof skillPasteTextSchema.Type;
export type SkillPasteUnsupportedReason =
  (typeof SKILL_PASTE_UNSUPPORTED)[keyof typeof SKILL_PASTE_UNSUPPORTED];
export type SkillTextProblem = (typeof SKILL_TEXT_PROBLEM)[keyof typeof SKILL_TEXT_PROBLEM];

/* ----- The command ----- */

/** The runners that fetch and run a package, each as the words it is typed as. */
const RUNNERS: readonly (readonly string[])[] = [
  ["npx"],
  ["pnpx"],
  ["pnpm", "dlx"],
  ["bunx"],
  ["bun", "x"],
  ["yarn", "dlx"],
];

/** The words the `skills` tool takes for its install command. */
const ADD_COMMANDS = new Set(["add", "a", "install", "i"]);

/** The flags that name the skills to install, each taking one or more names. */
const SKILL_FLAGS = new Set(["--skill", "-s"]);

/** The flag that asks for every skill. */
const ALL_FLAG = "--all";

/** The flags that take values of their own, which are passed over with them. */
const VALUED_FLAGS = new Set(["--agent", "-a"]);

/** A name the skill flags take that asks for every skill. */
const EVERY_SKILL = "*";

/** The `skills` package as a runner names it, with a version or tag or without. */
const SKILLS_PACKAGE = /^skills(?:@[\w.^~<>=-]+)?$/u;

/**
 * The words of a command line, read as a POSIX shell splits them: white
 * space separates, quotes group, and a backslash escapes. Nothing where a
 * quote never closes.
 */
function shellWords(line: string): readonly string[] | undefined {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: "'" | '"' | undefined;
  for (let at = 0; at < line.length; at += 1) {
    const char = line.charAt(at);
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === "\\" && /["\\$`]/u.test(line.charAt(at + 1))) {
        word += line.charAt(at + 1);
        at += 1;
      } else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === "\\" && at + 1 < line.length) {
      word += line.charAt(at + 1);
      started = true;
      at += 1;
    } else if (/\s/u.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote !== undefined) return undefined;
  if (started) words.push(word);
  return words;
}

/** The words after a runner and its own flags, from the `skills` package on; nothing where they do not open with one. */
function afterRunner(words: readonly string[]): readonly string[] | undefined {
  const runner = RUNNERS.find((typed) => typed.every((word, at) => words[at] === word));
  let at = runner?.length ?? 0;
  if (runner !== undefined) {
    while (words[at] === "-y" || words[at] === "--yes") at += 1;
  }
  return SKILLS_PACKAGE.test(words[at] ?? "") ? words.slice(at + 1) : undefined;
}

/** Whether a word reads as a flag. */
function isFlag(word: string): boolean {
  return word.startsWith("-") && word.length > 1;
}

/** Whether a word reads as a source rather than a skill's or an agent's name, which hold no slash. */
function isSourceShaped(word: string): boolean {
  return word.includes("/") || word.includes(":") || word.startsWith(".") || word.startsWith("~");
}

/** The command's source and the skills it asks for, from the words after `add`. */
function readAddArguments(words: readonly string[]): {
  readonly source: string | undefined;
  readonly skills: typeof ALL_SKILLS | readonly string[] | undefined;
} {
  let source: string | undefined;
  let all = false;
  const named: string[] = [];
  const name = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed === EVERY_SKILL) all = true;
    else if (trimmed !== "") named.push(trimmed);
  };
  for (let at = 0; at < words.length; at += 1) {
    const word = words[at] ?? "";
    const [flag, inline] =
      word.startsWith("--") && word.includes("=")
        ? [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)]
        : [word, undefined];
    if (SKILL_FLAGS.has(flag) || VALUED_FLAGS.has(flag)) {
      const take = SKILL_FLAGS.has(flag) ? name : () => undefined;
      if (inline !== undefined) take(inline);
      // Note that both flags take several values, up to the next flag; a value with a slash is the source.
      while (at + 1 < words.length) {
        const next = words[at + 1] ?? "";
        if (isFlag(next) || (source === undefined && isSourceShaped(next))) break;
        for (const part of next.split(",")) take(part);
        at += 1;
      }
    } else if (flag === ALL_FLAG) {
      all = true;
    } else if (isFlag(word)) {
      // A flag about local agent folders (-g, -y, --copy, -l) or one this reader does not know.
    } else if (source === undefined) {
      source = word;
    }
  }
  const skills = all ? ALL_SKILLS : named.length > 0 ? [...new Set(named)] : undefined;
  return { source, skills };
}

/* ----- The source ----- */

type SourceRead =
  | {
      readonly owner: string;
      readonly repo: string;
      readonly ref?: string;
      readonly path?: string;
      readonly skill?: string;
    }
  | { readonly reason: SkillPasteUnsupportedReason };

/** A GitHub owner's or repository's name, as GitHub allows one. */
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/u;

/** `owner/repo`, with `.git` or without, and `@skill` or without. */
const SHORTHAND = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:@([^/@\s]+))?$/u;

/** An address that downloads a file rather than naming a repository. */
const DOWNLOAD = /\.(?:zip|tar|tgz|tar\.gz|tar\.bz2|tar\.xz|md)$/iu;

/** A repository's name, its `.git` taken off. */
function repoName(segment: string): string {
  return segment.replace(/\.git$/u, "");
}

/** A path's segments, empty ones and a trailing `SKILL.md` taken off. */
function folderOf(segments: readonly string[]): string | undefined {
  const kept = segments.filter((segment) => segment !== "");
  if (kept.at(-1)?.toLowerCase() === "skill.md") kept.pop();
  return kept.length > 0 ? kept.join("/") : undefined;
}

/** A GitHub address read for its repository, and the ref and folder a `tree` or `blob` address names. */
function readGitHubAddress(segments: readonly string[]): SourceRead {
  const [owner = "", repoSegment = "", kind, ref, ...rest] = segments;
  const repo = repoName(repoSegment);
  if (!GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) {
    return { reason: SKILL_PASTE_UNSUPPORTED.UNREADABLE_SOURCE };
  }
  if ((kind === "tree" || kind === "blob") && ref !== undefined && ref !== "") {
    const path = folderOf(rest.map(decodeSegment));
    return { owner, repo, ref: decodeSegment(ref), ...(path === undefined ? {} : { path }) };
  }
  return { owner, repo };
}

/** A path segment as written, its escapes read. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A skills.sh address read for the repository and skill it names: `skills.sh/<owner>/<repo>/<skill>`. */
function readSkillsShAddress(segments: readonly string[]): SourceRead {
  const [owner = "", repo = "", skill] = segments;
  if (!GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) {
    return { reason: SKILL_PASTE_UNSUPPORTED.UNREADABLE_SOURCE };
  }
  return { owner, repo, ...(skill === undefined || skill === "" ? {} : { skill }) };
}

/** Why an address on a host Luke does not read is unsupported. */
function otherHostReason(host: string, path: string): SkillPasteUnsupportedReason {
  if (DOWNLOAD.test(path)) return SKILL_PASTE_UNSUPPORTED.DOWNLOAD_URL;
  if (host === "gitlab.com" || host.startsWith("gitlab.")) return SKILL_PASTE_UNSUPPORTED.GITLAB;
  if (host === "dev.azure.com" || host.endsWith(".visualstudio.com")) {
    return SKILL_PASTE_UNSUPPORTED.AZURE_DEVOPS;
  }
  return SKILL_PASTE_UNSUPPORTED.OTHER_HOST;
}

/** A command's source read as a repository, or the reason it is not one Luke reads. */
function readSource(source: string): SourceRead {
  if (/^[\w.-]+@[\w.-]+:/u.test(source) || source.startsWith("ssh://")) {
    return { reason: SKILL_PASTE_UNSUPPORTED.SSH };
  }
  if (
    /^(?:\.{1,2}|~)?\//u.test(source) ||
    source === "." ||
    source === ".." ||
    /^[A-Za-z]:[\\/]/u.test(source)
  ) {
    return { reason: SKILL_PASTE_UNSUPPORTED.LOCAL_PATH };
  }
  const shorthand = SHORTHAND.exec(source);
  if (shorthand !== null) {
    const [, owner = "", repo = "", skill] = shorthand;
    return { owner, repo, ...(skill === undefined ? {} : { skill }) };
  }
  const address = /^[a-z][a-z0-9+.-]*:\/\//iu.test(source) ? source : `https://${source}`;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { reason: SKILL_PASTE_UNSUPPORTED.UNREADABLE_SOURCE };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./u, "");
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { reason: SKILL_PASTE_UNSUPPORTED.UNREADABLE_SOURCE };
  }
  if (host === "github.com") return readGitHubAddress(segments);
  if (host === "skills.sh") return readSkillsShAddress(segments);
  // Note that a bare word with no dot in its host, as `foo` reads, names nothing at all.
  if (!host.includes(".")) return { reason: SKILL_PASTE_UNSUPPORTED.UNREADABLE_SOURCE };
  return { reason: otherHostReason(host, url.pathname) };
}

/** A command line read as what it installs; nothing where it is no `skills` command. */
function readCommand(text: string): SkillPaste | undefined {
  // A shell's line continuation joins its lines; a prompt's `$ ` opens the line.
  const line = text
    .replace(/\\\r?\n/gu, " ")
    .replace(/^\s*\$\s+/u, "")
    .trim();
  if (/[\r\n]/u.test(line)) return undefined;
  const words = shellWords(line);
  if (words === undefined) return undefined;
  const command = afterRunner(words);
  if (command === undefined) return undefined;
  if (!ADD_COMMANDS.has(command[0] ?? "")) {
    return { kind: SKILL_PASTE_KIND.UNSUPPORTED, reason: SKILL_PASTE_UNSUPPORTED.OTHER_COMMAND };
  }
  const { source, skills } = readAddArguments(command.slice(1));
  if (source === undefined) {
    return { kind: SKILL_PASTE_KIND.UNSUPPORTED, reason: SKILL_PASTE_UNSUPPORTED.NO_SOURCE };
  }
  const read = readSource(source);
  if ("reason" in read) return { kind: SKILL_PASTE_KIND.UNSUPPORTED, reason: read.reason };
  const asked =
    read.skill === undefined || skills === ALL_SKILLS
      ? skills
      : [...new Set([read.skill, ...(skills ?? [])])];
  return {
    kind: SKILL_PASTE_KIND.SOURCE,
    host: SKILL_SOURCE_HOST.GITHUB,
    owner: read.owner,
    repo: read.repo,
    ...(read.ref === undefined ? {} : { ref: read.ref }),
    ...(read.path === undefined ? {} : { path: read.path }),
    ...(asked === undefined ? {} : { skills: asked }),
  };
}

/* ----- The text ----- */

/** A name suggested from a heading: lowercase words of letters and digits joined by single hyphens, at most 64. */
function skillNameFrom(heading: string): string | undefined {
  const slug = heading
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, SKILL_FILE_BOUNDS.MAX_NAME_CHARS)
    .replace(/-+$/u, "");
  return slug === "" ? undefined : slug;
}

/** The first ATX heading's words outside a code fence; nothing where the text holds none. */
function firstHeading(markdown: string): string | undefined {
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/u)) {
    const opened = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (opened !== undefined) {
      if (fence === undefined) fence = opened.charAt(0);
      else if (opened.charAt(0) === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const heading = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/u.exec(line)?.[1];
    if (heading !== undefined && heading !== "") return heading;
  }
  return undefined;
}

/** A name from the body's first heading, for text whose frontmatter names none; nothing where its fence never closes. */
function suggestedName(
  file: ReturnType<typeof readSkillFile>,
  opensFence: boolean,
  markdown: string,
): string | undefined {
  if (file === undefined && opensFence) return undefined;
  const heading = firstHeading(file?.body ?? markdown);
  return heading === undefined ? undefined : skillNameFrom(heading);
}

/** A skill's text read for its name, its description, and what it breaks of the convention. */
function readText(markdown: string): SkillPasteText {
  const problems: SkillTextProblem[] = [];
  if (new TextEncoder().encode(markdown).byteLength > SKILL_FILE_BOUNDS.MAX_FILE_BYTES) {
    problems.push(SKILL_TEXT_PROBLEM.TOO_LARGE);
  }
  const file = readSkillFile(markdown);
  const opensFence = /^\uFEFF?---[ \t]*\r?\n/u.test(markdown);
  if (file === undefined && opensFence) problems.push(SKILL_TEXT_PROBLEM.FRONTMATTER_UNCLOSED);
  const declared = file?.keys.get(SKILL_KEY.NAME)?.trim();
  const name =
    declared !== undefined && declared !== ""
      ? declared
      : suggestedName(file, opensFence, markdown);
  if (name === undefined) problems.push(SKILL_TEXT_PROBLEM.NAME_MISSING);
  else if (!SKILL_NAME_RULE.test(name)) problems.push(SKILL_TEXT_PROBLEM.NAME_INVALID);
  const description = file?.keys.get(SKILL_KEY.DESCRIPTION)?.trim() ?? "";
  if (description === "") problems.push(SKILL_TEXT_PROBLEM.DESCRIPTION_MISSING);
  else if (description.length > TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS) {
    problems.push(SKILL_TEXT_PROBLEM.DESCRIPTION_TOO_LONG);
  }
  return {
    kind: SKILL_PASTE_KIND.TEXT,
    markdown,
    ...(name === undefined ? {} : { name }),
    ...(description === "" ? {} : { description }),
    problems,
  };
}

/**
 * What a member pasted into the Add skill box: a `skills add` command's
 * GitHub source, an unsupported source and why, a skill's text with what
 * it breaks of the convention, or nothing.
 */
export function parseSkillPaste(text: string): SkillPaste {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: SKILL_PASTE_KIND.EMPTY };
  return readCommand(trimmed) ?? readText(trimmed);
}
