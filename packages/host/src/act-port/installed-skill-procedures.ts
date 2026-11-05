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

/**
 * installed-skill-procedures.ts -- Settings' Skills page's asks of the host: a workspace's skills held, one read, a paste previewed or installed, or one removed.
 *
 * The one check these procedures make is who asked: only a panel draws
 * Settings, so the takeover and any other window are refused in each
 * one's own sentence. What the service answers comes back as the panel's own
 * answer, or why there is none. Each workspace's skills are held at the
 * host while a panel holds their stream open, and reach every panel on app
 * state; how many streams stand open is all that is held here.
 */
export interface InstalledSkillProceduresDependencies {
  host: {
    /** A workspace's skills held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    installedSkillsFollow(params: InstalledSkillFollowParams): Effect.Effect<void>;
    installedSkillsUnfollow(params: InstalledSkillFollowParams): Effect.Effect<void>;
    /** A workspace's held skills asked again at once, as Try again asks; done once the ask has landed. */
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
  /** Each workspace's skills while a window holds a stream open of them, by the workspace. */
  const openSkills: OpenFollows<never> = MutableHashMap.empty();
  return {
    [KIND.INSTALLED_SKILLS_FOLLOW]: actPort[KIND.INSTALLED_SKILLS_FOLLOW].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      // Note that nothing is heard down the hold, since the held skills reach the panel on app state.
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
