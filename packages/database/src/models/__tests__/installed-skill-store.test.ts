import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  INSTALLED_SKILL_BOUNDS,
  INSTALLED_SKILL_REFUSAL,
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
  type InstalledSkillRefusal,
} from "@repo/features/installed-skill-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import {
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openWorkspace,
  WORKSPACE_ROLE,
} from "../../testing/index.js";
import {
  type InstalledSkillFile,
  type InstalledSkillOwner,
  installSkill,
  listInstalledSkills,
  type NewInstalledSkill,
  readInstalledSkill,
  removeInstalledSkill,
  sessionInstalledSkills,
} from "../installed-skill-store.js";

/**
 * The skills members install, through the store's public reads and writes
 * over a real dialect: a personal skill is its installer's alone in every
 * workspace, a workspace skill is installed and read by every current
 * member and removed by its installer while a member or by its current
 * owners and admins, a name is held once per scope,
 * and a skill's files are held to their bounds.
 *
 * Synthetic accounts, workspaces, and skills throughout.
 */

const PERSONAL: InstalledSkillOwner = { scope: INSTALLED_SKILL_SCOPE.PERSONAL };
const inWorkspace = (organizationId: string): InstalledSkillOwner => ({
  scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
  organizationId,
});

const text = (value: string) => new TextEncoder().encode(value);

const skillFile = (name: string): InstalledSkillFile => ({
  path: "SKILL.md",
  bytes: text(`---\nname: ${name}\ndescription: Does ${name}.\n---\n# ${name}\n`),
});

const skill = (
  owner: InstalledSkillOwner,
  name: string,
  files: readonly InstalledSkillFile[] = [skillFile(name)],
): NewInstalledSkill => ({
  owner,
  name,
  description: `Does ${name}.`,
  userInvocable: true,
  source: { type: INSTALLED_SKILL_SOURCE.TEXT },
  files,
});

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const installed = (userId: string, made: NewInstalledSkill) =>
  Effect.map(installSkill(userId, made), (row) => Option.getOrThrow(row).id);

const namesSeen = (userId: string, organizationId: string) =>
  Effect.map(listInstalledSkills(userId, organizationId), (rows) =>
    rows.map((row) => `${row.scope}:${row.name}`),
  );

/** Whether the account's removal of the skill removed it. */
const removed = (userId: string, id: string) =>
  Effect.map(removeInstalledSkill(userId, id), Option.isSome);

const readable = (userId: string, id: string) =>
  Effect.map(readInstalledSkill(userId, id), Option.isSome);

const refusalOf = (userId: string, made: NewInstalledSkill) =>
  Effect.map(Effect.result(installSkill(userId, made)), (result) =>
    Result.match(result, {
      onSuccess: (): InstalledSkillRefusal | string => "installed",
      onFailure: (failure) =>
        failure._tag === "InstalledSkillFilesRefused" ? failure.reason : failure._tag,
    }),
  );

it.layer(getTestDB())("the installed skill store", (it) => {
  it.effect(
    "a personal skill is its installer's alone, in every workspace they are in, and no teammate reads or removes it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const first = yield* openWorkspace(owner);
        const second = yield* openWorkspace(owner);
        yield* joinWorkspace(first, teammate, WORKSPACE_ROLE.ADMIN);
        const id = yield* installed(owner, skill(PERSONAL, "my-pr-style"));

        assert.deepEqual(yield* namesSeen(owner, first), ["personal:my-pr-style"]);
        assert.deepEqual(yield* namesSeen(owner, second), ["personal:my-pr-style"]);
        assert.deepEqual(yield* namesSeen(teammate, first), []);
        assert.equal(yield* readable(teammate, id), false);
        assert.equal(yield* removed(teammate, id), false);
        assert.equal(yield* readable(owner, id), true);

        assert.equal(yield* removed(owner, id), true);
        assert.equal(yield* readable(owner, id), false);
      }),
  );

  it.effect(
    "a workspace skill is installed and read by every current member, and removed by its installer, owners, and admins alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const admin = yield* openAccount;
        const installer = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, admin, WORKSPACE_ROLE.ADMIN);
        yield* joinWorkspace(workspace, installer, WORKSPACE_ROLE.MEMBER);
        yield* joinWorkspace(workspace, teammate, WORKSPACE_ROLE.MEMBER);

        assert.deepEqual(
          yield* installSkill(outsider, skill(inWorkspace(workspace), "release-notes")),
          Option.none(),
          "an outsider installs none",
        );
        const id = yield* installed(installer, skill(inWorkspace(workspace), "release-notes"));
        const byAdmin = yield* installed(admin, skill(inWorkspace(workspace), "sentry-triage"));

        for (const account of [owner, admin, installer, teammate]) {
          assert.deepEqual(yield* namesSeen(account, workspace), [
            "workspace:release-notes",
            "workspace:sentry-triage",
          ]);
          assert.equal(yield* readable(account, id), true);
        }
        assert.deepEqual(yield* namesSeen(outsider, workspace), []);
        assert.equal(yield* readable(outsider, id), false);

        assert.equal(yield* removed(teammate, id), false);
        assert.equal(yield* removed(outsider, id), false);
        assert.equal(
          yield* removed(installer, byAdmin),
          false,
          "a member removes no skill another installed",
        );
        assert.equal(yield* removed(owner, byAdmin), true);
        assert.equal(yield* removed(installer, id), true);
        assert.deepEqual(yield* namesSeen(teammate, workspace), []);
      }),
  );

  it.effect(
    "a workspace skill's installer removes it while a member whatever their role, and reaches nothing of it once gone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const installer = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, installer, WORKSPACE_ROLE.ADMIN);
        const id = yield* installed(installer, skill(inWorkspace(workspace), "sentry-triage"));

        yield* leaveWorkspace(workspace, installer);
        assert.equal(yield* readable(installer, id), false);
        assert.equal(yield* removed(installer, id), false);
        assert.deepEqual(yield* namesSeen(installer, workspace), []);
        assert.deepEqual(yield* sessionInstalledSkills(installer, workspace), []);
        assert.equal(yield* readable(owner, id), true, "the workspace keeps it");

        yield* joinWorkspace(workspace, installer, WORKSPACE_ROLE.MEMBER);
        assert.equal(yield* removed(installer, id), true, "back as a member, theirs again");
      }),
  );

  it.effect(
    "a workspace skill outlives its installer's deleted account, unattributed, while their personal skills go with it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const installer = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, installer, WORKSPACE_ROLE.ADMIN);
        const shared = yield* installed(installer, skill(inWorkspace(workspace), "release-notes"));
        const own = yield* installed(installer, skill(PERSONAL, "my-pr-style"));
        assert.deepEqual(
          Option.map(yield* readInstalledSkill(owner, shared), (row) => row.installedByUserId),
          Option.some(installer),
        );

        const db = yield* Database;
        yield* db.delete(user).where(eq(user.id, installer));

        const kept = yield* readInstalledSkill(owner, shared);
        assert.deepEqual(
          Option.map(kept, (row) => [row.installedByUserId, row.files.map((file) => file.path)]),
          Option.some([null, ["SKILL.md"]]),
        );
        assert.deepEqual(yield* namesSeen(owner, workspace), ["workspace:release-notes"]);
        assert.equal(yield* readable(installer, own), false);
      }),
  );

  it.effect(
    "a name is held once per scope: one personal skill of a name per account, one workspace skill of a name per workspace",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const elsewhere = yield* openWorkspace(owner);
        yield* installed(owner, skill(PERSONAL, "testing"));

        assert.equal(
          yield* refusalOf(owner, skill(PERSONAL, "testing")),
          "InstalledSkillNameTaken",
        );
        assert.equal(yield* refusalOf(other, skill(PERSONAL, "testing")), "installed");
        assert.equal(
          yield* refusalOf(owner, skill(inWorkspace(workspace), "testing")),
          "installed",
        );
        assert.equal(
          yield* refusalOf(owner, skill(inWorkspace(workspace), "testing")),
          "InstalledSkillNameTaken",
        );
        assert.equal(
          yield* refusalOf(owner, skill(inWorkspace(elsewhere), "testing")),
          "installed",
        );
        assert.deepEqual(yield* namesSeen(owner, workspace), [
          "workspace:testing",
          "personal:testing",
        ]);
      }),
  );

  it.effect(
    "a skill's files are refused without a SKILL.md or with a file past its bound, and nothing is written",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);

        assert.equal(
          yield* refusalOf(
            owner,
            skill(PERSONAL, "headless", [{ path: "README.md", bytes: text("x") }]),
          ),
          INSTALLED_SKILL_REFUSAL.NO_SKILL_FILE,
        );
        assert.equal(
          yield* refusalOf(
            owner,
            skill(PERSONAL, "heavy", [
              skillFile("heavy"),
              { path: "a.bin", bytes: new Uint8Array(INSTALLED_SKILL_BOUNDS.MAX_FILE_BYTES + 1) },
            ]),
          ),
          INSTALLED_SKILL_REFUSAL.TOO_LARGE,
        );
        assert.equal(
          yield* refusalOf(
            owner,
            skill(PERSONAL, "full", [
              skillFile("full"),
              { path: "a.bin", bytes: new Uint8Array(INSTALLED_SKILL_BOUNDS.MAX_FILE_BYTES) },
            ]),
          ),
          "installed",
          "a file of exactly the most bytes is installed",
        );
        assert.deepEqual(yield* namesSeen(owner, workspace), ["personal:full"]);
      }),
  );

  it.effect(
    "the tables refuse a name breaking the rule, a SKILL.md over 64 KB, and a path that climbs out of the skill",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const refused = (made: NewInstalledSkill) =>
          Effect.map(Effect.result(installSkill(owner, made)), Result.isFailure);

        assert.equal(yield* refused(skill(PERSONAL, "Not_A_Name")), true);
        assert.equal(yield* refused(skill(PERSONAL, "a".repeat(65))), true);
        assert.equal(
          yield* refused(
            skill(PERSONAL, "big", [{ path: "SKILL.md", bytes: new Uint8Array(64 * 1024 + 1) }]),
          ),
          true,
        );
        assert.equal(
          yield* refused(
            skill(PERSONAL, "climbs", [skillFile("climbs"), { path: "../x", bytes: text("x") }]),
          ),
          true,
        );
        assert.equal(
          yield* refused(
            skill(PERSONAL, "rooted", [skillFile("rooted"), { path: "/etc/x", bytes: text("x") }]),
          ),
          true,
        );
        assert.equal(
          yield* refused(
            skill(PERSONAL, "at-limit", [{ path: "SKILL.md", bytes: new Uint8Array(64 * 1024) }]),
          ),
          false,
        );
        assert.deepEqual(yield* namesSeen(owner, workspace), ["personal:at-limit"]);
      }),
  );

  it.effect(
    "a session is offered the workspace skills, then the personal ones, with their files",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const elsewhere = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* installed(owner, skill(inWorkspace(workspace), "release-notes"));
        yield* installed(owner, skill(inWorkspace(elsewhere), "other-workspace"));
        yield* installed(teammate, skill(PERSONAL, "alpha"));

        const offered = yield* sessionInstalledSkills(teammate, workspace);
        const noWorkspace = yield* sessionInstalledSkills(teammate, null);

        assert.deepEqual(
          offered.map((row) => [row.name, row.files.map((file) => file.path)]),
          [
            ["release-notes", ["SKILL.md"]],
            ["alpha", ["SKILL.md"]],
          ],
        );
        assert.deepEqual(
          noWorkspace.map((row) => row.name),
          ["alpha"],
        );
      }),
  );
});
