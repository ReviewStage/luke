import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import {
  type InstalledSkillFileInput,
  type InstalledSkillOwner,
  installSkill,
  setInstalledSkillEnabled,
} from "@luke/database/models/installed-skill-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { getTestDB, startTask } from "@luke/database/testing";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@luke/features/installed-skill-wire";
import { noNetwork } from "@luke/wire/testing";
import { sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../../testing/github-app-fake.js";
import { offeredSkills, skillsOpenSandbox } from "../agent-runtime/skills.js";
import { agentSkills } from "./skills.js";

/**
 * The skills a coding agent's session is offered, through `agentSkills`
 * over the real migrations on PGlite and a GitHub answering the agent's
 * repository's skills: the repository's, then the workspace's installed
 * skills, then the member's personal ones, a name offered once by the
 * earliest; installed skills for an agent with no repository too; an
 * installed skill's supporting files handed to eve; a skill turned off left
 * out; and an installed read that fails offering the repository's alone.
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
  more: readonly InstalledSkillFileInput[] = [],
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

/** An account with an agent on a task of its own workspace, on acme/relay or on no repository. */
const startAgent = (repository: string | null) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const task = yield* startTask(userId, {
      name: "Teammate invitations",
      ...(repository === null ? {} : { repository }),
    });
    const started = yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: `start-${task.id}`,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: null,
      prompt: null,
      repository,
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

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("a coding agent's skills", (it) => {
  it.effect(
    "offers the repository's skills, then the workspace's, then the member's own, a name offered once by the earliest",
    () =>
      Effect.gen(function* () {
        const { userId, agent, target, workspace } = yield* startAgent(REPOSITORY);
        yield* install(userId, workspace, "testing", "The workspace's testing.");
        yield* install(userId, workspace, "release-notes", "The workspace's release notes.");
        yield* install(userId, PERSONAL, "release-notes", "My release notes.");
        yield* install(userId, PERSONAL, "pr-style", "My pr style.");

        const skills = yield* agentSkills(target, agent).pipe(
          Effect.provide(repositoryWithSkills(["testing"])),
        );

        assert.deepEqual(
          skills.map((skill) => skill.name),
          ["testing", "release-notes", "pr-style"],
        );
        const [testing, notes, style] = skills;
        assert.match(testing?.markdown ?? "", /From the repository\./u);
        assert.match(
          testing?.markdown ?? "",
          /\.agents\/skills\/testing\/SKILL\.md` in the checkout/u,
        );
        assert.match(notes?.markdown ?? "", /The workspace's release notes\./u);
        assert.match(style?.markdown ?? "", /My pr style\./u);
        // The installed body is handed without its frontmatter, as a repository skill's is.
        assert.ok(!(style?.markdown ?? "").includes("---"));
      }),
  );

  it.effect("offers an agent with no repository its member's installed skills", () =>
    Effect.gen(function* () {
      const { userId, agent, target, workspace } = yield* startAgent(null);
      yield* install(userId, workspace, "release-notes", "The workspace's release notes.");
      yield* install(userId, PERSONAL, "pr-style", "My pr style.");

      const skills = yield* agentSkills(target, agent).pipe(
        Effect.provide(repositoryWithSkills(["testing"])),
      );

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["release-notes", "pr-style"],
      );
    }),
  );

  it.effect(
    "hands eve an installed skill's supporting files, its body told where eve writes them, and says eve opens the sandbox for them",
    () =>
      Effect.gen(function* () {
        const { userId, agent, target } = yield* startAgent(null);
        const script = text("#!/bin/sh\necho triage\n");
        yield* install(userId, PERSONAL, "sentry-triage", "Run `scripts/triage.sh`.", [
          { path: "scripts/triage.sh", bytes: script },
        ]);
        yield* install(userId, PERSONAL, "pr-style", "My pr style.");

        const skills = yield* agentSkills(target, agent).pipe(
          Effect.provide(repositoryWithSkills([])),
        );
        const offered = offeredSkills(skills);

        const triage = offered?.["sentry-triage"];
        assert.deepEqual(triage?.files, { "scripts/triage.sh": script });
        assert.match(triage?.markdown ?? "", /`\$HOME\/\.agents\/skills\/sentry-triage\/`/u);
        assert.match(triage?.markdown ?? "", /`\/workspace\/skills\/sentry-triage\/`/u);
        assert.match(triage?.markdown ?? "", /Run `scripts\/triage\.sh`\./u);
        // A skill with nothing beside its `SKILL.md` has no files for eve to write, and says of none.
        const style = offered?.["pr-style"];
        assert.equal(style?.files, undefined);
        assert.ok(!(style?.markdown ?? "").includes(".agents/skills"));
        // eve opens the sandbox to write those files, which the session records so its turn's end stops it.
        assert.equal(skillsOpenSandbox(skills), true);
        assert.equal(skillsOpenSandbox(skills.filter((skill) => skill.name === "pr-style")), false);
      }),
  );

  it.effect("leaves out an installed skill turned off", () =>
    Effect.gen(function* () {
      const { userId, agent, target, workspace } = yield* startAgent(null);
      const off = yield* install(userId, workspace, "release-notes", "Turned off.");
      yield* install(userId, PERSONAL, "pr-style", "My pr style.");
      yield* setInstalledSkillEnabled(userId, off.id, false);

      const skills = yield* agentSkills(target, agent).pipe(
        Effect.provide(repositoryWithSkills([])),
      );

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["pr-style"],
      );
    }),
  );
});

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("a coding agent's skills, unread", (it) => {
  it.effect("offers the repository's skills alone where the installed skills cannot be read", () =>
    Effect.gen(function* () {
      const { userId, agent, target } = yield* startAgent(REPOSITORY);
      yield* install(userId, PERSONAL, "pr-style", "My pr style.");
      const offered = agentSkills(target, agent).pipe(
        Effect.provide(repositoryWithSkills(["testing"])),
      );
      const before = yield* offered;
      const db = yield* Database;
      yield* db.execute(sql`drop table installed_skill cascade`);

      const after = yield* offered;

      assert.deepEqual(
        before.map((skill) => skill.name),
        ["testing", "pr-style"],
      );
      assert.deepEqual(
        after.map((skill) => skill.name),
        ["testing"],
      );
    }),
  );
});
