/**
 * plan.ts -- `vespin plan show` and `plan edit`: a task's plan printed as the Markdown it is, and written whole from a file or stdin.
 *
 * A plan is one Markdown text (`plan-edit.ts`). `edit` writes it through the
 * procedure the app's plan editor saves with, `plans.edit`, naming the text
 * it read just before as the base, so a write an agent made in between is
 * kept where the two do not touch the same lines, and is refused as a
 * conflict where they do, with nothing changed.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import { PLAN_EDIT_REFUSAL } from "@repo/features/plan-edit";
import { TASK_BOUNDS } from "@repo/features/task-wire";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveTaskId } from "../tasks.js";

/**
 * A task's plan written whole: `value` laid over `base`, the text it was
 * read as, answered with the plan as saved, or a refusal saying why nothing
 * was.
 */
export function writePlan(taskId: string, base: string, value: string) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;
    const saved = yield* askService(hosted.plans.edit, {
      params: { id: taskId },
      body: { document: { base, value } },
    });
    if ("plan" in saved) return saved.plan;
    return yield* new CommandFailed({
      exit: CLI_EXIT.REFUSED,
      message:
        "conflict" in saved
          ? "The plan changed in the same lines while it was written, so nothing was saved. Run vespin plan show, and write it again."
          : saved.refused === PLAN_EDIT_REFUSAL.TOO_LONG
            ? `The plan is longer than a plan may be (${TASK_BOUNDS.MAX_BODY_CHARS} characters), so nothing was saved.`
            : "The plan was refused, so nothing was saved.",
    });
  });
}

const taskArgument = Argument.String("task").pipe(
  Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
);

const showCommand = Command.make("show", { task: taskArgument }, ({ task }) =>
  Effect.gen(function* () {
    const id = yield* resolveTaskId(task);
    const { hosted } = yield* session;
    const { plan } = yield* askService(hosted.plans.open, { id });
    yield* answer({
      json: { id: plan.id, name: plan.name, body: plan.document.body },
      // Note that the closing line break is dropped, since each line printed ends in one.
      lines: [plan.document.body.replace(/\n+$/u, "")],
      ids: [plan.id],
    });
  }),
).pipe(
  Command.withDescription("Print a task's plan as Markdown"),
  Command.withExamples([
    { command: "vespin plan show ACME-42", description: "Print the plan" },
    { command: "vespin plan show ACME-42 > plan.md", description: "Save it to edit" },
  ]),
);

const editCommand = Command.make(
  "edit",
  {
    task: taskArgument,
    file: Flag.String("file").pipe(
      Flag.withAlias("F"),
      Flag.withDescription("The whole plan, as Markdown, from a file or - for stdin"),
    ),
  },
  ({ task, file }) =>
    Effect.gen(function* () {
      const value = yield* readInput(file);
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      const { plan } = yield* askService(hosted.plans.open, { id });
      const saved = yield* writePlan(id, plan.document.body, value);
      yield* answer({
        json: { id: saved.id, name: saved.name, body: saved.document.body },
        lines: [`Saved the plan of ${saved.name}.`],
        ids: [saved.id],
      });
    }),
).pipe(
  Command.withDescription("Replace a task's plan with Markdown from a file or stdin"),
  Command.withExamples([
    { command: "vespin plan edit ACME-42 -F plan.md", description: "Write the plan from a file" },
    {
      command: "vespin plan show ACME-42 | sed 's/TODO/Done/' | vespin plan edit ACME-42 -F -",
      description: "Edit it in a pipe",
    },
  ]),
);

/** The plan group: show and edit. */
export const planCommand = Command.make("plan").pipe(
  Command.withDescription("Print or write a task's plan"),
  Command.withSubcommands([showCommand, editCommand]),
  Command.withExamples([{ command: "vespin plan show ACME-42", description: "Print the plan" }]),
);
