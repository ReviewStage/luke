/**
 * skill-paste-install.ts -- a member's paste read on the service, as a preview answers it and as an install makes skills of it.
 *
 * A GitHub source is read whole at the commit its ref stands at
 * (`skill-source.ts`), and each skill folder there is listed by what its
 * `SKILL.md` says of it. An install reads that commit again, as the
 * preview pinned it, takes the skills chosen by name, and holds each to
 * the one check (`skill-check.ts`). A skill's text becomes a one-file
 * skill under the name and description the member gave, written into its
 * frontmatter so its `SKILL.md` says of itself what the store keeps, for
 * a harness that reads it from disk.
 */

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

/** A skill an install makes, as the store keeps it, whoever's it is. */
export type MadeSkill = Omit<NewInstalledSkill, "owner">;

/** One skill folder of a source, with what its `SKILL.md` says of it. */
interface FoundSkill extends SkillHead {
  readonly folder: SkillFolder;
}

/** A source read at one commit: the repository, the ref asked, the commit, and the skills there. */
interface ReadSource {
  readonly repository: SkillRepository;
  readonly ref: string;
  readonly sha: string;
  readonly skills: readonly FoundSkill[];
}

/** What an install asks of a paste beside the paste itself. */
export interface InstallAsked {
  readonly skills?: readonly string[];
  readonly sha?: string;
  readonly name?: string;
  readonly description?: string;
}

type SourceServices = GitHubApp | HttpClient.HttpClient | DatabaseServices;

/** A GitHub source's skill folder as its `SKILL.md` names it: by its own folder's name, or the repository's for a skill at its root. */
function foundSkill(repository: SkillRepository, folder: SkillFolder): FoundSkill {
  const main = folder.files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  const fallback =
    folder.path === "" ? repository.name.toLowerCase() : folder.path.split("/").at(-1);
  return { folder, ...skillHead(main === undefined ? "" : fileText(main.bytes), fallback ?? "") };
}

/** The source reached as the member and read at the commit given, else where its ref stands now. */
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
  // Note that a name stands once, its first folder's, since an install chooses skills by name.
  const skills = found.filter((one, at) => found.findIndex(({ name }) => name === one.name) === at);
  return { repository, ref, sha: archive.sha, skills };
});

/** The skill a found folder makes, its files read at the commit, refused by name for the first check it breaks. */
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

/** Whether a frontmatter line opens the name's or the description's key, which the text's own are written over. */
const NAME_OR_DESCRIPTION = /^(?:name|description):/u;

/**
 * The text with its frontmatter's `name` and `description` the ones given,
 * each written once in place of any key and lines it held, and the
 * frontmatter made where the text opens with none.
 */
function withNameAndDescription(markdown: string, name: string, description: string): string {
  // Note that a JSON string is a YAML double-quoted scalar, so any description reads back as written.
  const head = `name: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}`;
  const unmarked = markdown.replace(/^\uFEFF/u, "");
  const fenced = SKILL_FRONTMATTER.exec(unmarked);
  if (fenced === null) return `---\n${head}\n---\n\n${unmarked}`;
  // Note that a key's value goes on over the indented and blank lines under it, up to the next key.
  let dropping = false;
  const kept = (fenced[1] ?? "").split(/\r?\n/u).filter((line) => {
    if (/^\S/u.test(line)) dropping = NAME_OR_DESCRIPTION.test(line);
    return !dropping;
  });
  return `---\n${[head, ...kept].join("\n")}\n---\n${unmarked.slice(fenced[0].length)}`;
}

/** The one-file skill a pasted text makes, under the name and description asked, else its own; refused for the first check it breaks. */
function madeFromText(
  markdown: string,
  asked: InstallAsked,
): Effect.Effect<MadeSkill, HostedRefusal> {
  const own = skillHead(markdown, "");
  const name = asked.name?.trim() ?? own.name;
  const description = asked.description?.trim() ?? own.description;
  // Note that text whose frontmatter already says both is kept as pasted.
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

/** A found skill as the preview lists it: ticked where the paste named it, or where it is the one skill there is. */
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

/** What a paste would install, read as an install reads it, installing nothing. */
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

/** The skills a paste makes, read afresh as the module's header says; a source with none of the skills chosen, or no source at all, is no request. */
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
