/**
 * description.ts -- `vespin description show` and `description edit`: a task's description printed as the Markdown it is, and written whole from a file or stdin.
 *
 * A description is one Markdown text (`description-edit.ts`). `edit` writes it
 * through the procedure the app's description editor saves with,
 * `plans.editDescription`, naming the text it read just before as the base, so a write
 * an agent made in between is kept where the two do not touch the same
 * lines, and is refused as a conflict where they do, with nothing changed.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import { DESCRIPTION_EDIT_REFUSAL } from "@repo/features/description-edit";
import { TASK_BOUNDS } from "@repo/features/task-wire";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveTaskId } from "../tasks.js";

/**
 * A task's description written whole: `value` laid over `base`, the text
 * it was read as, answered with the description as saved, or a refusal
 * saying why nothing was.
 */
export function writeDescription(taskId: string, base: string, value: string) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;
    const saved = yield* askService(hosted.plans.editDescription, {
      params: { id: taskId },
      body: { document: { base, value } },
    });
    if ("plan" in saved) return saved.plan;
    return yield* new CommandFailed({
      exit: CLI_EXIT.REFUSED,
      message:
        "conflict" in saved
          ? "The description changed in the same lines while it was written, so nothing was saved. Run vespin description show, and write it again."
          : saved.refused === DESCRIPTION_EDIT_REFUSAL.TOO_LONG
            ? `The description is longer than a description may be (${TASK_BOUNDS.MAX_BODY_CHARS} characters), so nothing was saved.`
            : "The description was refused, so nothing was saved.",
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
  Command.withDescription("Print a task's description as Markdown"),
  Command.withExamples([
    { command: "vespin description show ACME-42", description: "Print the description" },
    {
      command: "vespin description show ACME-42 | jq -r .body > description.md",
      description: "Save it to edit",
    },
  ]),
);

const editCommand = Command.make(
  "edit",
  {
    task: taskArgument,
    file: Flag.String("file").pipe(
      Flag.withAlias("F"),
      Flag.withDescription("The whole description, as Markdown, from a file or - for stdin"),
    ),
  },
  ({ task, file }) =>
    Effect.gen(function* () {
      const value = yield* readInput(file);
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      const { plan } = yield* askService(hosted.plans.open, { id });
      const saved = yield* writeDescription(id, plan.document.body, value);
      yield* answer({
        json: { id: saved.id, name: saved.name, body: saved.document.body },
        lines: [`Saved the description of ${saved.name}.`],
        ids: [saved.id],
      });
    }),
).pipe(
  Command.withDescription("Replace a task's description with Markdown from a file or stdin"),
  Command.withExamples([
    {
      command: "vespin description edit ACME-42 -F description.md",
      description: "Write the description from a file",
    },
    {
      command:
        "vespin description show ACME-42 | jq -r .body | sed 's/TODO/Done/' | vespin description edit ACME-42 -F -",
      description: "Edit it in a pipe",
    },
  ]),
);

/** The description group: show and edit. */
export const descriptionCommand = Command.make("description").pipe(
  Command.withDescription("Print or write a task's description"),
  Command.withSubcommands([showCommand, editCommand]),
  Command.withExamples([
    { command: "vespin description show ACME-42", description: "Print the description" },
  ]),
);
