import type { DatabaseServices } from "@repo/database/core/query";
import {
  type InstalledSkill,
  type InstalledSkillFilesRefused,
  type InstalledSkillNameTaken,
  type InstalledSkillRead,
  installSkill,
  listInstalledSkills,
  readInstalledSkill,
  removeInstalledSkill,
  type WrittenSkill,
} from "@repo/database/models/installed-skill-store";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import { listWorkspaces, personalWorkspaceOf } from "@repo/database/models/workspace-store";
import type {
  InstalledSkillContent,
  InstalledSkillSummary,
} from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_SCOPE,
  type InstalledSkillScope,
} from "@repo/features/installed-skill-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
import { Data, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_SKILL_ACTION,
  type ServerSkillAction,
} from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  installedSkillRefused,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { parseSkillPaste } from "./skill-paste.js";
import { madeFromPaste, previewOfPaste } from "./skill-paste-install.js";

export interface InstalledSkillsProcedureSeams {
  resolveUserId: UserIdResolver;
}

const MANAGING_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
]);

interface MemberWorkspace {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly personal: boolean;
}

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

const checkedScope = /* @__PURE__ */ Effect.fnUntraced(function* (
  workspace: MemberWorkspace,
  scope: InstalledSkillScope,
): Effect.fn.Return<void, HostedRefusal> {
  if (scope === INSTALLED_SKILL_SCOPE.PERSONAL) return;
  if (workspace.personal) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
});

function summaryOf(skill: InstalledSkill, manageable: boolean): InstalledSkillSummary {
  return {
    id: skill.id,
    scope: skill.scope,
    name: skill.name,
    description: skill.description,
    userInvocable: skill.userInvocable,
    source: skill.source,
    enabled: true,
    ...(skill.organizationId === null ? undefined : { workspaceId: skill.organizationId }),
    installedBy: skill.installedByUserId,
    manageable,
    createdAt: skill.createdAt.getTime(),
    updatedAt: skill.updatedAt.getTime(),
  };
}

function contentOf(skill: InstalledSkillRead): InstalledSkillContent {
  return {
    id: skill.id,
    skillFile: new TextDecoder().decode(skill.skillFile),
    files: skill.files,
  };
}

function managedBy(userId: string, workspace: MemberWorkspace, skill: InstalledSkill): boolean {
  if (skill.scope === INSTALLED_SKILL_SCOPE.PERSONAL) return skill.ownerUserId === userId;
  return (
    skill.organizationId === workspace.id &&
    (skill.installedByUserId === userId || MANAGING_ROLES.has(workspace.role))
  );
}

function txidOf(written: WrittenSkill | undefined): { readonly txid?: string } {
  return written === undefined ? {} : { txid: written.txid };
}

class InstallNotPermitted extends Data.TaggedError("InstallNotPermitted") {}

type Settled<A> = Result.Result<A, HostedRefusal>;

function refusedAs<A>(refusal: HostedRefusal): Effect.Effect<Settled<A>> {
  return Effect.succeed(Result.fail(refusal));
}

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

const refusedWrite = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
): Effect.fn.Return<never, HostedRefusal, DatabaseServices> {
  const readable = yield* hostedStoreOrUnavailable(readInstalledSkill(userId, id));
  return yield* Effect.fail(
    Option.isSome(readable) ? HOSTED_REFUSAL.NOT_PERMITTED : HOSTED_REFUSAL.NOT_FOUND,
  );
});

function skillChanged(userId: string, action: ServerSkillAction) {
  return recordServerEvent(SERVER_EVENT.SKILL_CHANGE, { userId }, { action });
}

export function installedSkillsProcedures(seams: InstalledSkillsProcedureSeams) {
  const skills = hosted.installedSkills.use(accountMiddleware(seams.resolveUserId));
  return {
    list: skills.list.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* memberWorkspace(userId, input.workspaceId);
      const listed = yield* hostedStoreOrUnavailable(listInstalledSkills(userId, workspace.id));
      return {
        skills: listed.map((skill) => summaryOf(skill, managedBy(userId, workspace, skill))),
      };
    }),

    read: skills.read.effect(function* ({ input, context: { userId } }) {
      const id = yield* pathUuid(input.id);
      const read = yield* hostedStoreOrUnavailable(readInstalledSkill(userId, id));
      if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return contentOf(read.value);
    }),

    preview: skills.preview.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* memberWorkspace(userId, input.workspaceId);
      return yield* previewOfPaste(userId, workspace.id, parseSkillPaste(input.text));
    }),

    install: skills.install.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* memberWorkspace(userId, input.workspaceId);
      yield* checkedScope(workspace, input.scope);
      const made = yield* madeFromPaste(userId, workspace.id, parseSkillPaste(input.text), input);
      const owner =
        input.scope === INSTALLED_SKILL_SCOPE.PERSONAL
          ? { scope: INSTALLED_SKILL_SCOPE.PERSONAL }
          : { scope: INSTALLED_SKILL_SCOPE.WORKSPACE, organizationId: workspace.id };
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
      yield* skillChanged(userId, SERVER_SKILL_ACTION.INSTALL);
      return {
        skills: installed.map((skill) => summaryOf(skill, true)),
        ...txidOf(installed[0]),
      };
    }),

    remove: skills.remove.effect(function* ({ input, context: { userId } }) {
      const id = yield* pathUuid(input.id);
      const removed = yield* hostedStoreOrUnavailable(removeInstalledSkill(userId, id));
      if (Option.isNone(removed)) return yield* refusedWrite(userId, id);
      yield* skillChanged(userId, SERVER_SKILL_ACTION.REMOVE);
      return { id, txid: removed.value };
    }),
  };
}
