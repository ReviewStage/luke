import assert from "node:assert/strict";
import type { TaskSummary } from "@luke/features/task-wire";
import type { TasksRevisionAnswer, TasksRevisionsAnswer } from "@luke/features/tasks-view";
import type { WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { RUN_PROFILE } from "@luke/host/app-state";
import { FIXTURE_IDS } from "@luke/host/fixture-stage";
import { test } from "vitest";
import { fixtureActAnswer, fixtureTasksView } from "./tasks-fixture.js";

/**
 * tasks-fixture.test.ts -- a fixture run's tasks carry the times and the
 * creator a service would answer, so no row reads the epoch's first day or
 * "Created by someone"; every profile answers its workspaces' members,
 * so ⌘K's People lists them rather than saying the read failed; and the open
 * task's version history reads real versions by more than one writer rather
 * than waiting on a read main answers with nothing.
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

test("the open task's version history lists at least four versions by more than one member, each read beside the one before it", () => {
  const read = (
    kind: typeof ACT_KIND.TASKS_REVISIONS | typeof ACT_KIND.TASKS_REVISION,
    seq?: number,
  ) =>
    fixtureActAnswer(
      { profile: RUN_PROFILE.TASKS },
      kind,
      seq === undefined ? { taskId: FIXTURE_IDS.TASK } : { taskId: FIXTURE_IDS.TASK, seq },
    )?.answer;
  // SAFETY: the profile answered the history's page read, with its result.
  const page = read(ACT_KIND.TASKS_REVISIONS) as TasksRevisionsAnswer;
  assert.ok("revisions" in page, "the history's page is answered");
  const members = new Set(page.revisions.flatMap(({ lastEdit }) => lastEdit.by?.userId ?? []));
  assert.ok(page.revisions.length >= 4, "at least four versions");
  assert.ok(members.size >= 2, "written by more than one member");

  const first = page.revisions.at(-1);
  const second = page.revisions.at(-2);
  assert.ok(first !== undefined && second !== undefined);
  // SAFETY: the profile answered each revision read, with its result.
  const opened = read(ACT_KIND.TASKS_REVISION, second.seq) as TasksRevisionAnswer;
  const oldest = read(ACT_KIND.TASKS_REVISION, first.seq) as TasksRevisionAnswer;
  assert.ok("revision" in opened && "revision" in oldest);
  assert.notEqual(
    opened.revision.previous,
    null,
    "a later version is read beside the one before it",
  );
  assert.equal(oldest.revision.previous, null, "the first has none before it");
  assert.notEqual(opened.revision.document.body, opened.revision.previous?.body);
});
