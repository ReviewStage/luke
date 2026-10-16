import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { ISSUE_PRIORITY, ISSUE_STATUS } from "@luke/features/issue-wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { member, organization, user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import { changeIssue, createIssue, listIssues, readIssue } from "../issue-store.js";

/**
 * A workspace's issues over a real dialect: numbered from one in the order
 * they were filed and never twice, read and changed by the workspace's
 * members alone, archived out of the list and back under it, and kept
 * where the member who filed them is gone.
 *
 * Synthetic accounts and workspaces throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A workspace the account owns, as the organization plugin would leave the rows. */
const openWorkspace = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const organizationId = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(organization).values({
      id: organizationId,
      name: "Acme",
      slug: `workspace-${organizationId}`,
      createdAt: now,
    });
    yield* db
      .insert(member)
      .values({ id: randomUUID(), organizationId, userId, role: "owner", createdAt: now });
    return organizationId;
  });

it.layer(getTestDB())("the issue store", (it) => {
  it.effect("a workspace's issues are numbered from one in the order they are filed", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);

      const first = yield* createIssue(owner, { organizationId: workspace, title: "First" });
      const second = yield* createIssue(owner, {
        organizationId: workspace,
        title: "Second",
        status: ISSUE_STATUS.TODO,
        priority: ISSUE_PRIORITY.HIGH,
        description: "## Why\n\n- because",
      });

      assert.deepEqual(
        Option.map(first, (made) => [made.number, made.status, made.priority, made.description]),
        Option.some([1, ISSUE_STATUS.BACKLOG, ISSUE_PRIORITY.NONE, ""]),
      );
      assert.deepEqual(
        Option.map(second, (made) => [made.number, made.status, made.priority, made.description]),
        Option.some([2, ISSUE_STATUS.TODO, ISSUE_PRIORITY.HIGH, "## Why\n\n- because"]),
      );
      assert.deepEqual(
        Option.map(first, (made) => made.creator),
        Option.some({ userId: owner, name: "Test User" }),
      );
    }),
  );

  it.effect("filings at once in one workspace never share a number", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);

      const made = yield* Effect.all(
        Array.from({ length: 5 }, (_, index) =>
          createIssue(owner, { organizationId: workspace, title: `Issue ${index}` }),
        ),
        { concurrency: "unbounded" },
      );

      assert.deepEqual(
        made.map((one) => Option.getOrThrow(one).number).toSorted((a, b) => a - b),
        [1, 2, 3, 4, 5],
      );
    }),
  );

  it.effect("each workspace numbers its own issues", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const one = yield* openWorkspace(owner);
      const other = yield* openWorkspace(owner);

      yield* createIssue(owner, { organizationId: one, title: "In one" });
      const made = yield* createIssue(owner, { organizationId: other, title: "In the other" });

      assert.deepEqual(
        Option.map(made, (issue) => issue.number),
        Option.some(1),
      );
    }),
  );

  it.effect("an account outside the workspace lists, reads, files, and changes nothing of it", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const outsider = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      yield* openWorkspace(outsider);
      const made = Option.getOrThrow(
        yield* createIssue(owner, { organizationId: workspace, title: "Private" }),
      );

      const listed = yield* listIssues(outsider, workspace, { archived: false });
      const read = yield* readIssue(outsider, made.id);
      const filed = yield* createIssue(outsider, { organizationId: workspace, title: "Sneaky" });
      const changed = yield* changeIssue(outsider, made.id, { title: "Taken over" });
      const kept = yield* readIssue(owner, made.id);
      const standing = yield* listIssues(owner, workspace, { archived: false });

      assert.ok(Option.isNone(listed), "an outsider lists none of the workspace");
      assert.ok(Option.isNone(read), "an outsider reads none of its issues");
      assert.ok(Option.isNone(filed), "an outsider files nothing in it");
      assert.ok(Option.isNone(changed), "an outsider changes none of its issues");
      assert.deepEqual(
        Option.map(kept, (issue) => issue.title),
        Option.some("Private"),
      );
      assert.deepEqual(
        Option.map(standing, (issues) => issues.map((issue) => issue.title)),
        Option.some(["Private"]),
      );
    }),
  );

  it.effect("a member reads and changes an issue a teammate filed", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const teammate = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      const db = yield* Database;
      yield* db.insert(member).values({
        id: randomUUID(),
        organizationId: workspace,
        userId: teammate,
        role: "member",
        createdAt: yield* DateTime.nowAsDate,
      });
      const made = Option.getOrThrow(
        yield* createIssue(owner, { organizationId: workspace, title: "Shared" }),
      );

      const changed = yield* changeIssue(teammate, made.id, { status: ISSUE_STATUS.DONE });

      assert.deepEqual(
        Option.map(changed, (issue) => [issue.status, issue.creator?.userId]),
        Option.some([ISSUE_STATUS.DONE, owner]),
      );
    }),
  );

  it.effect("a change moves what it names, keeps the rest, and moves the change instant", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      const made = Option.getOrThrow(
        yield* createIssue(owner, {
          organizationId: workspace,
          title: "Flaky login",
          description: "Fails on CI.",
        }),
      );
      yield* TestClock.adjust("1 minute");

      const changed = Option.getOrThrow(
        yield* changeIssue(owner, made.id, {
          status: ISSUE_STATUS.IN_PROGRESS,
          priority: ISSUE_PRIORITY.URGENT,
        }),
      );

      assert.equal(changed.status, ISSUE_STATUS.IN_PROGRESS);
      assert.equal(changed.priority, ISSUE_PRIORITY.URGENT);
      assert.equal(changed.title, "Flaky login");
      assert.equal(changed.description, "Fails on CI.");
      assert.equal(changed.createdAt, made.createdAt);
      assert.equal(changed.updatedAt, made.updatedAt + 60_000);
    }),
  );

  it.effect("an archived issue leaves the list, stands in the archived one, and comes back", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      const kept = Option.getOrThrow(
        yield* createIssue(owner, { organizationId: workspace, title: "Kept" }),
      );
      const shelved = Option.getOrThrow(
        yield* createIssue(owner, { organizationId: workspace, title: "Shelved" }),
      );
      const titles = (archived: boolean) =>
        Effect.map(listIssues(owner, workspace, { archived }), (issues) =>
          Option.map(issues, (all) => all.map((issue) => issue.title)),
        );

      const archived = Option.getOrThrow(yield* changeIssue(owner, shelved.id, { archived: true }));
      const standing = yield* titles(false);
      const archive = yield* titles(true);
      yield* changeIssue(owner, shelved.id, { archived: false });
      const restored = yield* titles(false);

      assert.notEqual(archived.archivedAt, null);
      assert.deepEqual(standing, Option.some([kept.title]));
      assert.deepEqual(archive, Option.some([shelved.title]));
      assert.deepEqual(
        Option.map(restored, (all) => all.toSorted()),
        Option.some([kept.title, shelved.title]),
      );
    }),
  );

  it.effect("the list stands the most recently changed first", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      const older = Option.getOrThrow(
        yield* createIssue(owner, { organizationId: workspace, title: "Older" }),
      );
      yield* TestClock.adjust("1 minute");
      yield* createIssue(owner, { organizationId: workspace, title: "Newer" });
      yield* TestClock.adjust("1 minute");
      yield* changeIssue(owner, older.id, { title: "Older, touched" });

      const listed = yield* listIssues(owner, workspace, { archived: false });

      assert.deepEqual(
        Option.map(listed, (issues) => issues.map((issue) => issue.title)),
        Option.some(["Older, touched", "Newer"]),
      );
    }),
  );

  it.effect("an issue whose creator's account is gone stays, filed by no one", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const creator = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      const db = yield* Database;
      yield* db.insert(member).values({
        id: randomUUID(),
        organizationId: workspace,
        userId: creator,
        role: "member",
        createdAt: yield* DateTime.nowAsDate,
      });
      const made = Option.getOrThrow(
        yield* createIssue(creator, { organizationId: workspace, title: "Orphan" }),
      );

      yield* db.delete(user).where(eq(user.id, creator));
      const read = yield* readIssue(owner, made.id);

      assert.deepEqual(
        Option.map(read, (issue) => [issue.title, issue.creator]),
        Option.some(["Orphan", null]),
      );
    }),
  );
});
