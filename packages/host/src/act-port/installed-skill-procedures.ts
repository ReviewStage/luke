import type { InstalledSkillFollowParams } from "@repo/features/installed-skill-view";
import { Effect, MutableHashMap, Stream } from "effect";
import { INSTALLED_SKILL_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/**
 * installed-skill-procedures.ts -- Settings' Skills page's hold on a workspace's skills, followed and asked again.
 *
 * The one check these procedures make is who asked: only a panel draws
 * Settings, so the takeover and any other window are refused in each
 * one's own sentence. The plain asks are declared
 * (`contract/installed-skills.ts`) and answered by the installed skills'
 * composer. Each workspace's skills are held at the
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
  };
}

export function installedSkillProcedures(dependencies: InstalledSkillProceduresDependencies) {
  const { host } = dependencies;
  const KIND = INSTALLED_SKILL_ACT_KIND;
  /** Each workspace's skills while a window holds a stream open of them, by the workspace. */
  const openSkills: OpenFollows = MutableHashMap.empty();
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
  };
}
