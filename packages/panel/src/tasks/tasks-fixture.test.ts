import assert from "node:assert/strict";
import type { TaskSummary } from "@luke/features/task-wire";
import type { WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { RUN_PROFILE } from "@luke/host/app-state";
import { test } from "vitest";
import { fixtureActAnswer, fixtureTasksView } from "./tasks-fixture.js";

/**
 * tasks-fixture.test.ts -- a fixture run's tasks carry the times and the
 * creator a service would answer, so no row reads the epoch's first day or
 * "Created by someone", and every profile answers its workspaces' members,
 * so ⌘K's People lists them rather than saying the read failed.
 */

/** The first day a fixture task may stand on: the year the fixture is set in. */
const FIXTURE_YEAR_START = Date.parse("2026-01-01T00:00:00Z");

/** The tasks profile's list, as the sidebar, the Tasks list, and ⌘K draw it. */
function listedTasks(): readonly TaskSummary[] {
  const view = fixtureTasksView({ fixtureMode: true, profile: RUN_PROFILE.TASKS });
  assert.ok(view);
  return view.tasks;
}

/** A workspace's members as a profile answers ⌘K's read of them. */
function membersOf(profile: string, workspaceId: string): readonly WorkspaceMember[] {
  const staged = fixtureActAnswer({ profile }, ACT_KIND.WORKSPACE_MEMBERS_READ, { workspaceId });
  assert.ok(staged, `${profile} answers the members of ${workspaceId}`);
  // SAFETY: the profile answered the members read, with its result.
  return staged.answer as readonly WorkspaceMember[];
}

test("every fixture task was started this year and saved no earlier than it started", () => {
  const stale = listedTasks().filter(
    (task) => task.createdAt < FIXTURE_YEAR_START || task.updatedAt < task.createdAt,
  );

  assert.deepEqual(
    stale.map((task) => task.name),
    [],
  );
});

test("every fixture task names a member of its own workspace as who created it", () => {
  const unnamed = listedTasks().filter((task) => {
    const members = membersOf(RUN_PROFILE.TASKS, task.workspaceId);
    return !members.some((member) => member.userId === task.createdBy?.userId);
  });

  assert.deepEqual(
    unnamed.map((task) => task.name),
    [],
  );
});

test("the tasks profile, which signs nobody in, answers its first workspace's members", () => {
  const [first] = listedTasks();
  assert.ok(first);

  const names = membersOf(RUN_PROFILE.TASKS, first.workspaceId).map((member) => member.name);

  assert.deepEqual(names, ["Ada Lovelace", "Theo Lindqvist", "Priya Raman"]);
});
