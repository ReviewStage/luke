import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  INSTALLED_SKILL_BOUNDS,
  INSTALLED_SKILL_REFUSAL,
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
  type InstalledSkillRefusal,
} from "@luke/features/installed-skill-wire";
import { and, eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { Database } from "../../core/query.js";
import { member, user } from "../../schemas/auth.js";
import {
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openWorkspace,
  WORKSPACE_ROLE,
} from "../../testing/index.js";
import {
  type InstalledSkillFileInput,
  type InstalledSkillOwner,
  installSkill,
  listInstalledSkills,
  type NewInstalledSkill,
  readInstalledSkill,
  removeInstalledSkill,
  sessionInstalledSkills,
  setInstalledSkillEnabled,
  shareInstalledSkill,
  updateInstalledSkill,
} from "../installed-skill-store.js";

/**
 * The skills members install, through the store's public reads and writes
 * over a real dialect: a personal skill is its installer's alone in every
 * workspace, a workspace skill is installed and read by every current
 * member and managed by its installer while a member or by its current
 * owners and admins, a personal skill is moved into a workspace by its
 * owner alone, a name is held once per scope,
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

const skillFile = (name: string): InstalledSkillFileInput => ({
  path: "SKILL.md",
  bytes: text(`---\nname: ${name}\ndescription: Does ${name}.\n---\n# ${name}\n`),
});

const skill = (
  owner: InstalledSkillOwner,
  name: string,
  files: readonly InstalledSkillFileInput[] = [skillFile(name)],
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
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

const setRole = (organizationId: string, userId: string, role: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db
      .update(member)
      .set({ role })
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
  });

const installed = (userId: string, made: NewInstalledSkill) =>
  Effect.map(installSkill(userId, made), (row) => Option.getOrThrow(row).id);

const namesSeen = (userId: string, organizationId: string) =>
  Effect.map(listInstalledSkills(userId, organizationId), (rows) =>
    rows.map((row) => `${row.scope}:${row.name}`),
  );

const readable = (userId: string, id: string) =>
  Effect.map(readInstalledSkill(userId, id), Option.isSome);

/** Whether every manage act the account tries on the skill is refused, the skill standing as it was. */
const managedBy = (userId: string, id: string) =>
  Effect.gen(function* () {
    const toggled = yield* setInstalledSkillEnabled(userId, id, false);
    const updated = yield* updateInstalledSkill(userId, id, {
      description: "Changed.",
      userInvocable: false,
      source: { type: INSTALLED_SKILL_SOURCE.TEXT },
      files: [skillFile("changed")],
    });
    return { toggled: Option.isSome(toggled), updated: Option.isSome(updated) };
  });

/** Whether the account's share of the skill into the workspace moved it, or which refusal it met. */
const shareOf = (userId: string, id: string, organizationId: string) =>
  Effect.map(Effect.result(shareInstalledSkill(userId, id, organizationId)), (result) =>
    Result.match(result, {
      onSuccess: (row) => (Option.isSome(row) ? "shared" : "refused"),
      onFailure: (failure) => failure._tag,
    }),
  );

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
    "a personal skill is its installer's alone, in every workspace they are in, and no teammate reads or manages it",
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
        assert.deepEqual(yield* managedBy(teammate, id), { toggled: false, updated: false });
        assert.equal(yield* removeInstalledSkill(teammate, id), false);
        assert.equal(yield* readable(owner, id), true);

        assert.deepEqual(yield* managedBy(owner, id), { toggled: true, updated: true });
        assert.equal(yield* removeInstalledSkill(owner, id), true);
        assert.equal(yield* readable(owner, id), false);
      }),
  );

  it.effect(
    "a workspace skill is installed and read by every current member, and managed by its installer, owners, and admins alone",
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

        assert.deepEqual(yield* managedBy(teammate, id), { toggled: false, updated: false });
        assert.equal(yield* removeInstalledSkill(teammate, id), false);
        assert.deepEqual(yield* managedBy(outsider, id), { toggled: false, updated: false });
        assert.deepEqual(
          yield* managedBy(installer, byAdmin),
          { toggled: false, updated: false },
          "a member manages no skill another installed",
        );
        assert.deepEqual(yield* managedBy(installer, id), { toggled: true, updated: true });
        assert.deepEqual(yield* managedBy(admin, id), { toggled: true, updated: true });
        assert.deepEqual(yield* managedBy(owner, byAdmin), { toggled: true, updated: true });
        assert.equal(yield* removeInstalledSkill(owner, id), true);
        assert.equal(yield* removeInstalledSkill(installer, byAdmin), false);
        assert.deepEqual(yield* namesSeen(teammate, workspace), ["workspace:sentry-triage"]);
      }),
  );

  it.effect(
    "a workspace skill's installer manages it while a member whatever their role, and reaches nothing of it once gone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const installer = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, installer, WORKSPACE_ROLE.ADMIN);
        const id = yield* installed(installer, skill(inWorkspace(workspace), "sentry-triage"));

        yield* setRole(workspace, installer, WORKSPACE_ROLE.MEMBER);
        assert.deepEqual(yield* managedBy(installer, id), { toggled: true, updated: true });

        yield* leaveWorkspace(workspace, installer);
        assert.equal(yield* readable(installer, id), false);
        assert.deepEqual(yield* managedBy(installer, id), { toggled: false, updated: false });
        assert.equal(yield* removeInstalledSkill(installer, id), false);
        assert.deepEqual(yield* namesSeen(installer, workspace), []);
        assert.deepEqual(yield* sessionInstalledSkills(installer, workspace), []);
        assert.equal(yield* readable(owner, id), true, "the workspace keeps it");

        yield* joinWorkspace(workspace, installer, WORKSPACE_ROLE.MEMBER);
        assert.equal(
          yield* removeInstalledSkill(installer, id),
          true,
          "back as a member, theirs again",
        );
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
    "sharing moves the owner's personal skill into their workspace whole, the same skill with its files, source, and toggle, its owner kept as who installed it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const elsewhere = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate, WORKSPACE_ROLE.MEMBER);
        const script = { path: "scripts/run.sh", bytes: text("echo hi\n") };
        const id = yield* installed(
          owner,
          skill(PERSONAL, "grill-me", [skillFile("grill-me"), script]),
        );
        yield* setInstalledSkillEnabled(owner, id, false);
        const before = Option.getOrThrow(yield* readInstalledSkill(owner, id));

        const shared = Option.getOrThrow(yield* shareInstalledSkill(owner, id, workspace));
        const after = Option.getOrThrow(yield* readInstalledSkill(teammate, id));

        assert.deepEqual(
          [
            shared.id,
            shared.scope,
            shared.organizationId,
            shared.ownerUserId,
            shared.installedByUserId,
          ],
          [id, INSTALLED_SKILL_SCOPE.WORKSPACE, workspace, null, owner],
        );
        assert.deepEqual(
          [after.source, after.computedHash, after.enabled, after.description],
          [before.source, before.computedHash, false, before.description],
        );
        assert.deepEqual(after.files, before.files);
        assert.deepEqual(yield* namesSeen(owner, workspace), ["workspace:grill-me"]);
        assert.deepEqual(yield* namesSeen(teammate, workspace), ["workspace:grill-me"]);
        assert.deepEqual(yield* namesSeen(owner, elsewhere), [], "moved, not copied");
        assert.deepEqual(yield* managedBy(owner, id), { toggled: true, updated: true });
        assert.deepEqual(yield* managedBy(teammate, id), { toggled: false, updated: false });
      }),
  );

  it.effect(
    "only a personal skill's owner shares it, only into a workspace they are a current member of, and a workspace skill is never shared again",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const admin = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const theirs = yield* openWorkspace(admin);
        const leaving = yield* openWorkspace(admin);
        yield* joinWorkspace(workspace, admin, WORKSPACE_ROLE.ADMIN);
        yield* joinWorkspace(leaving, owner, WORKSPACE_ROLE.MEMBER);
        const id = yield* installed(owner, skill(PERSONAL, "my-pr-style"));
        const workspaceSkill = yield* installed(
          owner,
          skill(inWorkspace(workspace), "release-notes"),
        );

        assert.equal(
          yield* shareOf(admin, id, workspace),
          "refused",
          "an admin shares no one else's skill",
        );
        assert.equal(yield* shareOf(owner, id, theirs), "refused", "no workspace they are not in");
        yield* leaveWorkspace(leaving, owner);
        assert.equal(yield* shareOf(owner, id, leaving), "refused", "no workspace they left");
        assert.equal(yield* shareOf(owner, workspaceSkill, theirs), "refused");
        assert.equal(yield* shareOf(owner, workspaceSkill, workspace), "refused");
        assert.equal(yield* shareOf(owner, randomUUID(), workspace), "refused");
        assert.deepEqual(yield* namesSeen(owner, workspace), [
          "workspace:release-notes",
          "personal:my-pr-style",
        ]);
        assert.deepEqual(yield* namesSeen(admin, theirs), []);
      }),
  );

  it.effect(
    "a share into a workspace already holding a skill of that name is refused as taken, and the skill stays personal",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate, WORKSPACE_ROLE.MEMBER);
        yield* installed(teammate, skill(inWorkspace(workspace), "testing"));
        const id = yield* installed(owner, skill(PERSONAL, "testing"));

        assert.equal(yield* shareOf(owner, id, workspace), "InstalledSkillNameTaken");
        assert.deepEqual(yield* namesSeen(owner, workspace), [
          "workspace:testing",
          "personal:testing",
        ]);
        assert.deepEqual(
          Option.map(yield* readInstalledSkill(owner, id), (row) => row.scope),
          Option.some(INSTALLED_SKILL_SCOPE.PERSONAL),
        );
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
    "a skill's files are refused past their bounds or without a SKILL.md, and nothing is written",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const extra = (count: number) =>
          Array.from({ length: count }, (_, at) => ({ path: `notes/${at}.md`, bytes: text("x") }));

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
            skill(PERSONAL, "twice", [skillFile("twice"), skillFile("twice")]),
          ),
          INSTALLED_SKILL_REFUSAL.DUPLICATE_PATH,
        );
        assert.equal(
          yield* refusalOf(
            owner,
            skill(PERSONAL, "crowded", [
              skillFile("crowded"),
              ...extra(INSTALLED_SKILL_BOUNDS.MAX_FILES),
            ]),
          ),
          INSTALLED_SKILL_REFUSAL.TOO_MANY_FILES,
        );
        assert.equal(
          yield* refusalOf(
            owner,
            skill(PERSONAL, "heavy", [
              skillFile("heavy"),
              { path: "a.bin", bytes: new Uint8Array(INSTALLED_SKILL_BOUNDS.MAX_TOTAL_BYTES / 2) },
              { path: "b.bin", bytes: new Uint8Array(INSTALLED_SKILL_BOUNDS.MAX_TOTAL_BYTES / 2) },
            ]),
          ),
          INSTALLED_SKILL_REFUSAL.TOO_LARGE,
        );
        assert.equal(
          yield* refusalOf(
            owner,
            skill(PERSONAL, "full", [
              skillFile("full"),
              ...extra(INSTALLED_SKILL_BOUNDS.MAX_FILES - 1),
            ]),
          ),
          "installed",
          "exactly the most files is installed",
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
    "an update replaces a skill's files and source, and its hash follows the files whatever order they came in",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const script = { path: "scripts/run.sh", bytes: text("echo hi\n") };
        const id = yield* installed(
          owner,
          skill(PERSONAL, "runner", [skillFile("runner"), script]),
        );
        const before = Option.getOrThrow(yield* readInstalledSkill(owner, id));

        const source = {
          type: INSTALLED_SKILL_SOURCE.GITHUB,
          owner: "acme",
          repo: "agent-skills",
          path: "skills/runner",
          ref: "main",
          sha: "3f9c2e1",
        } as const;
        yield* updateInstalledSkill(owner, id, {
          description: "Runs things.",
          userInvocable: false,
          source,
          files: [skillFile("runner")],
        });
        const after = Option.getOrThrow(yield* readInstalledSkill(owner, id));
        yield* updateInstalledSkill(owner, id, {
          description: "Runs things.",
          userInvocable: false,
          source,
          files: [script, skillFile("runner")],
        });
        const reordered = Option.getOrThrow(yield* readInstalledSkill(owner, id));

        assert.deepEqual(
          after.files.map((file) => file.path),
          ["SKILL.md"],
        );
        assert.deepEqual(after.source, source);
        assert.equal(after.description, "Runs things.");
        assert.equal(after.userInvocable, false);
        assert.notEqual(after.computedHash, before.computedHash);
        assert.equal(reordered.computedHash, before.computedHash);
        assert.deepEqual(
          reordered.files.map((file) => [file.path, new TextDecoder().decode(file.bytes)]),
          [
            ["SKILL.md", new TextDecoder().decode(skillFile("runner").bytes)],
            ["scripts/run.sh", "echo hi\n"],
          ],
        );
      }),
  );

  it.effect(
    "a session is offered the enabled workspace skills, then the enabled personal ones, with their files",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const elsewhere = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* installed(owner, skill(inWorkspace(workspace), "release-notes"));
        const paused = yield* installed(owner, skill(inWorkspace(workspace), "paused"));
        yield* installed(owner, skill(inWorkspace(elsewhere), "other-workspace"));
        yield* installed(teammate, skill(PERSONAL, "alpha"));
        const off = yield* installed(teammate, skill(PERSONAL, "beta"));
        yield* setInstalledSkillEnabled(owner, paused, false);
        yield* setInstalledSkillEnabled(teammate, off, false);

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
        assert.deepEqual(
          (yield* listInstalledSkills(teammate, workspace)).map((row) => [row.name, row.enabled]),
          [
            ["paused", false],
            ["release-notes", true],
            ["alpha", true],
            ["beta", false],
          ],
          "the list reads disabled skills too",
        );
      }),
  );
});
