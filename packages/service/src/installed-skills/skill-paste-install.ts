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
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type { InstalledSkillRevision } from "@luke/database/models/installed-skill-store";
import {
  INSTALLED_SKILL_FILES_REFUSAL,
  INSTALLED_SKILL_PROBLEM,
  type InstalledSkillCandidate,
  type InstalledSkillPreview,
  type InstalledSkillProblem,
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
import { HOSTED_REFUSAL, type HostedRefusal, installedSkillRefused } from "../http/http-effect.js";
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

/** A skill an install makes: its name and the revision the store keeps of it. */
export interface MadeSkill extends InstalledSkillRevision {
  readonly name: string;
}

/** One skill folder of a source, as its `SKILL.md` names and checks it, with what its files break. */
interface Candidate {
  readonly folder: SkillFolder;
  readonly checked: CheckedSkill;
  readonly problems: readonly InstalledSkillProblem[];
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
  const checked: CheckedSkill =
    main !== undefined && main.bytes > SKILL_FILE_BOUNDS.MAX_FILE_BYTES
      ? {
          name: fallback,
          description: undefined,
          userInvocable: true,
          internal: false,
          problems: [INSTALLED_SKILL_PROBLEM.TOO_LARGE],
        }
      : checkSkillFile(
          fileText(
            (yield* readSkillFolderFile(repository, sha, folder, INSTALLED_SKILL_MAIN_FILE)) ??
              new Uint8Array(),
          ),
          fallback,
        );
  return { folder, checked, problems: [...checked.problems, ...filesProblems(folder.files)] };
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
  // Note that an internal skill is hidden unless the paste names skills, as the `skills` tool hides one unless asked for by name.
  const naming = Array.isArray(paste.skills) && paste.skills.length > 0;
  const read = naming ? all : all.filter((candidate) => !candidate.checked.internal);
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

/** A candidate as the preview answers it. */
function candidateSummary(
  candidate: Candidate,
  asked: ReadonlySet<string>,
): InstalledSkillCandidate {
  const name = nameOf(candidate);
  return {
    name,
    ...(candidate.checked.description === undefined
      ? undefined
      : { description: candidate.checked.description }),
    path: candidate.folder.path,
    fileCount: candidate.folder.files.length,
    bytes: candidate.folder.files.reduce((total, file) => total + file.bytes, 0),
    selected: asked.has(name),
    problems: candidate.problems,
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
      // Note that only the skills asked for are read whole, so a preview of a large repository costs its `SKILL.md` files alone.
      const scanned = yield* Effect.forEach(
        source.candidates,
        (candidate) =>
          asked.has(nameOf(candidate)) && candidate.problems.length === 0
            ? scannedWhole(source, candidate)
            : Effect.succeed(candidate),
        { concurrency: CANDIDATE_CONCURRENCY },
      );
      return {
        kind: SKILL_PASTE_KIND.SOURCE,
        owner: source.repository.owner,
        repo: source.repository.name,
        ref: source.ref,
        sha: source.sha,
        missing: [...asked].filter((name) => !found.has(name)),
        skills: scanned.map((candidate) => candidateSummary(candidate, asked)),
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
