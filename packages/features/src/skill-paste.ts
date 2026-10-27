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
 * is the dialog's to choose. A GitHub source is read in every form the
 * tool reads one (vercel-labs/skills at a80e4c9, `src/source-parser.ts`'s
 * `parseSource`: https://github.com/vercel-labs/skills/blob/a80e4c9d12d607631249d4d7d059f835d4b2f13a/src/source-parser.ts):
 * `owner/repo` with a folder, `@skill`, or a `#ref` or `#ref@skill`
 * fragment, a `github:` prefix, the tool's aliases, a github.com address,
 * or an ssh one; a path that steps out of its folder is refused. A source
 * on any host but GitHub, on disk, or as a download is named unsupported,
 * with a reason the window words. A github.com or skills.sh link pasted
 * alone is read as that command's source would be.
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
const SKILL_SOURCE_HOST = {
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
  /** Whether `--full-depth` asks for every skill folder, past a skill at the folder searched too. */
  fullDepth: Schema.optionalKey(Schema.Literal(true)),
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
const skillPasteSchema = Schema.Union([
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
type SkillTextProblem = (typeof SKILL_TEXT_PROBLEM)[keyof typeof SKILL_TEXT_PROBLEM];

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

/** The flag that asks for every skill folder, as deep as the tool looks. */
const FULL_DEPTH_FLAG = "--full-depth";

/** The flags that take values of their own, which are passed over with them. */
const VALUED_FLAGS = new Set(["--agent", "-a", "--subagent"]);

/** The flags that take exactly one value, which is passed over with them. */
const ONE_VALUE_FLAGS = new Set(["--metadata"]);

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
  readonly fullDepth: boolean;
} {
  let source: string | undefined;
  let all = false;
  let fullDepth = false;
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
      if (inline !== undefined) for (const part of inline.split(",")) take(part);
      // Note that both flags take several values, up to the next flag; a value with a slash is the source.
      while (at + 1 < words.length) {
        const next = words[at + 1] ?? "";
        if (isFlag(next) || (source === undefined && isSourceShaped(next))) break;
        for (const part of next.split(",")) take(part);
        at += 1;
      }
    } else if (ONE_VALUE_FLAGS.has(flag)) {
      if (inline === undefined) at += 1;
    } else if (flag === ALL_FLAG) {
      all = true;
    } else if (flag === FULL_DEPTH_FLAG) {
      fullDepth = true;
    } else if (isFlag(word)) {
      // A flag about local agent folders (-g, -y, --copy, -l) or one this reader does not know.
    } else if (source === undefined) {
      source = word;
    }
  }
  const skills = all ? ALL_SKILLS : named.length > 0 ? [...new Set(named)] : undefined;
  return { source, skills, fullDepth };
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

/** `owner/repo/` and a folder in it, or a trailing slash alone; an owner holds no dot, so `github.com/owner/repo` is an address. */
const SHORTHAND_FOLDER = /^([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/(.*)$/u;

/** The sources the `skills` tool reads as another repository (`SOURCE_ALIASES`). */
const SOURCE_ALIASES: ReadonlyMap<string, string> = new Map([
  ["coinbase/agentWallet", "coinbase/agentic-wallet-skills"],
  ["vercel-labs/vercel-skills", "vercel-labs/agent-skills"],
]);

/** An ssh address of a GitHub repository: `git@github.com:owner/repo` or `ssh://git@github.com/owner/repo`. */
const GITHUB_SSH = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)\/?$/iu;

/** The hosts of GitHub's that only serve files to download (`isHostedArtifactUrl`). */
const DOWNLOAD_HOSTS = new Set([
  "raw.githubusercontent.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
]);

/** An address that downloads a file rather than naming a repository. */
const DOWNLOAD = /\.(?:zip|tar|tgz|tar\.gz|tar\.bz2|tar\.xz|md)$/iu;

/** A repository's name, its `.git` taken off. */
function repoName(segment: string): string {
  return segment.replace(/\.git$/u, "");
}

/** Whether a path's segment, its escapes read, steps out of its folder or would: `.` or `..`, or either behind an escaped slash or a backslash. */
function leavesFolder(segment: string): boolean {
  return segment.split(/[/\\]/u).some((part) => part === "." || part === "..");
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
  if (kind === undefined) return { owner, repo };
  if ((kind === "tree" || kind === "blob") && ref !== undefined && ref !== "") {
    const path = folderOf(rest.map(decodeSegment));
    return { owner, repo, ref: decodeSegment(ref), ...(path === undefined ? {} : { path }) };
  }
  // An archive, a release asset, or a raw file is a download; any other page of the repository names the repository, as the tool reads it.
  const download =
    DOWNLOAD.test(segments.join("/")) ||
    kind === "archive" ||
    kind === "raw" ||
    (kind === "releases" && (ref === "download" || (ref === "latest" && rest[0] === "download")));
  return download ? { reason: SKILL_PASTE_UNSUPPORTED.DOWNLOAD_URL } : { owner, repo };
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

/** A `#ref` or `#ref@skill` fragment read off a source, each part's escapes read (`parseFragmentRef`). */
function splitFragment(source: string): {
  readonly source: string;
  readonly ref?: string;
  readonly skill?: string;
} {
  const hash = source.indexOf("#");
  if (hash === -1 || hash === source.length - 1)
    return { source: hash === -1 ? source : source.slice(0, hash) };
  const fragment = source.slice(hash + 1);
  const at = fragment.indexOf("@");
  const ref = decodeSegment(at === -1 ? fragment : fragment.slice(0, at));
  const skill = at === -1 ? "" : decodeSegment(fragment.slice(at + 1));
  return {
    source: source.slice(0, hash),
    ...(ref === "" ? {} : { ref }),
    ...(skill === "" ? {} : { skill }),
  };
}

/** A command's source read as a repository, its fragment's ref and skill where the source names none, or the reason it is not one Luke reads. */
function readSource(pasted: string): SourceRead {
  const fragment = splitFragment(pasted);
  const read = readBareSource(fragment.source);
  if ("reason" in read) return read;
  const ref = read.ref ?? fragment.ref;
  const skill = fragment.skill ?? read.skill;
  return {
    ...read,
    ...(ref === undefined ? {} : { ref }),
    ...(skill === undefined ? {} : { skill }),
  };
}

/** A source with no fragment read as a repository, or the reason it is not one Luke reads. */
function readBareSource(written: string): SourceRead {
  const unprefixed = written.replace(/^github:/u, "").replace(/^git\+(?=https?:\/\/)/u, "");
  const source = SOURCE_ALIASES.get(unprefixed) ?? unprefixed;
  const ssh = GITHUB_SSH.exec(source);
  if (ssh !== null) return readGitHubAddress([ssh[1] ?? "", ssh[2] ?? ""]);
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
  // Note that a path is read before a URL folds `..` away, so one that steps out is refused rather than read elsewhere.
  if (
    source
      .split(/[/\\]/u)
      .map(decodeSegment)
      .some((segment) => segment.split(/[/\\]/u).includes(".."))
  ) {
    return { reason: SKILL_PASTE_UNSUPPORTED.UNREADABLE_SOURCE };
  }
  const shorthand = SHORTHAND.exec(source);
  if (shorthand !== null) {
    const [, owner = "", repo = "", skill] = shorthand;
    return { owner, repo, ...(skill === undefined ? {} : { skill }) };
  }
  const inFolder = SHORTHAND_FOLDER.exec(source);
  if (inFolder !== null) {
    const [, owner = "", repo = "", rest = ""] = inFolder;
    const segments = rest.split("/").map(decodeSegment);
    if (segments.some(leavesFolder)) return { reason: SKILL_PASTE_UNSUPPORTED.UNREADABLE_SOURCE };
    const path = folderOf(segments);
    return { owner, repo, ...(path === undefined ? {} : { path }) };
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
  if (host === "github.com") {
    if (segments.slice(2).map(decodeSegment).some(leavesFolder)) {
      return { reason: SKILL_PASTE_UNSUPPORTED.UNREADABLE_SOURCE };
    }
    return readGitHubAddress(segments);
  }
  if (DOWNLOAD_HOSTS.has(host)) return { reason: SKILL_PASTE_UNSUPPORTED.DOWNLOAD_URL };
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
  const { source, skills, fullDepth } = readAddArguments(command.slice(1));
  if (source === undefined) {
    return { kind: SKILL_PASTE_KIND.UNSUPPORTED, reason: SKILL_PASTE_UNSUPPORTED.NO_SOURCE };
  }
  return sourcePaste(readSource(source), skills, fullDepth);
}

/** A source read as what it installs, the skill it names among those asked for; or why it is not one Luke reads. */
function sourcePaste(
  read: SourceRead,
  skills: SkillPasteSource["skills"],
  fullDepth: boolean,
): SkillPaste {
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
    ...(fullDepth ? { fullDepth: true } : {}),
  };
}

/** A GitHub or skills.sh address alone on its line, with or without its scheme. */
const BARE_ADDRESS = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com|skills\.sh)\/\S+$/iu;

/**
 * A link to a repository, a skill's folder, or a skills.sh skill pasted
 * alone, read as the source `skills add` would take it as. Note that only
 * an address whose host says it is one is read this way: `owner/repo`
 * alone could as well be the first words of a skill's text.
 */
function readAddress(text: string): SkillPaste | undefined {
  return BARE_ADDRESS.test(text) ? sourcePaste(readSource(text), undefined, false) : undefined;
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

/** A heading's words, an ATX heading's closing run of hashes taken off. */
function headingWords(rest: string): string {
  const words = rest.trim();
  let end = words.length;
  while (end > 0 && words.charAt(end - 1) === "#") end -= 1;
  return end === 0 || /\s/u.test(words.charAt(end - 1)) ? words.slice(0, end).trim() : words;
}

/** The first ATX heading's words outside a code fence; nothing where the text holds none. */
function firstHeading(markdown: string): string | undefined {
  // Note that a fence closes only on a bare run of its own character at least as long as the one that opened it.
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/u)) {
    const run = /^\s{0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence === undefined && run !== null) {
      fence = run[1] ?? "";
      continue;
    }
    if (fence !== undefined && run !== null) {
      const closing = run[1] ?? "";
      if (
        closing.charAt(0) === fence.charAt(0) &&
        closing.length >= fence.length &&
        (run[2] ?? "").trim() === ""
      ) {
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) continue;
    const rest = /^ {0,3}#{1,6}[ \t](.*)$/u.exec(line)?.[1];
    const heading = rest === undefined ? undefined : headingWords(rest);
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
 * GitHub source or a GitHub link alone, an unsupported source and why, a skill's text with what
 * it breaks of the convention, or nothing.
 */
export function parseSkillPaste(text: string): SkillPaste {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: SKILL_PASTE_KIND.EMPTY };
  return readCommand(trimmed) ?? readAddress(trimmed) ?? readText(trimmed);
}
