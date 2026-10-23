import type {
  InstalledSkillIdParams,
  InstalledSkillInstallParams,
  InstalledSkillInstallView,
  InstalledSkillListParams,
  InstalledSkillListView,
  InstalledSkillPreviewFileParams,
  InstalledSkillPreviewFileView,
  InstalledSkillPreviewParams,
  InstalledSkillPreviewView,
  InstalledSkillRemovedView,
  InstalledSkillToggleParams,
  InstalledSkillUpdateCheckView,
  InstalledSkillUpdatedView,
  InstalledSkillUpdateParams,
  InstalledSkillView,
} from "@luke/features/installed-skill-view";
import { Effect } from "effect";
import { INSTALLED_SKILL_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";

/**
 * installed-skill-procedures.ts -- Settings' Skills page's asks of the host: the skills listed, a paste previewed, a previewed skill's `SKILL.md` read, a paste installed, one toggled, checked for an update, updated, or removed.
 *
 * The one check these procedures make is who asked: only a panel draws
 * Settings, so the takeover and the hidden voice window are refused in each
 * one's own sentence. What the service answers comes back as the panel's own
 * answer, or why there is none. Nothing is held here.
 */
export interface InstalledSkillProceduresDependencies {
  host: {
    installedSkillsList(params: InstalledSkillListParams): Effect.Effect<InstalledSkillListView>;
    installedSkillsPreview(
      params: InstalledSkillPreviewParams,
    ): Effect.Effect<InstalledSkillPreviewView>;
    installedSkillsPreviewFile(
      params: InstalledSkillPreviewFileParams,
    ): Effect.Effect<InstalledSkillPreviewFileView>;
    installedSkillsInstall(
      params: InstalledSkillInstallParams,
    ): Effect.Effect<InstalledSkillInstallView>;
    installedSkillsSetEnabled(
      params: InstalledSkillToggleParams,
    ): Effect.Effect<InstalledSkillView>;
    installedSkillsCheckUpdate(
      params: InstalledSkillUpdateParams,
    ): Effect.Effect<InstalledSkillUpdateCheckView>;
    installedSkillsUpdate(
      params: InstalledSkillUpdateParams,
    ): Effect.Effect<InstalledSkillUpdatedView>;
    installedSkillsRemove(params: InstalledSkillIdParams): Effect.Effect<InstalledSkillRemovedView>;
  };
}

export function installedSkillProcedures(dependencies: InstalledSkillProceduresDependencies) {
  const { host } = dependencies;
  const KIND = INSTALLED_SKILL_ACT_KIND;
  return {
    [KIND.INSTALLED_SKILLS_LIST]: actPort[KIND.INSTALLED_SKILLS_LIST].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.installedSkillsList(input);
    }),
    [KIND.INSTALLED_SKILLS_PREVIEW]: actPort[KIND.INSTALLED_SKILLS_PREVIEW].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.installedSkillsPreview(input);
    }),
    [KIND.INSTALLED_SKILLS_PREVIEW_FILE]: actPort[KIND.INSTALLED_SKILLS_PREVIEW_FILE].effect(
      function* ({ input, context, errors }) {
        if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
        return yield* host.installedSkillsPreviewFile(input);
      },
    ),
    [KIND.INSTALLED_SKILLS_INSTALL]: actPort[KIND.INSTALLED_SKILLS_INSTALL].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.installedSkillsInstall(input);
    }),
    [KIND.INSTALLED_SKILLS_SET_ENABLED]: actPort[KIND.INSTALLED_SKILLS_SET_ENABLED].effect(
      function* ({ input, context, errors }) {
        if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
        return yield* host.installedSkillsSetEnabled(input);
      },
    ),
    [KIND.INSTALLED_SKILLS_CHECK_UPDATE]: actPort[KIND.INSTALLED_SKILLS_CHECK_UPDATE].effect(
      function* ({ input, context, errors }) {
        if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
        return yield* host.installedSkillsCheckUpdate(input);
      },
    ),
    [KIND.INSTALLED_SKILLS_UPDATE]: actPort[KIND.INSTALLED_SKILLS_UPDATE].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.installedSkillsUpdate(input);
    }),
    [KIND.INSTALLED_SKILLS_REMOVE]: actPort[KIND.INSTALLED_SKILLS_REMOVE].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.installedSkillsRemove(input);
    }),
  };
}
