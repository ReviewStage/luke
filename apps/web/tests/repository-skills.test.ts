import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { REPOSITORY_SKILLS, readRepositorySkills } from "../server/hosted/repository-skills";
import { fakeGitHub } from "./support/github-app-fake";
import {
  SKILL_ENTRY,
  type SkillsRepositoryFixture,
  skillsRepository,
} from "./support/skills-repository";

/**
 * The skills a repository keeps, as the reader finds them on GitHub: the
 * folders of `.agents/skills/` and `.claude/skills/`, each `SKILL.md`'s
 * frontmatter read as the YAML a skill actually spells it, the first root's
 * skill where two name one, a link in a root no skill of its own, and a
 * folder breaking the convention, a file past the bound, or one with no
 * description left out. Synthetic repository throughout.
 */

const REPOSITORY = { fullName: "Acme/Relay", defaultBranch: "main" } as const;
const TOKEN = Redacted.make("ghs_fixture_installation_token");

/** The skills of the fixture repository read through a GitHub answering from its table alone. */
const readSkillsOf = (fixture: SkillsRepositoryFixture) => {
  const script = skillsRepository(fixture);
  const github = fakeGitHub(
    (sent) => script(sent) ?? Response.json({ message: "Not Found" }, { status: 404 }),
  );
  return readRepositorySkills(TOKEN, REPOSITORY).pipe(Effect.provide(github.layer));
};

const SKILLS: SkillsRepositoryFixture = {
  fullName: "Acme/Relay",
  branch: "main",
  roots: {
    ".agents/skills": {
      testing: SKILL_ENTRY.FOLDER,
      drizzle: SKILL_ENTRY.FOLDER,
      "release-notes": SKILL_ENTRY.FOLDER,
      deploy: SKILL_ENTRY.FOLDER,
      Bad_Name: SKILL_ENTRY.FOLDER,
      undescribed: SKILL_ENTRY.FOLDER,
      huge: SKILL_ENTRY.FOLDER,
      empty: SKILL_ENTRY.FOLDER,
      plain: SKILL_ENTRY.FOLDER,
      misnamed: SKILL_ENTRY.FOLDER,
    },
    ".claude/skills": {
      testing: SKILL_ENTRY.LINK,
      drizzle: SKILL_ENTRY.FOLDER,
      empty: SKILL_ENTRY.FOLDER,
      "claude-only": SKILL_ENTRY.FOLDER,
    },
  },
  files: {
    ".agents/skills/testing/SKILL.md":
      "---\nname: testing\ndescription: Use for Vitest tests, mocks, coverage. # routing hint\n---\n\n# Testing\n\nRun the tests.\n",
    ".agents/skills/drizzle/SKILL.md":
      "---\nname: drizzle\ndescription: 'Use for Drizzle schemas: tables, ''indexes'', joins.'\nuser-invocable: false\nmetadata:\n  author: lobehub\n---\nWrite the schema first.",
    ".claude/skills/drizzle/SKILL.md":
      "---\ndescription: The Claude Code copy, shadowed by the first root's.\n---\nShadowed.",
    ".agents/skills/release-notes/SKILL.md":
      '---\ndescription: >\n  Use when the developer asks\n  for release notes.\nlicense: "MIT \\u2014 see LICENSE"\n---\r\nOne line per change.',
    ".agents/skills/deploy/SKILL.md":
      '---\nname: deploy\ndescription: "Use to deploy: \\"preview\\" first, then production."\n---\nDeploy.',
    ".agents/skills/plain/SKILL.md":
      "---\nname: plain\ndescription: Use when a plain scalar\n  runs on to a second line.\n---\nPlain.",
    ".agents/skills/Bad_Name/SKILL.md": "---\ndescription: Breaks the naming rule.\n---\nNo.",
    ".agents/skills/misnamed/SKILL.md":
      "---\nname: other-name\ndescription: Names another.\n---\nNo.",
    ".claude/skills/empty/SKILL.md":
      "---\ndescription: Kept in the Claude root where the first root's folder holds no file.\n---\nFallback.",
    ".agents/skills/undescribed/SKILL.md": "---\nname: undescribed\n---\nNo description.",
    ".agents/skills/huge/SKILL.md": "---\ndescription: Too large to read.\n---\n",
    ".claude/skills/claude-only/SKILL.md":
      "---\nname: claude-only\ndescription: |\n  Line one.\n  Line two.\n---\nKept in the Claude root alone.",
  },
  sizes: { ".agents/skills/huge/SKILL.md": REPOSITORY_SKILLS.MAX_FILE_BYTES + 1 },
};

it.effect(
  "the skills of both roots are read from their frontmatter in name order, the first root's where two name one and the next root's where the first's holds none, and a link, a misnamed folder, a file naming another skill, a file past the bound, a missing file, and one with no description are left out",
  () =>
    Effect.gen(function* () {
      const skills = yield* readSkillsOf(SKILLS);
      assert.deepEqual(
        skills.map(({ name, description, folder, userInvocable }) => ({
          name,
          description,
          folder,
          userInvocable,
        })),
        [
          {
            name: "claude-only",
            description: "Line one.\nLine two.",
            folder: ".claude/skills/claude-only",
            userInvocable: true,
          },
          {
            name: "deploy",
            description: 'Use to deploy: "preview" first, then production.',
            folder: ".agents/skills/deploy",
            userInvocable: true,
          },
          {
            name: "drizzle",
            description: "Use for Drizzle schemas: tables, 'indexes', joins.",
            folder: ".agents/skills/drizzle",
            userInvocable: false,
          },
          {
            name: "empty",
            description: "Kept in the Claude root where the first root's folder holds no file.",
            folder: ".claude/skills/empty",
            userInvocable: true,
          },
          {
            name: "plain",
            description: "Use when a plain scalar runs on to a second line.",
            folder: ".agents/skills/plain",
            userInvocable: true,
          },
          {
            name: "release-notes",
            description: "Use when the developer asks for release notes.",
            folder: ".agents/skills/release-notes",
            userInvocable: true,
          },
          {
            name: "testing",
            description: "Use for Vitest tests, mocks, coverage.",
            folder: ".agents/skills/testing",
            userInvocable: true,
          },
        ],
      );
      assert.equal(
        skills.find((skill) => skill.name === "testing")?.markdown,
        "# Testing\n\nRun the tests.",
      );
      assert.equal(
        skills.find((skill) => skill.name === "drizzle")?.markdown,
        "Write the schema first.",
      );
      assert.equal(
        skills.find((skill) => skill.name === "release-notes")?.markdown,
        "One line per change.",
      );
    }),
);

it.effect("a repository with neither root keeps no skills", () =>
  Effect.gen(function* () {
    const skills = yield* readSkillsOf({ ...SKILLS, roots: {}, files: {} });
    assert.deepEqual(skills, []);
  }),
);

it.effect(
  "a repository keeping more skills than the bound is read to the bound, in name order",
  () =>
    Effect.gen(function* () {
      const names = Array.from(
        { length: REPOSITORY_SKILLS.MAX_SKILLS + 6 },
        (_, at) => `skill-${String(at).padStart(3, "0")}`,
      );
      const skills = yield* readSkillsOf({
        fullName: "Acme/Relay",
        branch: "main",
        roots: {
          ".agents/skills": Object.fromEntries(names.map((name) => [name, SKILL_ENTRY.FOLDER])),
        },
        files: Object.fromEntries(
          names.map((name) => [
            `.agents/skills/${name}/SKILL.md`,
            `---\ndescription: Use for ${name}.\n---\nBody.`,
          ]),
        ),
      });
      assert.deepEqual(
        skills.map((skill) => skill.name),
        names.slice(0, REPOSITORY_SKILLS.MAX_SKILLS),
      );
    }),
);

it.effect("folders that hold no skill do not crowd out a skill past the bound on skills", () =>
  Effect.gen(function* () {
    const hollow = Array.from(
      { length: REPOSITORY_SKILLS.MAX_SKILLS },
      (_, at) => `hollow-${String(at).padStart(3, "0")}`,
    );
    const skills = yield* readSkillsOf({
      fullName: "Acme/Relay",
      branch: "main",
      roots: {
        ".agents/skills": Object.fromEntries(
          [...hollow, "zz-release"].map((name) => [name, SKILL_ENTRY.FOLDER]),
        ),
      },
      files: {
        ".agents/skills/zz-release/SKILL.md": "---\ndescription: Use to release.\n---\nRelease.",
      },
    });
    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["zz-release"],
    );
  }),
);

it.effect("a description longer than the convention's bound is cut at it", () =>
  Effect.gen(function* () {
    const long = "x".repeat(REPOSITORY_SKILLS.MAX_DESCRIPTION_CHARS + 50);
    const [skill] = yield* readSkillsOf({
      fullName: "Acme/Relay",
      branch: "main",
      roots: { ".agents/skills": { wordy: SKILL_ENTRY.FOLDER } },
      files: { ".agents/skills/wordy/SKILL.md": `---\ndescription: ${long}\n---\nBody.` },
    });
    assert.equal(skill?.description, long.slice(0, REPOSITORY_SKILLS.MAX_DESCRIPTION_CHARS));
  }),
);

it.effect("GitHub failing fails the read as unavailable", () =>
  Effect.gen(function* () {
    const github = fakeGitHub(() => Response.json({ message: "Server Error" }, { status: 502 }));
    const failed = yield* readRepositorySkills(TOKEN, REPOSITORY).pipe(
      Effect.provide(github.layer),
      Effect.flip,
    );
    assert.equal(failed._tag, "GitHubUnavailable");
  }),
);
