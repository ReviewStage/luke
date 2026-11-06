import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  type InstalledSkillOwner,
  installSkill,
  type NewInstalledSkill,
} from "@repo/database/models/installed-skill-store";
import { user } from "@repo/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { expectTopicsFire, getTestDB, openWorkspace } from "@repo/database/testing";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import { Effect } from "effect";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const skill = (owner: InstalledSkillOwner, name: string): NewInstalledSkill => ({
  owner,
  name,
  description: `Does ${name}.`,
  userInvocable: true,
  source: { type: INSTALLED_SKILL_SOURCE.TEXT },
  files: [
    {
      path: "SKILL.md",
      bytes: new TextEncoder().encode(
        `---\nname: ${name}\ndescription: Does ${name}.\n---\n${name}\n`,
      ),
    },
  ],
});

it.layer(getTestDB())("what moves an installed skill notifies", (it) => {
  it.effect("an install notifies its own scope's skills topic alone", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      const workspaceId = yield* openWorkspace(userId);
      const own: readonly SyncTopic[] = [[TOPIC.ACCOUNT_SKILLS, userId]];
      const workspaces: readonly SyncTopic[] = [[TOPIC.WORKSPACE_SKILLS, workspaceId]];
      const inWorkspace = { scope: INSTALLED_SKILL_SCOPE.WORKSPACE, organizationId: workspaceId };

      yield* expectTopicsFire(
        installSkill(userId, skill({ scope: INSTALLED_SKILL_SCOPE.PERSONAL }, "grilling")),
        own,
      );
      yield* expectTopicsFire(
        installSkill(userId, skill(inWorkspace, "release-notes")),
        workspaces,
      );
    }),
  );
});
