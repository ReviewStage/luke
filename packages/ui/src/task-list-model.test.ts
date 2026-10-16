import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { PlanSummary } from "@luke/features/plan-wire";
import { expect, test } from "vitest";
import {
  agentRow,
  type CreatorGroup,
  createdByOnly,
  creatorGroups,
  type RepositoryGroup,
  repositoryGroups,
  repositoryLabel,
  TASK_ORDER,
  TASK_ROW,
  type TaskOrder,
  type TaskRow,
  taskRow,
  taskRowName,
  taskRowsCreatedBy,
  taskTime,
} from "./task-list-model.js";

const DEAN = "user-dean";
const CHARLES = "user-charles";
const MAYA = "user-maya";

const NAMES = {
  [DEAN]: "Dean Stratakos",
  [CHARLES]: "Charles Pan",
  [MAYA]: "Maya Okafor",
} as const;

/** A task on `repository`, started at `createdAt`, last updated at `updatedAt`, by `creator` where one is named. */
function task(
  name: string,
  repository: string | null,
  createdAt: number,
  updatedAt: number,
  creator?: keyof typeof NAMES,
): PlanSummary {
  return {
    id: name,
    workspaceId: "workspace-acme",
    name,
    createdAt,
    updatedAt,
    repository,
    ...(creator === undefined
      ? undefined
      : { ownerId: creator, createdBy: { userId: creator, name: NAMES[creator] } }),
  };
}

/** A creator's name as the wire carries it. */
const nameOnWire = (plan: PlanSummary) => plan.createdBy?.name ?? "";

const names = (groups: readonly { rows: readonly TaskRow[] }[]) =>
  groups.map((group) => group.rows.map(taskRowName));

/** The tasks grouped by repository, as their rows are. */
const groupsByRepository = (
  plans: readonly PlanSummary[],
  order?: TaskOrder,
): readonly RepositoryGroup[] => repositoryGroups(plans.map(taskRow), order);

/** The tasks grouped by creator, as their rows are, each named by its plan. */
const groupsByCreator = (
  plans: readonly PlanSummary[],
  order: TaskOrder,
  readerId: string | undefined,
  nameOf: (plan: PlanSummary) => string,
): readonly CreatorGroup[] =>
  creatorGroups(plans.map(taskRow), order, readerId, (row) =>
    row.kind === TASK_ROW.TASK ? nameOf(row.plan) : "",
  );

test("a repository group lists its tasks newest updated first, the time each row shows", () => {
  const groups = groupsByRepository([
    task("old", "acme/relay", 3, 10),
    task("touched", "acme/relay", 1, 30),
    task("new", "acme/relay", 2, 20),
  ]);
  expect(names(groups)).toEqual([["touched", "new", "old"]]);
});

test("ordered by when they were started, the groups and their rows follow the newest started", () => {
  const groups = groupsByRepository(
    [
      task("relay first started", "acme/relay", 1, 90),
      task("console newest started", "acme/console", 50, 5),
      task("relay later started", "acme/relay", 20, 10),
    ],
    TASK_ORDER.CREATED,
  );
  expect(groups.map((group) => group.repository)).toEqual(["acme/console", "acme/relay"]);
  expect(names(groups)).toEqual([
    ["console newest started"],
    ["relay later started", "relay first started"],
  ]);
});

test("ordered by name, the repositories and their tasks run alphabetically, the tasks with none last", () => {
  const groups = groupsByRepository(
    [
      task("Zebra", "acme/relay", 1, 1),
      task("Notes", null, 1, 99),
      task("Apple", "acme/relay", 1, 2),
      task("Billing", "acme/console", 1, 3),
    ],
    TASK_ORDER.NAME,
  );
  expect(groups.map((group) => group.repository)).toEqual(["acme/console", "acme/relay", null]);
  expect(names(groups)).toEqual([["Billing"], ["Apple", "Zebra"], ["Notes"]]);
});

test("a row shows when its task was started under Created, and its last update otherwise", () => {
  const plan = task("Retry webhooks", "acme/relay", 100, 900);
  expect(taskTime(plan, TASK_ORDER.CREATED)).toBe(100);
  expect(taskTime(plan, TASK_ORDER.UPDATED)).toBe(900);
  expect(taskTime(plan, TASK_ORDER.NAME)).toBe(900);
});

test("two repositories sharing a name are told apart by their owners", () => {
  const groups = groupsByRepository([task("a", "acme/site", 1, 2), task("b", "labs/site", 1, 1)]);
  expect(repositoryLabel("acme/site", groups)).toBe("acme/site");
  expect(repositoryLabel("labs/site", groupsByRepository([task("b", "labs/site", 1, 1)]))).toBe(
    "site",
  );
});

test("grouped by creator, the reader's own come first, then each teammate's by their latest, then nobody's", () => {
  const groups = groupsByCreator(
    [
      task("Maya's latest", "acme/relay", 1, 80, MAYA),
      task("Unnamed", "acme/relay", 1, 99),
      task("Dean's", "acme/relay", 1, 10, DEAN),
      task("Charles's", "acme/relay", 1, 50, CHARLES),
      task("Maya's older", "acme/console", 1, 20, MAYA),
    ],
    TASK_ORDER.UPDATED,
    DEAN,
    nameOnWire,
  );
  expect(groups.map((group) => group.creatorId)).toEqual([DEAN, MAYA, CHARLES, undefined]);
  expect(names(groups)[1]).toEqual(["Maya's latest", "Maya's older"]);
});

test("grouped by creator and ordered by name, teammates run by their names after the reader", () => {
  const groups = groupsByCreator(
    [
      task("m", "acme/relay", 1, 1, MAYA),
      task("c", "acme/relay", 1, 1, CHARLES),
      task("d", "acme/relay", 1, 1, DEAN),
    ],
    TASK_ORDER.NAME,
    DEAN,
    nameOnWire,
  );
  expect(groups.map((group) => group.creatorId)).toEqual([DEAN, CHARLES, MAYA]);
});

test("ordered by name, a creator's group sorts by the name its header says, even where the wire names nobody", () => {
  const older = { ...task("Zoe's older", "acme/relay", 1, 1), ownerId: "user-zoe" };
  const groups = groupsByCreator(
    [older, task("Amy's", "acme/relay", 1, 1, MAYA)],
    TASK_ORDER.NAME,
    DEAN,
    (plan) => (plan.ownerId === "user-zoe" ? "Zoe Quinn" : "Amy Ng"),
  );
  expect(
    groups.map((group) => (group.rows[0] === undefined ? undefined : taskRowName(group.rows[0]))),
  ).toEqual(["Amy's", "Zoe's older"]);
});

test("filtered to one creator, the list holds only the tasks they created; filtered to nobody, every task", () => {
  const tasks = [
    task("Dean's", "acme/relay", 1, 1, DEAN),
    task("Charles's", "acme/relay", 1, 1, CHARLES),
    task("Unnamed", "acme/relay", 1, 1),
  ];
  expect(createdByOnly(tasks, DEAN).map((plan) => plan.name)).toEqual(["Dean's"]);
  expect(createdByOnly(tasks, undefined)).toHaveLength(3);
});

test("a task whose agent ended a turn after another task's plan was edited stands first, showing its agent's time", () => {
  const edited = task("Plan edited at 500", "acme/relay", 1, 500);
  const worked = {
    ...task("Agent finished at 800", "acme/relay", 1, 100),
    agents: {
      total: 1,
      working: 0,
      activityAt: 800,
      agents: [],
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
  const groups = groupsByRepository([edited, worked]);
  expect(names(groups)).toEqual([["Agent finished at 800", "Plan edited at 500"]]);
  expect(taskTime(worked, TASK_ORDER.UPDATED)).toBe(800);
  expect(taskTime(edited, TASK_ORDER.UPDATED)).toBe(500);
});

test("an agent's activity older than the plan's own edit leaves the plan's time standing", () => {
  const plan = {
    ...task("Edited after its agent", "acme/relay", 1, 900),
    agents: {
      total: 1,
      working: 0,
      activityAt: 300,
      agents: [],
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
  expect(taskTime(plan, TASK_ORDER.UPDATED)).toBe(900);
  expect(taskTime(plan, TASK_ORDER.CREATED)).toBe(1);
});

test("ordered by name, two tasks of one name stand by their later activity, the time each row shows", () => {
  const edited = task("Deploy", "acme/relay", 1, 500);
  const worked = {
    ...task("Deploy", "acme/relay", 2, 100),
    agents: {
      total: 1,
      working: 0,
      activityAt: 800,
      agents: [],
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
  const [group] = groupsByRepository([edited, worked], TASK_ORDER.NAME);
  expect(group?.rows.map((row) => (row.kind === TASK_ROW.TASK ? row.plan.createdAt : 0))).toEqual([
    2, 1,
  ]);
});

/** An agent an automation of `starter`'s started with no task, on `repository`, started at `createdAt`, last moving at `activityAt`. */
function oneOff(
  title: string | null,
  repository: string,
  createdAt: number,
  activityAt: number,
  starter: keyof typeof NAMES,
): TaskRow {
  return agentRow({
    id: title ?? "untitled",
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    startedBy: { userId: starter, name: NAMES[starter] },
    automationId: "automation-1",
    automationName: "Morning Sentry triage",
    workspaceId: "workspace-acme",
    repository,
    activityAt,
  });
}

test("a one-off agent stands among the tasks of its repository by its last activity, and by when it started under Created", () => {
  const rows = [
    taskRow(task("Retry webhooks", "acme/relay", 10, 40)),
    oneOff("Triage overnight issues", "acme/relay", 30, 60, DEAN),
    taskRow(task("Billing export", "acme/relay", 20, 50)),
    oneOff("Sweep flaky tests", "acme/console", 5, 70, DEAN),
  ];
  expect(names(repositoryGroups(rows))).toEqual([
    ["Sweep flaky tests"],
    ["Triage overnight issues", "Billing export", "Retry webhooks"],
  ]);
  expect(names(repositoryGroups(rows, TASK_ORDER.CREATED))).toEqual([
    ["Triage overnight issues", "Billing export", "Retry webhooks"],
    ["Sweep flaky tests"],
  ]);
});

test("a one-off agent groups and filters under whoever started it, as a task does under its creator", () => {
  const rows = [
    taskRow(task("Charles's task", "acme/relay", 1, 10, CHARLES)),
    oneOff("Dean's agent", "acme/relay", 1, 30, DEAN),
    oneOff("Charles's agent", "acme/relay", 1, 20, CHARLES),
  ];
  const groups = creatorGroups(rows, TASK_ORDER.UPDATED, DEAN, taskRowName);
  expect(groups.map((group) => group.creatorId)).toEqual([DEAN, CHARLES]);
  expect(names(groups)).toEqual([["Dean's agent"], ["Charles's agent", "Charles's task"]]);
  expect(taskRowsCreatedBy(rows, CHARLES).map(taskRowName)).toEqual([
    "Charles's task",
    "Charles's agent",
  ]);
});

test("an untitled one-off agent is named by its automation, as its tab names it, and ordered by that name", () => {
  const rows = [
    taskRow(task("Zebra notes", "acme/relay", 1, 1)),
    oneOff(null, "acme/relay", 1, 1, DEAN),
  ];
  expect(names(repositoryGroups(rows, TASK_ORDER.NAME))).toEqual([
    ["Morning Sentry triage", "Zebra notes"],
  ]);
});
