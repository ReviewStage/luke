import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  type InstalledSkillOwner,
  installSkill,
  type NewInstalledSkill,
  setInstalledSkillEnabled,
  shareInstalledSkill,
  updateInstalledSkill,
} from "@repo/database/models/installed-skill-store";
import { user } from "@repo/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { expectTopicsFire, getTestDB, openWorkspace } from "@repo/database/testing";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import { Effect, Option } from "effect";

/**
 * The skills members install on the migrated capture: an install, a toggle,
 * a share, and an update, each through the store's real writer, notify the
 * skills topic of the scope the skill stands in, which the skills' live
 * read is woken on, and never the workspace's or the account's own, which
 * would wake every member's task list and the account's session reads; a
 * share notifies both scopes, since it moves the skill; and an update,
 * which rewrites the skill's files beside its row, notifies once, in the
 * very transaction it answers, which a reader holding the skills waits for.
 *
 * Synthetic accounts, workspaces, and skills throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const skill = (owner: InstalledSkillOwner, name: string, body = name): NewInstalledSkill => ({
  owner,
  name,
  description: `Does ${name}.`,
  userInvocable: true,
  source: { type: INSTALLED_SKILL_SOURCE.TEXT },
  files: [
    {
      path: "SKILL.md",
      bytes: new TextEncoder().encode(
        `---\nname: ${name}\ndescription: Does ${name}.\n---\n${body}\n`,
      ),
    },
  ],
});

it.layer(getTestDB())("what moves an installed skill notifies", (it) => {
  it.effect(
    "an install and a toggle notify their own scope's skills topic alone, a share both, and an update its workspace's once, in the transaction it answers",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        const workspaceId = yield* openWorkspace(userId);
        const own: readonly SyncTopic[] = [[TOPIC.ACCOUNT_SKILLS, userId]];
        const workspaces: readonly SyncTopic[] = [[TOPIC.WORKSPACE_SKILLS, workspaceId]];
        const inWorkspace = { scope: INSTALLED_SKILL_SCOPE.WORKSPACE, organizationId: workspaceId };

        const personal = yield* expectTopicsFire(
          installSkill(userId, skill({ scope: INSTALLED_SKILL_SCOPE.PERSONAL }, "grilling")),
          own,
        );
        const shared = Option.getOrThrow(personal.value);
        const installed = yield* expectTopicsFire(
          installSkill(userId, skill(inWorkspace, "release-notes")),
          workspaces,
        );
        const workspaceSkill = Option.getOrThrow(installed.value);
        yield* expectTopicsFire(
          setInstalledSkillEnabled(userId, workspaceSkill.id, false),
          workspaces,
        );
        yield* expectTopicsFire(shareInstalledSkill(userId, shared.id, workspaceId), [
          ...own,
          ...workspaces,
        ]);

        const updated = yield* expectTopicsFire(
          updateInstalledSkill(userId, workspaceSkill.id, {
            description: "Does release notes, briefly.",
            userInvocable: true,
            source: { type: INSTALLED_SKILL_SOURCE.TEXT },
            files: skill(inWorkspace, "release-notes", "Briefly.").files,
          }),
          workspaces,
        );
        assert.deepEqual(updated.txids, [Option.getOrThrow(updated.value).txid]);
      }),
  );
});
