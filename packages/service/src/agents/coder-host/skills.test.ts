import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { createAgent } from "@repo/database/models/agent-store";
import {
  type InstalledSkillFile,
  type InstalledSkillOwner,
  installSkill,
} from "@repo/database/models/installed-skill-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import { EXPERIMENT } from "@repo/settings";
import { noNetwork } from "@repo/wire/testing";
import { sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../../testing/github-app-fake.js";
import { SKILL_ROOT } from "../repository-skills.js";
import { nativeSkills } from "./skills.js";

/**
 * The installed skills a native harness is handed, through `nativeSkills`
 * over the real migrations on PGlite and a GitHub answering the agent's
 * repository's skills: the workspace's, then the member's personal ones, a
 * name offered once by the earliest, less a name the repository holds where
 * the harness reads it; none while the member
 * has the Skills experiment off; and an installed read that fails offering
 * none.
 *
 * Synthetic accounts, repositories, and skills throughout.
 */

const REPOSITORY = "acme/relay";

const text = (value: string) => new TextEncoder().encode(value);

const skillText = (name: string, words: string) =>
  `---\nname: ${name}\ndescription: Does ${name}.\n---\n${words}\n`;

/** A GitHub reaching acme/relay, whose `.agents/skills` holds one skill of each name given, its body naming it as the repository's. */
const INSTALLATION: InstallationFixture = {
  id: 7,
  login: "acme",
  repositories: [{ owner: "acme", name: "relay" }],
};

const repositoryWithSkills = (names: readonly string[]) =>
  githubReaching([INSTALLATION], undefined, {}, (sent) => {
    const path = decodeURIComponent(new URL(sent.url).pathname);
    if (path === `/repos/${REPOSITORY}/git/trees/main:.agents/skills`) {
      return Response.json({
        tree: names.map((name) => ({ path: name, type: "tree" })),
        truncated: false,
      });
    }
    const file = /^\/repos\/acme\/relay\/contents\/\.agents\/skills\/([^/]+)\/SKILL\.md$/u.exec(
      path,
    );
    if (file !== null && names.includes(file[1] ?? "")) {
      const content = Buffer.from(skillText(file[1] ?? "", "From the repository.")).toString(
        "base64",
      );
      return Response.json({ type: "file", size: content.length, encoding: "base64", content });
    }
    return undefined;
  }).layer;

const install = (
  userId: string,
  owner: InstalledSkillOwner,
  name: string,
  words: string,
  more: readonly InstalledSkillFile[] = [],
) =>
  Effect.map(
    installSkill(userId, {
      owner,
      name,
      description: `Does ${name}.`,
      userInvocable: true,
      source: { type: INSTALLED_SKILL_SOURCE.TEXT },
      files: [{ path: "SKILL.md", bytes: text(skillText(name, words)) }, ...more],
    }),
    Option.getOrThrow,
  );

const PERSONAL: InstalledSkillOwner = { scope: INSTALLED_SKILL_SCOPE.PERSONAL };

/** An account with an agent on a task of its own workspace, on acme/relay or on no repository, with the Skills experiment on unless asked otherwise. */
const startAgent = (repository: string | null, skillsOn = true) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.SKILLS]: skillsOn } });
    const task = yield* startTask(userId, {
      name: "Teammate invitations",
      ...(repository === null ? {} : { repository }),
    });
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: `start-${task.id}`,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: null,
      prompt: null,
      repository,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });
    yield* connectWorkspaceGitHub(task.workspaceId, INSTALLATION);
    const { agent } = Option.getOrThrow(started);
    const target: ConversationTarget = { userId, conversationId: agent.conversationId };
    const workspace: InstalledSkillOwner = {
      scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
      organizationId: task.workspaceId,
    };
    return { userId, agent, target, workspace };
  });

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("a native harness's skills, unread", (it) => {
  it.effect("hands a native harness no installed skills where they cannot be read", () =>
    Effect.gen(function* () {
      const { userId, agent, target } = yield* startAgent(REPOSITORY);
      yield* install(userId, PERSONAL, "pr-style", "My pr style.");
      const handed = nativeSkills(target, agent, [SKILL_ROOT.AGENTS]).pipe(
        Effect.provide(repositoryWithSkills(["testing"])),
      );
      const before = yield* handed;
      const db = yield* Database;
      yield* db.execute(sql`drop table installed_skill cascade`);

      const after = yield* handed;

      assert.deepEqual(
        before.map((skill) => skill.name),
        ["pr-style"],
      );
      assert.deepEqual(after, []);
    }),
  );
});

// Note that a database of its own, as the unread case has, because a second agent on the fixture's repository in one database is offered none of its skills.
it.layer(Layer.mergeAll(getTestDB(), noNetwork))("a native harness's skills", (it) => {
  it.effect(
    "hands a native harness the installed skills alone, with their SKILL.md as installed, an installed name the repository holds where the harness reads it left to the repository",
    () =>
      Effect.gen(function* () {
        const { userId, agent, target, workspace } = yield* startAgent(REPOSITORY);
        yield* install(userId, workspace, "testing", "The workspace's testing.");
        yield* install(userId, workspace, "release-notes", "The workspace's release notes.");
        yield* install(userId, PERSONAL, "release-notes", "My release notes.");
        yield* install(userId, PERSONAL, "pr-style", "My pr style.");

        const readsAgents = yield* nativeSkills(target, agent, [SKILL_ROOT.AGENTS]).pipe(
          Effect.provide(repositoryWithSkills(["testing"])),
        );
        const readsClaude = yield* nativeSkills(target, agent, [SKILL_ROOT.CLAUDE]).pipe(
          Effect.provide(repositoryWithSkills(["testing"])),
        );

        // The repository's testing is in `.agents/skills`, which a harness reading it keeps.
        assert.deepEqual(
          readsAgents.map((skill) => skill.name),
          ["release-notes", "pr-style"],
        );
        // A harness that never reads `.agents/skills` would offer no testing at all, so the installed one stays.
        assert.deepEqual(
          readsClaude.map((skill) => skill.name),
          ["release-notes", "testing", "pr-style"],
        );
        const skills = readsAgents;
        const [notes] = skills;
        assert.equal(
          new TextDecoder().decode(notes?.skillFile),
          skillText("release-notes", "The workspace's release notes."),
        );
      }),
  );

  it.effect("hands none of the installed skills while the member has Skills off", () =>
    Effect.gen(function* () {
      const { userId, agent, target, workspace } = yield* startAgent(null, false);
      yield* install(userId, workspace, "release-notes", "The workspace's release notes.");
      yield* install(userId, PERSONAL, "pr-style", "My pr style.");

      const skills = yield* nativeSkills(target, agent, [SKILL_ROOT.AGENTS]).pipe(
        Effect.provide(repositoryWithSkills([])),
      );

      assert.deepEqual(skills, []);
    }),
  );
});
