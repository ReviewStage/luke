/**
 * task.ts -- `vespin task list`, `view`, `create`, and `update`: the workspace's tasks, one task with its agents, pull requests, and open asks, a new task, and a task changed.
 *
 * Each reads the workspace a command acts in (`../workspace.js`) and names a
 * task by its id, its number, or its key (`../tasks.js`). `create` takes its
 * repository from the working folder's `origin` unless `-R` names one, and
 * with `--start` or `--prompt` starts an agent on the new task, the one-shot
 * every peer leads with: in the create's own request where there is no plan
 * to write first, else created, then planned through `plans.edit`, then
 * started, so the agent reads the plan it was given.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import { INBOX_STATUS, type InboxItem, openAskOf } from "@repo/features/inbox-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS_ORDER,
  type TaskPullRequestLine,
  type TaskSummary,
} from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import type { Workspace } from "@repo/features/workspace-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { originRepository } from "../git.js";
import { answer, CommandFailed, columns, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveTaskId, signedInMemberId } from "../tasks.js";
import { resolveWorkspace } from "../workspace.js";
import { agentLines, startAgent, startedLines } from "./agent.js";
import { writePlan } from "./plan.js";

/** What `--assignee` takes to assign the task to nobody, and to the signed-in member. */
const ASSIGNEE_WORD = { NONE: "none", ME: "me" } as const;

/** The fields of a task every answer prints, its key beside them where it has a number. */
function taskJson(task: Omit<TaskSummary, "agents">, workspaceName: string | undefined) {
  const { id, number, name, status, priority, repository, assignee, workspaceId } = task;
  return {
    id,
    key:
      number === undefined || workspaceName === undefined ? null : taskKey(workspaceName, number),
    number: number ?? null,
    name,
    status: status ?? null,
    priority: priority ?? null,
    repository,
    assignee: assignee ?? null,
    workspaceId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** How a task is named to a person: its key where it has one, else its id. */
function taskLabel(task: ReturnType<typeof taskJson>): string {
  return task.key ?? task.id;
}

/** A pull request's line: its number, where it stands, its checks, and its title and address. */
function pullRequestLine(pullRequest: TaskPullRequestLine): string[] {
  return [
    `#${pullRequest.number}`,
    pullRequest.state,
    `checks ${pullRequest.checks}`,
    `${pullRequest.title}${pullRequest.url === undefined ? "" : `  ${pullRequest.url}`}`,
  ];
}

/** An open ask's line: the thread's title and the words that ask, on their first line. */
function askLine(item: InboxItem): string | undefined {
  const asking = openAskOf(item.thread ?? []);
  if (item.status !== INBOX_STATUS.OPEN || asking === undefined) return undefined;
  const words = asking.message.text.trim().split("\n")[0] ?? "";
  return `  ${item.title}${words.length === 0 ? "" : `: ${words}`}  (${item.id})`;
}

/** The workspace of the member's a task belongs to, by its id, for its key. */
function workspaceNamed(workspaces: readonly Workspace[], id: string): string | undefined {
  return workspaces.find((workspace) => workspace.id === id)?.name;
}

const listCommand = Command.make(
  "list",
  {
    mine: Flag.Boolean("mine").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Only the tasks assigned to you"),
    ),
    status: Flag.Literals("status", TASK_STATUS_ORDER).pipe(
      Flag.optional,
      Flag.withDescription("Only the tasks that stand here"),
    ),
  },
  ({ mine, status }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const me = mine ? yield* signedInMemberId : undefined;
      const { plans } = yield* askService(hosted.plans.list, {});
      const listed = plans.filter(
        (task) =>
          task.workspaceId === workspace.id &&
          (Option.isNone(status) || task.status === status.value) &&
          (me === undefined || task.assignee?.userId === me),
      );
      const found = listed.map((task) => ({
        ...taskJson(task, workspace.name),
        agents: task.agents?.total ?? 0,
        working: task.agents?.working ?? 0,
        pullRequests: task.agents?.pullRequests ?? [],
      }));
      yield* answer({
        json: found,
        lines:
          found.length === 0
            ? ["No tasks."]
            : columns(
                found.map((task) => [
                  taskLabel(task),
                  task.status ?? "",
                  task.priority ?? "",
                  task.working > 0 ? `${task.working} working` : "",
                  task.name,
                ]),
              ),
        ids: found.map((task) => task.id),
      });
    }),
).pipe(
  Command.withDescription("List the workspace's tasks, newest first"),
  Command.withExamples([
    { command: "vespin task list", description: "Every task of the workspace" },
    {
      command: "vespin task list --mine --status in-progress",
      description: "Your tasks under way",
    },
  ]),
);

const viewCommand = Command.make(
  "view",
  {
    task: Argument.String("task").pipe(
      Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
    ),
  },
  ({ task }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      const [{ plan }, { agents }, { plans }, { items }, { workspaces }] = yield* Effect.all(
        [
          askService(hosted.plans.open, { id }),
          askService(hosted.agents.listOfTask, { id }),
          askService(hosted.plans.list, {}),
          askService(hosted.inbox.task, { id }),
          askService(hosted.workspaces.list, undefined),
        ],
        { concurrency: "unbounded" },
      );
      const row = plans.find((listed) => listed.id === id);
      const found = taskJson(plan, workspaceNamed(workspaces, plan.workspaceId));
      const pullRequests = row?.agents?.pullRequests ?? [];
      const asks = items.flatMap((item) => {
        const line = askLine(item);
        return line === undefined ? [] : [{ item, line }];
      });
      yield* answer({
        json: {
          ...found,
          agents,
          pullRequests,
          pullRequestTotal: row?.agents?.pullRequestTotal ?? pullRequests.length,
          openAsks: asks.map(({ item }) => item),
        },
        lines: [
          `${taskLabel(found)}  ${found.name}`,
          ...columns([
            ["Status", found.status ?? "none"],
            ["Priority", found.priority ?? "none"],
            ["Repository", found.repository ?? "none"],
            ["Assignee", found.assignee?.name ?? "nobody"],
            ["Id", found.id],
          ]),
          "",
          `Agents (${agents.length})`,
          ...(agents.length === 0 ? ["  none"] : agentLines(agents).map((line) => `  ${line}`)),
          "",
          `Pull requests (${row?.agents?.pullRequestTotal ?? pullRequests.length})`,
          ...(pullRequests.length === 0
            ? ["  none"]
            : columns(pullRequests.map(pullRequestLine)).map((line) => `  ${line}`)),
          "",
          `Open asks (${asks.length})`,
          ...(asks.length === 0 ? ["  none"] : asks.map(({ line }) => line)),
        ],
        ids: [found.id],
      });
    }),
).pipe(
  Command.withDescription("Show a task: where it stands, its agents, pull requests, and open asks"),
  Command.withExamples([
    { command: "vespin task view ACME-42", description: "One task, by its key" },
    { command: "vespin task view 42 --json", description: "The same, by its number, as JSON" },
  ]),
);

const createCommand = Command.make(
  "create",
  {
    title: Argument.String("title").pipe(Argument.withDescription("The task's name")),
    repo: Flag.String("repo").pipe(
      Flag.withAlias("R"),
      Flag.optional,
      Flag.withDescription("The GitHub repository, owner/name (default: this folder's origin)"),
    ),
    file: Flag.String("file").pipe(
      Flag.withAlias("F"),
      Flag.optional,
      Flag.withDescription("The plan, as Markdown, from a file or - for stdin"),
    ),
    start: Flag.Boolean("start").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Start an agent on the new task, handed its plan"),
    ),
    prompt: Flag.String("prompt").pipe(
      Flag.optional,
      Flag.withDescription(
        "Start an agent with this prompt in the plan's place, from a file or - for stdin",
      ),
    ),
  },
  ({ title, repo, file, start, prompt }) =>
    Effect.gen(function* () {
      const fileSource = Option.getOrUndefined(file);
      const promptSource = Option.getOrUndefined(prompt);
      if (fileSource === "-" && promptSource === "-") {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Only one of -F and --prompt may read stdin.",
        });
      }
      const planText = fileSource === undefined ? undefined : yield* readInput(fileSource);
      const promptText = promptSource === undefined ? undefined : yield* readInput(promptSource);
      const starting = start || promptText !== undefined;
      if (starting && planText === undefined && promptText === undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message:
            "An agent needs something to work from: give the task a plan with -F, or the agent a prompt with --prompt.",
        });
      }
      const repository = Option.isSome(repo) ? repo.value : yield* originRepository;
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      // Note that an agent goes in the create's own request only where no plan is written first, since it would read the plan empty.
      const together = starting && planText === undefined;
      const created = yield* askService(
        hosted.plans.create,
        {
          name: title,
          workspaceId: workspace.id,
          repository,
          ...(together
            ? {
                agent: {
                  idempotencyKey: crypto.randomUUID(),
                  ...(promptText === undefined ? undefined : { prompt: promptText }),
                },
              }
            : { planning: false }),
        },
        together ? HOSTED_DEADLINE.START : HOSTED_DEADLINE.USUAL,
      );
      const task = taskJson(created.body.plan, workspace.name);
      if (planText !== undefined) {
        yield* writePlan(task.id, created.body.plan.document.body, planText);
      }
      const agent =
        starting && !together
          ? yield* startAgent(task.id, {
              ...(promptText === undefined ? undefined : { prompt: promptText }),
            })
          : created.body.agent;
      const refusal = created.body.agentRefusal;
      yield* answer({
        json: { task, agent: agent ?? null, agentRefusal: refusal ?? null },
        lines: [
          `Created ${taskLabel(task)} ${task.name} in ${repository}.`,
          ...(agent === undefined ? [] : startedLines(agent)),
        ],
        ids: [task.id, ...(agent === undefined ? [] : [agent.id])],
      });
      if (refusal !== undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.REFUSED,
          message: `The task was created, but ${PRODUCT_NAME} refused its agent: ${refusal.error}.`,
        });
      }
    }),
).pipe(
  Command.withDescription(
    "Create a task in this folder's repository, and with --start or --prompt start an agent on it",
  ),
  Command.withExamples([
    { command: 'vespin task create "Fix the login redirect"', description: "A new task, no agent" },
    {
      command: 'vespin task create "Fix the login redirect" -F plan.md --start',
      description: "A task with a plan, and an agent working it",
    },
    {
      command:
        'echo "Fix the flaky test in auth.test.ts" | vespin task create "Flaky test" --prompt -',
      description: "A task and an agent on a prompt from stdin",
    },
  ]),
);

const updateCommand = Command.make(
  "update",
  {
    task: Argument.String("task").pipe(
      Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
    ),
    status: Flag.Literals("status", TASK_STATUS_ORDER).pipe(
      Flag.optional,
      Flag.withDescription("Where it stands; done marks it done"),
    ),
    priority: Flag.Literals("priority", TASK_PRIORITY_ORDER).pipe(
      Flag.optional,
      Flag.withDescription("How much it matters"),
    ),
    assignee: Flag.String("assignee").pipe(
      Flag.optional,
      Flag.withDescription("A member by email, name, or id; me for you, none for nobody"),
    ),
    name: Flag.String("name").pipe(Flag.optional, Flag.withDescription("Its new name")),
  },
  ({ task, status, priority, assignee, name }) =>
    Effect.gen(function* () {
      if ([status, priority, assignee, name].every(Option.isNone)) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Name a change: --status, --priority, --assignee, or --name.",
        });
      }
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      const assigneeId = Option.isSome(assignee)
        ? yield* memberIdOf(id, assignee.value)
        : undefined;
      const { plan } = yield* askService(hosted.plans.update, {
        params: { id },
        body: {
          ...(Option.isSome(status) ? { status: status.value } : undefined),
          ...(Option.isSome(priority) ? { priority: priority.value } : undefined),
          ...(assigneeId === undefined ? undefined : { assigneeId }),
          ...(Option.isSome(name) ? { name: name.value } : undefined),
        },
      });
      const { workspaces } = yield* askService(hosted.workspaces.list, undefined);
      const found = taskJson(plan, workspaceNamed(workspaces, plan.workspaceId));
      yield* answer({
        json: found,
        lines: [
          `Updated ${taskLabel(found)} ${found.name}: ${found.status ?? "none"}, ${found.priority ?? "none"}, ${found.assignee?.name ?? "nobody"}.`,
        ],
        ids: [found.id],
      });
    }),
).pipe(
  Command.withDescription("Change a task's status, priority, assignee, or name"),
  Command.withExamples([
    { command: "vespin task update ACME-42 --status done", description: "Mark a task done" },
    {
      command: "vespin task update ACME-42 --assignee me --priority high",
      description: "Take a task, and raise it",
    },
  ]),
);

/** The account id `--assignee` names among the task's workspace's members: none for nobody, or a usage failure where it names no one, or several. */
function memberIdOf(taskId: string, named: string) {
  return Effect.gen(function* () {
    if (named === ASSIGNEE_WORD.NONE) return null;
    if (named === ASSIGNEE_WORD.ME) return yield* signedInMemberId;
    const { hosted } = yield* session;
    const { plan } = yield* askService(hosted.plans.open, { id: taskId });
    const { members } = yield* askService(hosted.workspaces.members, {
      workspaceId: plan.workspaceId,
    });
    const lowered = named.toLowerCase();
    const matches = members.filter(
      (member) =>
        member.userId === named ||
        member.email.toLowerCase() === lowered ||
        member.name.toLowerCase() === lowered,
    );
    const [only, ...others] = matches;
    if (only !== undefined && others.length === 0) return only.userId;
    const listed = members.map((member) => `  ${member.email}  ${member.name}`);
    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: [
        only === undefined
          ? `${named} is no member of the task's workspace.`
          : `${named} names several members; name one by email.`,
        "Its members:",
        ...listed,
      ].join("\n"),
    });
  });
}

/** The task group: list, view, create, and update. */
export const taskCommand = Command.make("task").pipe(
  Command.withDescription("List, view, create, and change tasks"),
  Command.withSubcommands([listCommand, viewCommand, createCommand, updateCommand]),
  Command.withExamples([
    { command: "vespin task list --mine", description: "Your tasks" },
    { command: 'vespin task create "Fix X" --prompt -', description: "A task, and an agent on it" },
  ]),
);
