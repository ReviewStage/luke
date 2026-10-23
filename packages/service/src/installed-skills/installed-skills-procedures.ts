/**
 * installed-skills-procedures.ts -- the skills members install into Luke: list the ones a workspace offers the account, read one, preview a paste and read one of its skills' `SKILL.md`, install from it, turn one on or off, check one for an update or update it, share a personal one with a workspace, and remove it.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the
 * resource so it runs before an input is read) before it touches a row.
 * The store gates every row in SQL (`installed-skill-store.ts`): a personal
 * skill is its owner's alone, and a workspace skill is installed and read
 * by any of the workspace's members and managed by its installer while
 * still a member or by its owners and admins, as an automation is
 * changed, so a skill
 * the account cannot read answers as not found, and one it reads but may
 * not manage as not permitted. A workspace named in a request must be one
 * the account is a member of, and a workspace skill is refused in the
 * account's personal workspace, where everything is its own, as an
 * automation's workspace scope is.
 *
 * A paste is read afresh on every request (`skill-paste-install.ts`), and
 * its GitHub source through the workspace named, which is the
 * installation that reads it. Every skill an install makes is written in
 * one transaction, so a name already taken among several installs none.
 * An update reads a GitHub skill's folder at the commit its ref stands at
 * now and replaces its files; the check before it compares the folder's
 * tree at that commit with the one pinned, so a busy repository whose
 * skill did not move offers no update. A share moves the account's own
 * personal skill into a workspace it is a member of, never its personal
 * one, on the same rule as an install's scope.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type InstalledSkill,
  type InstalledSkillFilesRefused,
  type InstalledSkillNameTaken,
  type InstalledSkillWithFiles,
  installSkill,
  listInstalledSkills,
  readInstalledSkill,
  removeInstalledSkill,
  setInstalledSkillEnabled,
  shareInstalledSkill,
  updateInstalledSkill,
} from "@luke/database/models/installed-skill-store";
import type { TaskStoreFailure } from "@luke/database/models/task-store";
import { listWorkspaces, personalWorkspaceOf } from "@luke/database/models/workspace-store";
import type {
  InstalledSkillContent,
  InstalledSkillSummary,
} from "@luke/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
  type InstalledSkillScope,
} from "@luke/features/installed-skill-wire";
import { parseSkillPaste } from "@luke/features/skill-paste";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@luke/features/workspace-wire";
import { Data, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  installedSkillRefused,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  madeFromPaste,
  previewedSkillFile,
  previewOfPaste,
  revisionAtRef,
} from "./skill-paste-install.js";
import { folderTreeSha, pinnedCommit, reachSkillRepository } from "./skill-source.js";

export interface InstalledSkillsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The roles that manage a workspace's skills. */
const MANAGING_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
]);

/** A workspace the account is a member of: its id, the account's role there, and whether it is the account's personal one. */
interface MemberWorkspace {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly personal: boolean;
}

/** The workspace as the account is a member of it; not found where it is not. */
const memberWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<MemberWorkspace, HostedRefusal, DatabaseServices> {
  const workspaces = yield* hostedStoreOrUnavailable(listWorkspaces(userId));
  const workspace = workspaces.find((one) => one.id === workspaceId);
  if (workspace === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const personal = yield* hostedStoreOrUnavailable(personalWorkspaceOf(userId));
  return {
    id: workspace.id,
    role: workspace.role,
    personal: Option.contains(personal, workspace.id),
  };
});

/**
 * The scope the account may install in: its own, anywhere; the
 * workspace's, as any member, but never in its personal workspace, where
 * a workspace skill would be a personal one by another name.
 */
const checkedScope = /* @__PURE__ */ Effect.fnUntraced(function* (
  workspace: MemberWorkspace,
  scope: InstalledSkillScope,
): Effect.fn.Return<void, HostedRefusal> {
  if (scope === INSTALLED_SKILL_SCOPE.PERSONAL) return;
  if (workspace.personal) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
});

/** One skill for the wire, whether the account may manage it said by the caller, which knows its role. */
function summaryOf(skill: InstalledSkill, manageable: boolean): InstalledSkillSummary {
  return {
    id: skill.id,
    scope: skill.scope,
    name: skill.name,
    description: skill.description,
    userInvocable: skill.userInvocable,
    source: skill.source,
    enabled: skill.enabled,
    ...(skill.organizationId === null ? undefined : { workspaceId: skill.organizationId }),
    installedBy: skill.installedByUserId,
    manageable,
    createdAt: skill.createdAt.getTime(),
    updatedAt: skill.updatedAt.getTime(),
  };
}

/** One skill read whole for the wire: its `SKILL.md` as text, and every file's path and size. */
function contentOf(skill: InstalledSkillWithFiles): InstalledSkillContent {
  const main = skill.files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  return {
    id: skill.id,
    skillFile: main === undefined ? "" : new TextDecoder().decode(main.bytes),
    files: skill.files.map((file) => ({ path: file.path, bytes: file.bytes.byteLength })),
  };
}

/**
 * Whether the account manages the skill, as the store's rule reads: its
 * own personal one, or its workspace's as the skill's installer or as an
 * owner or admin, a member of the workspace either way.
 */
function managedBy(userId: string, workspace: MemberWorkspace, skill: InstalledSkill): boolean {
  if (skill.scope === INSTALLED_SKILL_SCOPE.PERSONAL) return skill.ownerUserId === userId;
  return (
    skill.organizationId === workspace.id &&
    (skill.installedByUserId === userId || MANAGING_ROLES.has(workspace.role))
  );
}

/** An install the store refused, since the account is no longer a member of the workspace it installs in; it undoes the transaction it stands in. */
class InstallNotPermitted extends Data.TaggedError("InstallNotPermitted") {}

/** A write's value, or the refusal the store's own error became. */
type Settled<A> = Result.Result<A, HostedRefusal>;

function refusedAs<A>(refusal: HostedRefusal): Effect.Effect<Settled<A>> {
  return Effect.succeed(Result.fail(refusal));
}

/**
 * A store write's own refusals carried onto the answer channel: a name
 * taken, files refused (by the skill's name), an install not permitted,
 * and a store that failed.
 */
function storeWrite<A, R>(
  effect: Effect.Effect<
    A,
    TaskStoreFailure | InstalledSkillNameTaken | InstalledSkillFilesRefused | InstallNotPermitted,
    R
  >,
  name: string | undefined,
): Effect.Effect<A, HostedRefusal, R> {
  const settled = effect.pipe(
    Effect.map((value): Settled<A> => Result.succeed(value)),
    Effect.catchTags({
      InstalledSkillNameTaken: (taken) =>
        refusedAs<A>(installedSkillRefused(HOSTED_REFUSAL.SKILL_NAME_TAKEN, taken.name)),
      InstalledSkillFilesRefused: (refused) =>
        refusedAs<A>(
          installedSkillRefused(HOSTED_REFUSAL.SKILL_FILES_REFUSED, name, refused.reason),
        ),
      InstallNotPermitted: () => refusedAs<A>(HOSTED_REFUSAL.NOT_PERMITTED),
    }),
  );
  return Effect.flatMap(hostedStoreOrUnavailable(settled), (result) =>
    Result.isSuccess(result) ? Effect.succeed(result.success) : Effect.fail(result.failure),
  );
}

/** The skill named among the ones the account sees in the workspace; not found where it is none of them. */
const visibleSkill = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspace: MemberWorkspace,
  id: string,
): Effect.fn.Return<InstalledSkill, HostedRefusal, DatabaseServices> {
  const listed = yield* hostedStoreOrUnavailable(listInstalledSkills(userId, workspace.id));
  const skill = listed.find((one) => one.id === id);
  if (skill === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return skill;
});

/** Why a write the store refused was refused: not permitted where the account still reads the skill, not found where it does not. */
const refusedWrite = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
): Effect.fn.Return<never, HostedRefusal, DatabaseServices> {
  const readable = yield* hostedStoreOrUnavailable(readInstalledSkill(userId, id));
  return yield* Effect.fail(
    Option.isSome(readable) ? HOSTED_REFUSAL.NOT_PERMITTED : HOSTED_REFUSAL.NOT_FOUND,
  );
});

/** The installed skills resource: every procedure to a signed-in caller. */
export function installedSkillsProcedures(seams: InstalledSkillsProcedureSeams) {
  const skills = hosted.installedSkills.use(accountMiddleware(seams.resolveUserId));
  return {
    /** The skills the account sees in the workspace: the workspace's, then its own. */
    list: skills.list.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* memberWorkspace(userId, input.workspaceId);
      const listed = yield* hostedStoreOrUnavailable(listInstalledSkills(userId, workspace.id));
      return {
        skills: listed.map((skill) => summaryOf(skill, managedBy(userId, workspace, skill))),
      };
    }),

    /** One skill the account reads, whole: its `SKILL.md` and its files. */
    read: skills.read.effect(function* ({ input, context: { userId } }) {
      const id = yield* pathUuid(input.id);
      const read = yield* hostedStoreOrUnavailable(readInstalledSkill(userId, id));
      if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return contentOf(read.value);
    }),

    /** What a paste would install, read as an install reads it; nothing is written. */
    preview: skills.preview.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* memberWorkspace(userId, input.workspaceId);
      return yield* previewOfPaste(userId, workspace.id, parseSkillPaste(input.text));
    }),

    /** One previewed skill's `SKILL.md` at the commit the preview pinned, for a skill the preview carried none of. */
    previewFile: skills.previewFile.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* memberWorkspace(userId, input.workspaceId);
      return yield* previewedSkillFile(userId, workspace.id, input);
    }),

    /** The skills a paste makes, installed in the scope asked, all or none. */
    install: skills.install.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* memberWorkspace(userId, input.workspaceId);
      yield* checkedScope(workspace, input.scope);
      const made = yield* madeFromPaste(userId, workspace.id, parseSkillPaste(input.text), {
        ...(input.skills === undefined ? undefined : { skills: input.skills }),
        ...(input.name === undefined ? undefined : { name: input.name }),
        ...(input.description === undefined ? undefined : { description: input.description }),
      });
      const owner =
        input.scope === INSTALLED_SKILL_SCOPE.PERSONAL
          ? { scope: INSTALLED_SKILL_SCOPE.PERSONAL }
          : { scope: INSTALLED_SKILL_SCOPE.WORKSPACE, organizationId: workspace.id };
      // Note that the store's own transactions nest as savepoints, so one refusal undoes every install before it.
      const installed = yield* storeWrite(
        Effect.flatMap(SqlClient.SqlClient, (client) =>
          client.withTransaction(
            Effect.forEach(made, (skill) =>
              Effect.flatMap(installSkill(userId, { ...skill, owner }), (written) =>
                Option.isSome(written)
                  ? Effect.succeed(written.value)
                  : Effect.fail(new InstallNotPermitted()),
              ),
            ),
          ),
        ),
        made.length === 1 ? made[0]?.name : undefined,
      );
      return { skills: installed.map((skill) => summaryOf(skill, true)) };
    }),

    /** One skill turned on or off. */
    setEnabled: skills.setEnabled.effect(function* ({
      input: { params, body },
      context: { userId },
    }) {
      const id = yield* pathUuid(params.id);
      const written = yield* hostedStoreOrUnavailable(
        setInstalledSkillEnabled(userId, id, body.enabled),
      );
      if (Option.isNone(written)) return yield* refusedWrite(userId, id);
      return { skill: summaryOf(written.value, true) };
    }),

    /** Whether a GitHub skill's folder moved at its ref since it was pinned; never for a pasted one. */
    checkUpdate: skills.checkUpdate.effect(function* ({ input, context: { userId } }) {
      const id = yield* pathUuid(input.id);
      const workspace = yield* memberWorkspace(userId, input.workspaceId);
      const skill = yield* visibleSkill(userId, workspace, id);
      const { source } = skill;
      if (source.type !== INSTALLED_SKILL_SOURCE.GITHUB) return { available: false };
      const repository = yield* reachSkillRepository(
        workspace.id,
        source.owner,
        source.repo,
        userId,
      );
      const latest = yield* pinnedCommit(repository, source.ref);
      if (latest.sha === source.sha) return { available: false, latestSha: latest.sha };
      const [pinned, now] = yield* Effect.all(
        [
          folderTreeSha(repository, source.sha, source.path),
          folderTreeSha(repository, latest.sha, source.path),
        ],
        { concurrency: 2 },
      );
      // A folder gone at the ref offers nothing to update to.
      return { available: now !== undefined && now !== pinned, latestSha: latest.sha };
    }),

    /** A GitHub skill's files read again at its ref and put in place of its own. */
    update: skills.update.effect(function* ({ input: { params, body }, context: { userId } }) {
      const id = yield* pathUuid(params.id);
      const workspace = yield* memberWorkspace(userId, body.workspaceId);
      const skill = yield* visibleSkill(userId, workspace, id);
      if (!managedBy(userId, workspace, skill))
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      const { source } = skill;
      if (source.type !== INSTALLED_SKILL_SOURCE.GITHUB) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      const repository = yield* reachSkillRepository(
        workspace.id,
        source.owner,
        source.repo,
        userId,
      );
      const revision = yield* revisionAtRef(repository, skill.name, source);
      const written = yield* storeWrite(updateInstalledSkill(userId, id, revision), skill.name);
      if (Option.isNone(written)) return yield* refusedWrite(userId, id);
      return {
        skill: summaryOf(written.value, true),
        changed: written.value.computedHash !== skill.computedHash,
      };
    }),

    /** The account's own personal skill moved into a workspace it is a member of. */
    share: skills.share.effect(function* ({ input: { params, body }, context: { userId } }) {
      const id = yield* pathUuid(params.id);
      const workspace = yield* memberWorkspace(userId, body.workspaceId);
      yield* checkedScope(workspace, INSTALLED_SKILL_SCOPE.WORKSPACE);
      const written = yield* storeWrite(shareInstalledSkill(userId, id, workspace.id), undefined);
      if (Option.isNone(written)) return yield* refusedWrite(userId, id);
      return { skill: summaryOf(written.value, true) };
    }),

    /** One skill removed with its files. */
    remove: skills.remove.effect(function* ({ input, context: { userId } }) {
      const id = yield* pathUuid(input.id);
      const removed = yield* hostedStoreOrUnavailable(removeInstalledSkill(userId, id));
      if (!removed) return yield* refusedWrite(userId, id);
      return { id };
    }),
  };
}
