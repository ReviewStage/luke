import type {
  InstalledSkillContentView,
  InstalledSkillFollowParams,
  InstalledSkillIdParams,
  InstalledSkillInstallParams,
  InstalledSkillInstallView,
  InstalledSkillPreviewParams,
  InstalledSkillPreviewView,
  InstalledSkillRemovedView,
} from "@repo/features/installed-skill-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { INSTALLED_SKILL_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

export interface InstalledSkillProceduresDependencies {
  host: {
    installedSkillsFollow(params: InstalledSkillFollowParams): Effect.Effect<void>;
    installedSkillsUnfollow(params: InstalledSkillFollowParams): Effect.Effect<void>;
    installedSkillsRetry(params: InstalledSkillFollowParams): Effect.Effect<void>;
    installedSkillsRead(params: InstalledSkillIdParams): Effect.Effect<InstalledSkillContentView>;
    installedSkillsPreview(
      params: InstalledSkillPreviewParams,
    ): Effect.Effect<InstalledSkillPreviewView>;
    installedSkillsInstall(
      params: InstalledSkillInstallParams,
    ): Effect.Effect<InstalledSkillInstallView>;
    installedSkillsRemove(params: InstalledSkillIdParams): Effect.Effect<InstalledSkillRemovedView>;
  };
}

export function installedSkillProcedures(dependencies: InstalledSkillProceduresDependencies) {
  const { host } = dependencies;
  const KIND = INSTALLED_SKILL_ACT_KIND;
  const openSkills: OpenFollows<never> = MutableHashMap.empty();
  return {
    [KIND.INSTALLED_SKILLS_FOLLOW]: actPort[KIND.INSTALLED_SKILLS_FOLLOW].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (held: InstalledSkillFollowParams) => held.workspaceId,
          follow: host.installedSkillsFollow,
          unfollow: host.installedSkillsUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openSkills,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [KIND.INSTALLED_SKILLS_RETRY]: actPort[KIND.INSTALLED_SKILLS_RETRY].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      yield* host.installedSkillsRetry(input);
    }),
    [KIND.INSTALLED_SKILLS_READ]: actPort[KIND.INSTALLED_SKILLS_READ].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.installedSkillsRead(input);
    }),
    [KIND.INSTALLED_SKILLS_PREVIEW]: actPort[KIND.INSTALLED_SKILLS_PREVIEW].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.installedSkillsPreview(input);
    }),
    [KIND.INSTALLED_SKILLS_INSTALL]: actPort[KIND.INSTALLED_SKILLS_INSTALL].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.installedSkillsInstall(input);
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
