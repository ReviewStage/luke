import assert from "node:assert/strict";
import { LIVE_READ } from "@repo/features/live-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import type { TasksRevisionAnswer } from "@repo/features/tasks-view";
import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { RUN_PROFILE } from "@repo/host/app-state";
import { FIXTURE_IDS } from "@repo/host/fixture-stage";
import { test } from "vitest";
import { stateWith } from "../testing/app-state.js";
import { fixtureActAnswer, fixtureAppState, fixtureTasksView } from "./tasks-fixture.js";

const FIXTURE_YEAR_START = Date.parse("2026-01-01T00:00:00Z");

function listedTasks(): readonly TaskSummary[] {
  const view = fixtureTasksView({ fixtureMode: true, profile: RUN_PROFILE.TASKS });
  assert.ok(view);
  return view.tasks;
}

function membersOf(profile: string, workspaceId: string): readonly WorkspaceMember[] {
  const main = stateWith({}, {});
  const staged = fixtureAppState({ ...main, run: { ...main.run, profile } });
  const members = staged[LIVE_READ.WORKSPACE_MEMBERS][workspaceId]?.rows?.members;
  assert.ok(members, `${profile} holds the members of ${workspaceId}`);
  return members;
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
  const read = (seq: number) =>
    fixtureActAnswer({ profile: RUN_PROFILE.TASKS }, ACT_KIND.TASKS_REVISION, {
      taskId: FIXTURE_IDS.TASK,
      seq,
    })?.answer;
  const main = stateWith({}, {});
  const staged = fixtureAppState({
    ...main,
    run: { ...main.run, fixtureMode: true, profile: RUN_PROFILE.TASKS },
  });
  const page = staged[LIVE_READ.HISTORY][FIXTURE_IDS.TASK]?.rows;
  assert.ok(page, "the history is held as the version history holds it");
  const members = new Set(page.revisions.flatMap(({ lastEdit }) => lastEdit.by?.userId ?? []));
  assert.ok(page.revisions.length >= 4, "at least four versions");
  assert.ok(members.size >= 2, "written by more than one member");

  const first = page.revisions.at(-1);
  const second = page.revisions.at(-2);
  assert.ok(first !== undefined && second !== undefined);
  const opened = read(second.seq) as TasksRevisionAnswer;
  const oldest = read(first.seq) as TasksRevisionAnswer;
  assert.ok("revision" in opened && "revision" in oldest);
  assert.notEqual(
    opened.revision.previous,
    null,
    "a later version is read beside the one before it",
  );
  assert.equal(oldest.revision.previous, null, "the first has none before it");
  assert.notEqual(opened.revision.document.body, opened.revision.previous?.body);
});
