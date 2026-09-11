/**
 * Skill discovery and loading in Effect's own terms. `skills.ts` is a port of
 * OpenClaw `b7528507` and stays faithful to it — it imports nothing from
 * `effect` — so everything Effect needs of it lives here beside it. Neither
 * `discoverSkills` nor `loadSkill` ever rejects: each swallows its own
 * filesystem failure into the answer it already gives (an empty list, or a
 * refused load), so both are `Effect.promise` rather than `Effect.tryPromise`,
 * and `loadSkill`'s refusal becomes a tagged error over a code this sibling
 * states for the two reasons the port already distinguishes.
 */
import { Data, Effect } from "effect";
import type { SkillDescriptor } from "./registry.js";
import { discoverSkills, loadSkill } from "./skills.js";

/** Why a skill load answered refused; the two reasons `loadSkill` already distinguishes. */
export const SKILL_LOAD_REFUSAL = {
  NOT_ELIGIBLE: "not-eligible",
  UNREADABLE: "unreadable",
} as const;

export type SkillLoadRefusal = (typeof SKILL_LOAD_REFUSAL)[keyof typeof SKILL_LOAD_REFUSAL];

export class SkillLoadRefused extends Data.TaggedError("SkillLoadRefused")<{
  readonly code: SkillLoadRefusal;
  readonly location: string;
}> {}

/** Walks each root one level deep for `<skill>/SKILL.md`; a root that does not exist lists nothing. */
export const discoverSkillsEffect = (
  roots: readonly string[],
): Effect.Effect<readonly SkillDescriptor[]> => Effect.promise(() => discoverSkills(roots));

const NOT_ELIGIBLE_REASON = "not an eligible skill";

/**
 * Loads one skill's whole instructions on demand, failing with
 * `SkillLoadRefused` where the port answers `ok: false`: the location named
 * one no eligible descriptor listed, or the file could not be read.
 */
export const loadSkillEffect = (
  location: string,
  eligible: readonly SkillDescriptor[],
  maximumChars?: number,
): Effect.Effect<
  { readonly instructions: string; readonly truncated: boolean },
  SkillLoadRefused
> =>
  Effect.flatMap(
    Effect.promise(() =>
      maximumChars === undefined
        ? loadSkill(location, eligible)
        : loadSkill(location, eligible, maximumChars),
    ),
    (result) =>
      result.ok
        ? Effect.succeed({ instructions: result.instructions, truncated: result.truncated })
        : Effect.fail(
            new SkillLoadRefused({
              code:
                result.reason === NOT_ELIGIBLE_REASON
                  ? SKILL_LOAD_REFUSAL.NOT_ELIGIBLE
                  : SKILL_LOAD_REFUSAL.UNREADABLE,
              location,
            }),
          ),
  );
