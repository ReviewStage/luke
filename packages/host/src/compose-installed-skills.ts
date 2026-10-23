import type {
  HostedInstalledSkillClient,
  InstalledSkillCallResult,
} from "@luke/features/installed-skill-client";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillContentView,
  type InstalledSkillFailedView,
  type InstalledSkillInstallView,
  type InstalledSkillListView,
  type InstalledSkillPreviewFileView,
  type InstalledSkillPreviewView,
  type InstalledSkillRemovedView,
  type InstalledSkillUpdateCheckView,
  type InstalledSkillUpdatedView,
  type InstalledSkillView,
  installedSkillIdParamsSchema,
  installedSkillInstallParamsSchema,
  installedSkillListParamsSchema,
  installedSkillPreviewFileParamsSchema,
  installedSkillPreviewParamsSchema,
  installedSkillShareParamsSchema,
  installedSkillToggleParamsSchema,
  installedSkillUpdateParamsSchema,
} from "@luke/features/installed-skill-view";
import { carried, GATEWAY_METHOD, type GatewayMethodTable, readParams } from "@luke/gateway";
import { Effect, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-installed-skills.ts -- the skills the account installs into Luke, asked of the service on the window's behalf: listed, one read, a paste previewed and installed, a previewed skill's `SKILL.md` read, one toggled, checked for an update, updated, shared with a workspace, or removed.
 *
 * Nothing is held here. Every ask is one call of the service answered whole,
 * as the window's view of it: the service's answer, or the failure with the
 * skill it names and why its files were refused. Behind a closed account
 * gate, or on a run that sends nothing, every ask answers unanswered.
 */

/** The service's side of installed skills, as this concern asks it. */
export type InstalledSkillsClient = Pick<
  HostedInstalledSkillClient,
  | "list"
  | "read"
  | "preview"
  | "previewFile"
  | "install"
  | "setEnabled"
  | "checkUpdate"
  | "update"
  | "share"
  | "remove"
>;

export interface InstalledSkillsDependencies {
  kernel: { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: InstalledSkillsClient;
}

export type InstalledSkillsComposer = Composer;

const UNANSWERED = { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED } as const;

/** A client's result as the window's view: the answer shaped by `shape`, or the failure with what it names. */
function viewOf<Answer, View>(
  result: InstalledSkillCallResult<Answer>,
  shape: (answer: Answer) => View,
): View | InstalledSkillFailedView {
  if (result.ok) return shape(result.answer);
  const { failure, skillName, skillRefusal } = result;
  return {
    failure,
    ...(skillName === undefined ? undefined : { skillName }),
    ...(skillRefusal === undefined ? undefined : { skillRefusal }),
  };
}

export function composeInstalledSkills(
  dependencies: InstalledSkillsDependencies,
): Effect.Effect<InstalledSkillsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    return composed(dependencies, yield* HttpClient.HttpClient);
  });
}

/** The composer's one table, built from its seams; nothing here starts anything. */
function composed(
  dependencies: InstalledSkillsDependencies,
  http: HttpClient.HttpClient,
): InstalledSkillsComposer {
  const { kernel, account, client } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /** The service asked behind the gate, over the host's own HTTP client, its result as the window's view. */
  const asked = <Answer, View>(
    call: Effect.Effect<InstalledSkillCallResult<Answer>, never, HttpClient.HttpClient>,
    shape: (answer: Answer) => View,
  ): Effect.Effect<View | InstalledSkillFailedView> =>
    gate()
      ? Effect.map(Effect.provideService(call, HttpClient.HttpClient, http), (result) =>
          viewOf(result, shape),
        )
      : Effect.succeed(UNANSWERED);

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.INSTALLED_SKILLS_LIST]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          installedSkillListParamsSchema,
          params,
          "a list names a workspace",
        );
        const view = yield* asked(client.list(workspaceId), (skills) => ({ skills }));
        return carried<InstalledSkillListView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_READ]: (params) =>
      Effect.gen(function* () {
        const { skillId } = yield* readParams(
          installedSkillIdParamsSchema,
          params,
          "a read names a skill",
        );
        const view = yield* asked(client.read(skillId), (content) => content);
        return carried<InstalledSkillContentView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, text } = yield* readParams(
          installedSkillPreviewParamsSchema,
          params,
          "a preview names a workspace and a paste",
        );
        const view = yield* asked(client.preview(workspaceId, text), (preview) => preview);
        return carried<InstalledSkillPreviewView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW_FILE]: (params) =>
      Effect.gen(function* () {
        const candidate = yield* readParams(
          installedSkillPreviewFileParamsSchema,
          params,
          "a previewed skill names a workspace, a repository, a commit, and a folder",
        );
        const view = yield* asked(client.previewFile(candidate), (markdown) => ({ markdown }));
        return carried<InstalledSkillPreviewFileView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL]: (params) =>
      Effect.gen(function* () {
        const install = yield* readParams(
          installedSkillInstallParamsSchema,
          params,
          "an install names a workspace, a scope, and a paste",
        );
        const view = yield* asked(client.install(install), (skills) => ({ skills }));
        return carried<InstalledSkillInstallView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_SET_ENABLED]: (params) =>
      Effect.gen(function* () {
        const { skillId, enabled } = yield* readParams(
          installedSkillToggleParamsSchema,
          params,
          "a toggle names a skill and whether it is on",
        );
        const view = yield* asked(client.setEnabled(skillId, enabled), (skill) => ({ skill }));
        return carried<InstalledSkillView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_CHECK_UPDATE]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, skillId } = yield* readParams(
          installedSkillUpdateParamsSchema,
          params,
          "an update check names a workspace and a skill",
        );
        const view = yield* asked(client.checkUpdate(workspaceId, skillId), (check) => check);
        return carried<InstalledSkillUpdateCheckView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_UPDATE]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, skillId } = yield* readParams(
          installedSkillUpdateParamsSchema,
          params,
          "an update names a workspace and a skill",
        );
        const view = yield* asked(client.update(workspaceId, skillId), (updated) => updated);
        return carried<InstalledSkillUpdatedView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_SHARE]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, skillId } = yield* readParams(
          installedSkillShareParamsSchema,
          params,
          "a share names a workspace and a skill",
        );
        const view = yield* asked(client.share(workspaceId, skillId), (skill) => ({ skill }));
        return carried<InstalledSkillView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_REMOVE]: (params) =>
      Effect.gen(function* () {
        const { skillId } = yield* readParams(
          installedSkillIdParamsSchema,
          params,
          "a removal names a skill",
        );
        const view = yield* asked(client.remove(skillId), (id) => ({ id }));
        return carried<InstalledSkillRemovedView>(view);
      }),
  };

  return { methods, lifetime: Effect.void };
}
