import type { DatabaseServices } from "@repo/database/core/query";
import type { NewInstalledSkill } from "@repo/database/models/installed-skill-store";
import {
  type InstalledSkillCandidate,
  type InstalledSkillPreview,
  SKILL_PASTE_KIND,
  UNSUPPORTED_PREVIEW,
} from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_SOURCE,
} from "@repo/features/installed-skill-wire";
import { SKILL_FRONTMATTER } from "@repo/features/skill-file";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../github/github-app.js";
import { HOSTED_REFUSAL, type HostedRefusal, installedSkillRefused } from "../http/http-effect.js";
import { fileText, type SkillHead, skillHead, skillRefusal } from "./skill-check.js";
import type { SkillPaste, SkillPasteSource } from "./skill-paste.js";
import {
  reachSkillRepository,
  readSkillArchive,
  type SkillFolder,
  type SkillRepository,
  skillFolders,
} from "./skill-source.js";

export type MadeSkill = Omit<NewInstalledSkill, "owner">;

interface FoundSkill extends SkillHead {
  readonly folder: SkillFolder;
}

interface ReadSource {
  readonly repository: SkillRepository;
  readonly ref: string;
  readonly sha: string;
  readonly skills: readonly FoundSkill[];
}

export interface InstallAsked {
  readonly skills?: readonly string[];
  readonly sha?: string;
  readonly name?: string;
  readonly description?: string;
}

type SourceServices = GitHubApp | HttpClient.HttpClient | DatabaseServices;

function foundSkill(repository: SkillRepository, folder: SkillFolder): FoundSkill {
  const main = folder.files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  const fallback =
    folder.path === "" ? repository.name.toLowerCase() : folder.path.split("/").at(-1);
  return { folder, ...skillHead(main === undefined ? "" : fileText(main.bytes), fallback ?? "") };
}

const readSource = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  paste: SkillPasteSource,
  sha: string | undefined,
): Effect.fn.Return<ReadSource, HostedRefusal, SourceServices> {
  const repository = yield* reachSkillRepository(workspaceId, paste.owner, paste.repo, userId);
  const ref = paste.ref ?? repository.defaultBranch;
  const archive = yield* readSkillArchive(repository, sha ?? ref);
  const found = skillFolders(archive, paste.path).map((folder) => foundSkill(repository, folder));
  const skills = found.filter((one, at) => found.findIndex(({ name }) => name === one.name) === at);
  return { repository, ref, sha: archive.sha, skills };
});

function madeFromFolder(
  source: ReadSource,
  found: FoundSkill,
): Effect.Effect<MadeSkill, HostedRefusal> {
  const refusal = skillRefusal(found, found.folder.files);
  if (refusal !== undefined) {
    return Effect.fail(
      installedSkillRefused(HOSTED_REFUSAL.SKILL_FILES_REFUSED, found.name, refusal),
    );
  }
  return Effect.succeed({
    name: found.name,
    description: found.description,
    userInvocable: found.userInvocable,
    source: {
      type: INSTALLED_SKILL_SOURCE.GITHUB,
      owner: source.repository.owner,
      repo: source.repository.name,
      path: found.folder.path,
      ref: source.ref,
      sha: source.sha,
    },
    files: found.folder.files,
  });
}

const NAME_OR_DESCRIPTION = /^(?:name|description):/u;

function withNameAndDescription(markdown: string, name: string, description: string): string {
  const head = `name: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}`;
  const unmarked = markdown.replace(/^\uFEFF/u, "");
  const fenced = SKILL_FRONTMATTER.exec(unmarked);
  if (fenced === null) return `---\n${head}\n---\n\n${unmarked}`;
  let dropping = false;
  const kept = (fenced[1] ?? "").split(/\r?\n/u).filter((line) => {
    if (/^\S/u.test(line)) dropping = NAME_OR_DESCRIPTION.test(line);
    return !dropping;
  });
  return `---\n${[head, ...kept].join("\n")}\n---\n${unmarked.slice(fenced[0].length)}`;
}

function madeFromText(
  markdown: string,
  asked: InstallAsked,
): Effect.Effect<MadeSkill, HostedRefusal> {
  const own = skillHead(markdown, "");
  const name = asked.name?.trim() ?? own.name;
  const description = asked.description?.trim() ?? own.description;
  const written =
    name === own.name && description === own.description
      ? markdown
      : withNameAndDescription(markdown, name, description);
  const files = [{ path: INSTALLED_SKILL_MAIN_FILE, bytes: new TextEncoder().encode(written) }];
  const refusal = skillRefusal({ name, description }, files);
  if (refusal !== undefined) {
    return Effect.fail(
      installedSkillRefused(HOSTED_REFUSAL.SKILL_FILES_REFUSED, name || undefined, refusal),
    );
  }
  return Effect.succeed({
    name,
    description,
    userInvocable: own.userInvocable,
    source: { type: INSTALLED_SKILL_SOURCE.TEXT },
    files,
  });
}

function candidateOf(
  found: FoundSkill,
  paste: SkillPasteSource,
  only: boolean,
): InstalledSkillCandidate {
  return {
    name: found.name,
    ...(found.description === "" ? undefined : { description: found.description }),
    path: found.folder.path,
    bytes: found.folder.files.reduce((total, file) => total + file.bytes.byteLength, 0),
    selected: only || paste.skills.includes(found.name),
    fileCount: found.folder.files.length,
    problems: [],
  };
}

export const previewOfPaste = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  paste: SkillPaste,
): Effect.fn.Return<InstalledSkillPreview, HostedRefusal, SourceServices> {
  switch (paste.kind) {
    case SKILL_PASTE_KIND.SOURCE: {
      const source = yield* readSource(userId, workspaceId, paste, undefined);
      const only = source.skills.length === 1;
      return {
        kind: SKILL_PASTE_KIND.SOURCE,
        owner: source.repository.owner,
        repo: source.repository.name,
        ref: source.ref,
        sha: source.sha,
        skills: source.skills.map((found) => candidateOf(found, paste, only)),
        missing: [],
      };
    }
    case SKILL_PASTE_KIND.TEXT: {
      const { name, description } = skillHead(paste.markdown, "");
      return {
        kind: SKILL_PASTE_KIND.TEXT,
        ...(name === "" ? undefined : { name }),
        ...(description === "" ? undefined : { description }),
        bytes: new TextEncoder().encode(paste.markdown).byteLength,
        problems: [],
      };
    }
    case SKILL_PASTE_KIND.UNSUPPORTED:
      return UNSUPPORTED_PREVIEW;
  }
});

export const madeFromPaste = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  paste: SkillPaste,
  asked: InstallAsked,
): Effect.fn.Return<readonly MadeSkill[], HostedRefusal, SourceServices> {
  switch (paste.kind) {
    case SKILL_PASTE_KIND.SOURCE: {
      const source = yield* readSource(userId, workspaceId, paste, asked.sha);
      const chosen = source.skills.filter((found) => asked.skills?.includes(found.name));
      if (chosen.length === 0) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      return yield* Effect.forEach(chosen, (found) => madeFromFolder(source, found));
    }
    case SKILL_PASTE_KIND.TEXT:
      return [yield* madeFromText(paste.markdown, asked)];
    case SKILL_PASTE_KIND.UNSUPPORTED:
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
});
