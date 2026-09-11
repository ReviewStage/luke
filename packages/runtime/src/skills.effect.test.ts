import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { SkillDescriptor } from "./registry.js";
import { discoverSkillsEffect, loadSkillEffect, SKILL_LOAD_REFUSAL } from "./skills.effect.js";

async function temporaryDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "luke-skills-effect-"));
}

async function writeSkill(root: string, name: string, frontMatter: string): Promise<string> {
  const directory = path.join(root, name);
  await fs.mkdir(directory, { recursive: true });
  const location = path.join(directory, "SKILL.md");
  await fs.writeFile(location, frontMatter);
  return location;
}

describe("discoverSkillsEffect", () => {
  it.effect("lists every skill found under the roots", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(temporaryDirectory);
      yield* Effect.promise(() =>
        writeSkill(
          root,
          "reviewer",
          "---\nname: reviewer\ndescription: reviews a diff\n---\ninstructions\n",
        ),
      );

      const skills = yield* discoverSkillsEffect([root]);

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["reviewer"],
      );
    }),
  );

  it.effect("lists nothing under a root that does not exist", () =>
    Effect.gen(function* () {
      const skills = yield* discoverSkillsEffect(["/no/such/skills/root"]);

      assert.deepEqual(skills, []);
    }),
  );
});

describe("loadSkillEffect", () => {
  it.effect("answers the skill's instructions when it is eligible", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(temporaryDirectory);
      const location = yield* Effect.promise(() =>
        writeSkill(root, "reviewer", "---\nname: reviewer\n---\nfull instructions\n"),
      );
      const eligible: readonly SkillDescriptor[] = [
        { id: "reviewer", name: "reviewer", description: "", location, enabled: true, agents: [] },
      ];

      const load = yield* loadSkillEffect(location, eligible);

      assert.equal(load.instructions, "---\nname: reviewer\n---\nfull instructions\n");
      assert.equal(load.truncated, false);
    }),
  );

  it.effect("refuses a location no eligible descriptor listed", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(loadSkillEffect("/no/such/skill/SKILL.md", []));

      assert.equal(error._tag, "SkillLoadRefused");
      assert.equal(error.code, SKILL_LOAD_REFUSAL.NOT_ELIGIBLE);
    }),
  );

  it.effect("refuses a listed location that cannot be read", () =>
    Effect.gen(function* () {
      const location = "/no/such/skill/SKILL.md";
      const eligible: readonly SkillDescriptor[] = [
        { id: "reviewer", name: "reviewer", description: "", location, enabled: true, agents: [] },
      ];

      const error = yield* Effect.flip(loadSkillEffect(location, eligible));

      assert.equal(error.code, SKILL_LOAD_REFUSAL.UNREADABLE);
    }),
  );
});
