/**
 * skill-paste-install.ts -- a member's paste read on the service, as a preview answers it and as an install makes skills of it.
 *
 * The paste is read again here with the same `parseSkillPaste` the window
 * reads it with, and nothing the window said of it is trusted. A GitHub
 * source is reached and its ref pinned to the commit it stands at
 * (`skill-source.ts`); each skill folder found there is a candidate,
 * named and checked by its `SKILL.md` (`skill-check.ts`), and the files of
 * the ones chosen are read at that commit. A skill's text becomes a
 * one-file skill: where it lacks a name or a description, the member's
 * are written into its frontmatter, so its `SKILL.md` says of itself what
 * the store keeps, for a harness that reads it from disk; where it
 * declares one, the member may not name another.
 *
 * Which candidates a source asks for: every one where `--all` or
 * `--skill '*'` says so, the ones `--skill` or `@skill` names, every one in
 * the folder a source names, or the one skill a repository holds. An
 * install may choose others by name.
 *
 * A preview says of each candidate what the window weighs before it
 * installs, from the `SKILL.md` files and the tree already read: the
 * skills of its name the account sees and what installing would meet
 * there, whether it ships scripts, the other candidates its body names,
 * and the plugin it is grouped under. The skills asked for and the ones
 * they reference, transitively, are shown in detail: read whole for the
 * credential scan, their `SKILL.md` carried, and, for a repository GitHub
 * says is public, rated by skills.sh (`skill-audit.ts`), the first few
 * candidates rated where nothing is asked.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type InstalledSkill,
  type InstalledSkillRevision,
  listInstalledSkills,
} from "@luke/database/models/installed-skill-store";
import {
  INSTALLED_SKILL_FILES_REFUSAL,
  INSTALLED_SKILL_PREVIEW_MARKDOWN_BYTES,
  INSTALLED_SKILL_PROBLEM,
  INSTALLED_SKILL_STANDING,
  type InstalledSkillCandidate,
  type InstalledSkillMatch,
  type InstalledSkillPreview,
  type InstalledSkillProblem,
  type InstalledSkillStanding,
} from "@luke/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_SOURCE,
} from "@luke/features/installed-skill-wire";
import { readSkillFile, SKILL_FILE_BOUNDS, SKILL_KEY } from "@luke/features/skill-file";
import {
  ALL_SKILLS,
  SKILL_PASTE_KIND,
  type SkillPaste,
  type SkillPasteSource,
  type SkillPasteText,
} from "@luke/features/skill-paste";
import { TASK_SKILL_BOUNDS } from "@luke/features/task-wire";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../github/github-app.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  installedSkillRefused,
} from "../http/http-effect.js";
import { type SkillAudits, skillAudits } from "./skill-audit.js";
import {
  type CheckedSkill,
  checkSkillFile,
  filesProblems,
  fileText,
  holdsCredentialShape,
  holdsSkillFile,
  refusalOf,
} from "./skill-check.js";
import {
  folderName,
  folderTreeSha,
  pinnedCommit,
  reachSkillRepository,
  readSkillFolder,
  readSkillFolderFile,
  type SkillFolder,
  type SkillRepository,
  skillFolders,
} from "./skill-source.js";

/** How many candidates' `SKILL.md` files are read at once. */
const CANDIDATE_CONCURRENCY = 8;

/** How many candidates are rated by skills.sh where the paste asks for none, as a browsed list shows the first of them. */
const AUDITED_WHEN_BROWSING = 20;

/** The folder a skill keeps its scripts in, by the convention. */
const SCRIPTS_FOLDER = "scripts";

/** The extensions of a file a skill would run. */
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".sh",
  ".py",
  ".js",
  ".ts",
  ".mjs",
  ".rb",
  ".ps1",
]);

/** A skill an install makes: its name and the revision the store keeps of it. */
export interface MadeSkill extends InstalledSkillRevision {
  readonly name: string;
}

/** One skill folder of a source, as its `SKILL.md` names and checks it, with what its files break and its text where it was read. */
interface Candidate {
  readonly folder: SkillFolder;
  readonly checked: CheckedSkill;
  readonly problems: readonly InstalledSkillProblem[];
  readonly markdown: string | undefined;
}

/** What a preview says of its candidates beside each one's own reading, each by the candidate's name. */
interface PreviewDetails {
  readonly asked: ReadonlySet<string>;
  readonly references: ReadonlyMap<string, readonly string[]>;
  readonly installed: ReadonlyMap<string, readonly InstalledSkillMatch[]>;
  readonly markdown: ReadonlyMap<string, string>;
  readonly audits: SkillAudits;
}

/** A source pinned to its commit, with the candidates found there. */
interface PinnedSource {
  readonly repository: SkillRepository;
  readonly ref: string;
  readonly sha: string;
  readonly candidates: readonly Candidate[];
}

type SourceServices = GitHubApp | HttpClient.HttpClient | DatabaseServices;

/** The skill refused for its first problem, by name where it has one. */
function refusedFor(name: string | undefined, problem: InstalledSkillProblem): HostedRefusal {
  return installedSkillRefused(HOSTED_REFUSAL.SKILL_FILES_REFUSED, name, refusalOf(problem));
}

/* ----- A source ----- */

/** One folder as a candidate: its `SKILL.md` read and checked, unread where it is past its bound. */
const candidateOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  repository: SkillRepository,
  sha: string,
  folder: SkillFolder,
): Effect.fn.Return<Candidate, HostedRefusal, HttpClient.HttpClient | DatabaseServices> {
  const fallback = folderName(repository, folder);
  const main = folder.files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  if (main !== undefined && main.bytes > SKILL_FILE_BOUNDS.MAX_FILE_BYTES) {
    const checked: CheckedSkill = {
      name: fallback,
      description: undefined,
      userInvocable: true,
      internal: false,
      problems: [INSTALLED_SKILL_PROBLEM.TOO_LARGE],
    };
    return {
      folder,
      checked,
      problems: [...checked.problems, ...filesProblems(folder.files)],
      markdown: undefined,
    };
  }
  const markdown = fileText(
    (yield* readSkillFolderFile(repository, sha, folder, INSTALLED_SKILL_MAIN_FILE)) ??
      new Uint8Array(),
  );
  const checked = checkSkillFile(markdown, fallback);
  return {
    folder,
    checked,
    problems: [...checked.problems, ...filesProblems(folder.files)],
    markdown,
  };
});

/** The source reached as the member, its ref pinned, and every candidate at that commit, each name once. */
const pinnedSource = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  paste: SkillPasteSource,
): Effect.fn.Return<PinnedSource, HostedRefusal, SourceServices> {
  const repository = yield* reachSkillRepository(workspaceId, paste.owner, paste.repo, userId);
  const { ref, sha } = yield* pinnedCommit(repository, paste.ref);
  const folders = yield* skillFolders(repository, sha, paste.path, paste.fullDepth === true);
  const all = yield* Effect.forEach(folders, (folder) => candidateOf(repository, sha, folder), {
    concurrency: CANDIDATE_CONCURRENCY,
  });
  // Note that an internal skill is hidden unless the paste names it, as the `skills` tool hides one unless asked for by name.
  const named = new Set(
    Array.isArray(paste.skills) ? paste.skills.map((name) => name.toLowerCase()) : [],
  );
  const read = all.filter(
    (candidate) => !candidate.checked.internal || named.has(nameOf(candidate).toLowerCase()),
  );
  // Note that a name stands once: the first copy that installs, else the first copy, as a session's skills fall back.
  const byName = new Map<string, Candidate>();
  for (const candidate of read) {
    const standing = byName.get(nameOf(candidate));
    if (
      standing === undefined ||
      (standing.problems.length > 0 && candidate.problems.length === 0)
    ) {
      byName.set(nameOf(candidate), candidate);
    }
  }
  const candidates = read
    .filter((candidate) => byName.get(nameOf(candidate)) === candidate)
    .slice(0, TASK_SKILL_BOUNDS.MAX_SKILLS);
  return { repository, ref, sha, candidates };
});

/** A candidate's name as the window and an install name it. */
function nameOf(candidate: Candidate): string {
  return candidate.checked.name ?? candidate.folder.path;
}

/** The names asked for, each as the candidate it names spells it, matched without case as the `skills` tool's `filterSkills` matches; a name no candidate holds stays as asked. */
function candidateNames(names: readonly string[], candidates: readonly Candidate[]): string[] {
  return names.map(
    (name) =>
      candidates.map(nameOf).find((one) => one.toLowerCase() === name.toLowerCase()) ?? name,
  );
}

/** The names the paste asks for, as the module's header says. */
function askedNames(paste: SkillPasteSource, candidates: readonly Candidate[]): readonly string[] {
  if (paste.skills === ALL_SKILLS || (paste.skills === undefined && paste.path !== undefined)) {
    return candidates.map(nameOf);
  }
  if (paste.skills !== undefined) return candidateNames(paste.skills, candidates);
  const [only, ...rest] = candidates;
  return only !== undefined && rest.length === 0 ? [nameOf(only)] : [];
}

/* ----- A preview's details ----- */

/** Whether the folder ships code: a file under a `scripts/` folder, or one with a script's extension. */
function shipsScripts(folder: SkillFolder): boolean {
  return folder.files.some((file) => {
    const segments = file.path.split("/");
    const name = segments.at(-1) ?? "";
    const dot = name.lastIndexOf(".");
    return (
      segments.slice(0, -1).includes(SCRIPTS_FOLDER) ||
      (dot > 0 && SCRIPT_EXTENSIONS.has(name.slice(dot).toLowerCase()))
    );
  });
}

/** The name as a pattern's literal text. */
function literally(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Whether the body names the skill as a skill is called on: inside
 * backticks or quotes, or as `/name` or `$name` standing alone, never as
 * a word of a sentence or a segment of a path.
 */
function namesSkill(body: string, name: string): boolean {
  const n = literally(name);
  const pattern = new RegExp(
    [
      `\`${n}\``,
      `"${n}"`,
      `'${n}'`,
      `\u201c${n}\u201d`,
      `\u2018${n}\u2019`,
      `(?<![\\w/$.-])[/$]${n}(?![\\w-]|\\.\\w)`,
    ].join("|"),
    "iu",
  );
  return pattern.test(body);
}

/** Each candidate's references: the other candidates its `SKILL.md` body names, in the candidates' order. */
function referencesOf(candidates: readonly Candidate[]): ReadonlyMap<string, readonly string[]> {
  const names = candidates.map(nameOf);
  return new Map(
    candidates.map((candidate) => {
      const own = nameOf(candidate);
      const text = candidate.markdown;
      const body = text === undefined ? "" : (readSkillFile(text)?.body ?? text);
      return [own, names.filter((name) => name !== own && namesSkill(body, name))] as const;
    }),
  );
}

/** The names asked for and every candidate they reference, and those reference, each once. */
function pulledIn(
  asked: ReadonlySet<string>,
  references: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const pulled = new Set<string>();
  const waiting = [...asked];
  for (let name = waiting.pop(); name !== undefined; name = waiting.pop()) {
    if (pulled.has(name)) continue;
    pulled.add(name);
    waiting.push(...(references.get(name) ?? []));
  }
  return pulled;
}

/**
 * The `SKILL.md` text a preview carries, by name: the candidates asked for
 * first, then the ones they pull in, each whole while the preview's bound
 * holds; none of a text holding a credential's shape.
 */
function carriedMarkdown(
  candidates: readonly Candidate[],
  asked: ReadonlySet<string>,
  pulled: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const carried = new Map<string, string>();
  const ordered = [
    ...candidates.filter((candidate) => asked.has(nameOf(candidate))),
    ...candidates.filter((candidate) => !asked.has(nameOf(candidate))),
  ];
  let bytes = 0;
  for (const candidate of ordered) {
    const text = candidate.markdown;
    if (!pulled.has(nameOf(candidate)) || text === undefined || holdsCredentialShape(text)) {
      continue;
    }
    const size = new TextEncoder().encode(text).byteLength;
    if (bytes + size > INSTALLED_SKILL_PREVIEW_MARKDOWN_BYTES) continue;
    bytes += size;
    carried.set(nameOf(candidate), text);
  }
  return carried;
}

/**
 * What installing the candidate would meet in the installed skill of its
 * name: the same repository's same folder at the same ref is current
 * where its tree at the commit previewed is the one pinned, else an
 * update; any other source is taken. Note that the ref counts, because an
 * update reads the skill's own ref, so the folder on another branch is no
 * update of it. A tree GitHub does not say is read as moved.
 */
const standingOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  source: PinnedSource,
  candidate: Candidate,
  skill: InstalledSkill,
): Effect.fn.Return<InstalledSkillStanding, never, HttpClient.HttpClient | DatabaseServices> {
  const pinned = skill.source;
  const same =
    pinned.type === INSTALLED_SKILL_SOURCE.GITHUB &&
    pinned.owner.toLowerCase() === source.repository.owner.toLowerCase() &&
    pinned.repo.toLowerCase() === source.repository.name.toLowerCase() &&
    pinned.path === candidate.folder.path &&
    pinned.ref === source.ref;
  if (!same) return INSTALLED_SKILL_STANDING.TAKEN;
  if (pinned.sha === source.sha) return INSTALLED_SKILL_STANDING.CURRENT;
  const [then, now] = yield* Effect.all(
    [
      folderTreeSha(source.repository, pinned.sha, pinned.path),
      folderTreeSha(source.repository, source.sha, pinned.path),
    ],
    { concurrency: 2 },
  ).pipe(Effect.orElseSucceed(() => [undefined, undefined] as const));
  return then !== undefined && then === now
    ? INSTALLED_SKILL_STANDING.CURRENT
    : INSTALLED_SKILL_STANDING.UPDATE;
});

/** The installed skills the account sees in the workspace that share a candidate's name, by that name, each with what installing would meet. */
const installedMatches = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  source: PinnedSource,
): Effect.fn.Return<
  ReadonlyMap<string, readonly InstalledSkillMatch[]>,
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
> {
  const byName = new Map(source.candidates.map((candidate) => [nameOf(candidate), candidate]));
  const listed = yield* hostedStoreOrUnavailable(listInstalledSkills(userId, workspaceId));
  const met = yield* Effect.forEach(
    listed.flatMap((skill) => {
      const candidate = byName.get(skill.name);
      return candidate === undefined ? [] : [{ skill, candidate }];
    }),
    ({ skill, candidate }) =>
      Effect.map(standingOf(source, candidate, skill), (standing) => ({
        name: skill.name,
        match: { id: skill.id, scope: skill.scope, standing } satisfies InstalledSkillMatch,
      })),
    { concurrency: CANDIDATE_CONCURRENCY },
  );
  const matches = new Map<string, InstalledSkillMatch[]>();
  for (const { name, match } of met) matches.set(name, [...(matches.get(name) ?? []), match]);
  return matches;
});

/** The candidate with every one of its files read and held to the credential scan, as an install will hold them. */
const scannedWhole = /* @__PURE__ */ Effect.fnUntraced(function* (
  source: PinnedSource,
  candidate: Candidate,
): Effect.fn.Return<Candidate, HostedRefusal, HttpClient.HttpClient | DatabaseServices> {
  const files = yield* readSkillFolder(source.repository, source.sha, candidate.folder);
  return files.some((file) => holdsCredentialShape(fileText(file.bytes)))
    ? { ...candidate, problems: [INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED] }
    : candidate;
});

/** The skill one candidate makes: its files read at the commit and held to every check again, refused for the first it breaks. */
const madeFromCandidate = /* @__PURE__ */ Effect.fnUntraced(function* (
  source: PinnedSource,
  candidate: Candidate,
): Effect.fn.Return<MadeSkill, HostedRefusal, HttpClient.HttpClient | DatabaseServices> {
  const name = nameOf(candidate);
  const [problem] = candidate.problems;
  if (problem !== undefined) return yield* Effect.fail(refusedFor(name, problem));
  const files = yield* readSkillFolder(source.repository, source.sha, candidate.folder);
  if (!holdsSkillFile(files)) {
    return yield* Effect.fail(
      installedSkillRefused(
        HOSTED_REFUSAL.SKILL_FILES_REFUSED,
        name,
        INSTALLED_SKILL_FILES_REFUSAL.NO_SKILL_FILE,
      ),
    );
  }
  if (files.some((file) => holdsCredentialShape(fileText(file.bytes)))) {
    return yield* Effect.fail(refusedFor(name, INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED));
  }
  return {
    name,
    description: candidate.checked.description ?? "",
    userInvocable: candidate.checked.userInvocable,
    source: {
      type: INSTALLED_SKILL_SOURCE.GITHUB,
      owner: source.repository.owner,
      repo: source.repository.name,
      path: candidate.folder.path,
      ref: source.ref,
      sha: source.sha,
    },
    files,
  };
});

/** The skills of a source an install makes: the ones chosen by name, else the ones the paste asks for; none chosen, or one that is no candidate, is no install. */
const madeFromSource = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  paste: SkillPasteSource,
  chosen: readonly string[] | undefined,
): Effect.fn.Return<readonly MadeSkill[], HostedRefusal, SourceServices> {
  const source = yield* pinnedSource(userId, workspaceId, paste);
  const names = [
    ...new Set(
      chosen === undefined
        ? askedNames(paste, source.candidates)
        : candidateNames(chosen, source.candidates),
    ),
  ];
  const picked = names.map((name) => source.candidates.find((one) => nameOf(one) === name));
  if (names.length === 0 || picked.some((one) => one === undefined)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return yield* Effect.forEach(
    picked.filter((one) => one !== undefined),
    (candidate) => madeFromCandidate(source, candidate),
  );
});

/* ----- Text ----- */

/** The text with the keys given written into its frontmatter, which is made where it has none. */
function withFrontmatter(markdown: string, keys: readonly (readonly [string, string])[]): string {
  if (keys.length === 0) return markdown;
  // Note that a JSON string is a YAML double-quoted scalar, so any description reads back as written.
  const lines = keys.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n");
  const opening = /^\uFEFF?---[ \t]*\r?\n/u;
  return readSkillFile(markdown) === undefined
    ? `---\n${lines}\n---\n\n${markdown}`
    : markdown.replace(opening, (fence) => `${fence}${lines}\n`);
}

/**
 * The one-file skill a pasted text makes: the member's name and
 * description written where the text lacks them, refused as no request
 * where they contradict what it declares, and refused for the first
 * problem the result breaks.
 */
function madeFromText(
  paste: SkillPasteText,
  asked: { readonly name?: string; readonly description?: string },
): Effect.Effect<MadeSkill, HostedRefusal> {
  return Effect.gen(function* () {
    const file = readSkillFile(paste.markdown);
    const declaredName = file?.keys.get(SKILL_KEY.NAME)?.trim() || undefined;
    const declaredDescription = file?.keys.get(SKILL_KEY.DESCRIPTION)?.trim() || undefined;
    const contradicts =
      (asked.name !== undefined && declaredName !== undefined && asked.name !== declaredName) ||
      (asked.description !== undefined &&
        declaredDescription !== undefined &&
        asked.description !== declaredDescription);
    if (contradicts) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const name = declaredName ?? asked.name ?? paste.name;
    if (paste.problems.includes(INSTALLED_SKILL_PROBLEM.FRONTMATTER_UNCLOSED)) {
      return yield* Effect.fail(refusedFor(name, INSTALLED_SKILL_PROBLEM.FRONTMATTER_UNCLOSED));
    }
    const written = withFrontmatter(paste.markdown, [
      ...(declaredName === undefined && name !== undefined
        ? [[SKILL_KEY.NAME, name] as const]
        : []),
      ...(declaredDescription === undefined && asked.description !== undefined
        ? [[SKILL_KEY.DESCRIPTION, asked.description] as const]
        : []),
    ]);
    const checked = checkSkillFile(written, "");
    const [problem] = checked.problems;
    if (problem !== undefined) return yield* Effect.fail(refusedFor(checked.name, problem));
    return {
      name: checked.name ?? "",
      description: checked.description ?? "",
      userInvocable: checked.userInvocable,
      source: { type: INSTALLED_SKILL_SOURCE.TEXT },
      files: [{ path: INSTALLED_SKILL_MAIN_FILE, bytes: new TextEncoder().encode(written) }],
    };
  });
}

/* ----- Entry points ----- */

/** What an install asks of a paste beside the paste itself. */
export interface InstallAsked {
  readonly skills?: readonly string[];
  readonly name?: string;
  readonly description?: string;
}

/** The skills a paste makes, read afresh as the module's header says; a paste that names nothing to install is no request. */
export const madeFromPaste = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  paste: SkillPaste,
  asked: InstallAsked,
): Effect.fn.Return<readonly MadeSkill[], HostedRefusal, SourceServices> {
  switch (paste.kind) {
    case SKILL_PASTE_KIND.SOURCE:
      return yield* madeFromSource(userId, workspaceId, paste, asked.skills);
    case SKILL_PASTE_KIND.TEXT:
      return [yield* madeFromText(paste, asked)];
    default:
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
});

/** A candidate as the preview answers it, with what the preview says of it beside its own reading. */
function candidateSummary(candidate: Candidate, details: PreviewDetails): InstalledSkillCandidate {
  const name = nameOf(candidate);
  const references = details.references.get(name) ?? [];
  const installed = details.installed.get(name) ?? [];
  const markdown = details.markdown.get(name);
  const audit = details.audits.get(name);
  return {
    name,
    ...(candidate.checked.description === undefined
      ? undefined
      : { description: candidate.checked.description }),
    path: candidate.folder.path,
    fileCount: candidate.folder.files.length,
    bytes: candidate.folder.files.reduce((total, file) => total + file.bytes, 0),
    selected: details.asked.has(name),
    problems: candidate.problems,
    ...(installed.length === 0 ? undefined : { installed }),
    hasScripts: shipsScripts(candidate.folder),
    ...(references.length === 0 ? undefined : { references }),
    ...(candidate.folder.group === undefined ? undefined : { group: candidate.folder.group }),
    ...(markdown === undefined ? undefined : { markdown }),
    ...(audit === undefined ? undefined : { audit }),
  };
}

/** What a paste would install, read as an install reads it, installing nothing. */
export const previewOfPaste = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  paste: SkillPaste,
): Effect.fn.Return<InstalledSkillPreview, HostedRefusal, SourceServices> {
  switch (paste.kind) {
    case SKILL_PASTE_KIND.SOURCE: {
      const source = yield* pinnedSource(userId, workspaceId, paste);
      const asked = new Set(askedNames(paste, source.candidates));
      const found = new Set(source.candidates.map(nameOf));
      const references = referencesOf(source.candidates);
      const pulled = pulledIn(asked, references);
      const rated =
        pulled.size > 0
          ? [...pulled].filter((name) => found.has(name))
          : source.candidates.slice(0, AUDITED_WHEN_BROWSING).map(nameOf);
      // Note that only the skills shown in detail are read whole, so a preview of a large repository costs its `SKILL.md` files alone.
      const [scanned, installed, audits] = yield* Effect.all(
        [
          Effect.forEach(
            source.candidates,
            (candidate) =>
              pulled.has(nameOf(candidate)) && candidate.problems.length === 0
                ? scannedWhole(source, candidate)
                : Effect.succeed(candidate),
            { concurrency: CANDIDATE_CONCURRENCY },
          ),
          installedMatches(userId, workspaceId, source),
          source.repository.public
            ? skillAudits(source.repository.fullName, rated)
            : Effect.succeed<SkillAudits>(new Map()),
        ],
        { concurrency: "unbounded" },
      );
      const details: PreviewDetails = {
        asked,
        references,
        installed,
        markdown: carriedMarkdown(source.candidates, asked, pulled),
        audits,
      };
      return {
        kind: SKILL_PASTE_KIND.SOURCE,
        owner: source.repository.owner,
        repo: source.repository.name,
        ref: source.ref,
        sha: source.sha,
        missing: [...asked].filter((name) => !found.has(name)),
        skills: scanned.map((candidate) => candidateSummary(candidate, details)),
      };
    }
    case SKILL_PASTE_KIND.TEXT:
      return {
        kind: SKILL_PASTE_KIND.TEXT,
        ...(paste.name === undefined ? undefined : { name: paste.name }),
        ...(paste.description === undefined ? undefined : { description: paste.description }),
        bytes: new TextEncoder().encode(paste.markdown).byteLength,
        problems: holdsCredentialShape(paste.markdown)
          ? [...paste.problems, INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED]
          : paste.problems,
      };
    case SKILL_PASTE_KIND.UNSUPPORTED:
      return { kind: SKILL_PASTE_KIND.UNSUPPORTED, reason: paste.reason };
    case SKILL_PASTE_KIND.EMPTY:
      return { kind: SKILL_PASTE_KIND.EMPTY };
  }
});

/** The candidate a preview named, by its repository, the commit the preview pinned, and its folder. */
export interface PreviewedCandidate {
  readonly owner: string;
  readonly repo: string;
  readonly sha: string;
  readonly path: string;
}

/**
 * One candidate's `SKILL.md` at the commit a preview pinned, reached as
 * the preview reached it: not found where the folder holds none, and
 * refused as the preview would mark it where it is past a `SKILL.md`'s
 * bound or holds a credential's shape.
 */
export const previewedSkillFile = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  candidate: PreviewedCandidate,
): Effect.fn.Return<{ readonly markdown: string }, HostedRefusal, SourceServices> {
  const repository = yield* reachSkillRepository(
    workspaceId,
    candidate.owner,
    candidate.repo,
    userId,
  );
  const bytes = yield* readSkillFolderFile(
    repository,
    candidate.sha,
    { path: candidate.path, files: [] },
    INSTALLED_SKILL_MAIN_FILE,
  );
  if (bytes === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (bytes.byteLength > SKILL_FILE_BOUNDS.MAX_FILE_BYTES) {
    return yield* Effect.fail(refusedFor(undefined, INSTALLED_SKILL_PROBLEM.TOO_LARGE));
  }
  const markdown = fileText(bytes);
  if (holdsCredentialShape(markdown)) {
    return yield* Effect.fail(refusedFor(undefined, INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED));
  }
  return { markdown };
});

/**
 * A GitHub skill's revision at the commit its ref stands at now: its
 * folder found there and read, its `SKILL.md` checked as an install checks
 * it, under the name it was installed by, which an update keeps. Refused
 * where the folder is gone, now names another skill, or breaks a check.
 */
export const revisionAtRef = /* @__PURE__ */ Effect.fnUntraced(function* (
  repository: SkillRepository,
  name: string,
  source: {
    readonly path: string;
    readonly ref: string;
    readonly owner: string;
    readonly repo: string;
  },
): Effect.fn.Return<
  InstalledSkillRevision,
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
> {
  const { sha } = yield* pinnedCommit(repository, source.ref);
  const folders = yield* skillFolders(repository, sha, source.path, false);
  const folder = folders.find((one) => one.path === source.path);
  if (folder === undefined) {
    return yield* Effect.fail(
      installedSkillRefused(
        HOSTED_REFUSAL.SKILL_FILES_REFUSED,
        name,
        INSTALLED_SKILL_FILES_REFUSAL.NO_SKILL_FILE,
      ),
    );
  }
  const candidate = yield* candidateOf(repository, sha, folder);
  // Note that an update keeps the skill's name, so a `SKILL.md` that now names another is refused rather than stored beside it.
  if (candidate.checked.name !== name) {
    return yield* Effect.fail(refusedFor(name, INSTALLED_SKILL_PROBLEM.NAME_INVALID));
  }
  const made = yield* madeFromCandidate(
    { repository, ref: source.ref, sha, candidates: [] },
    candidate,
  );
  return {
    description: made.description,
    userInvocable: made.userInvocable,
    source: made.source,
    files: made.files,
  };
});
