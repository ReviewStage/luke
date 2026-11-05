/**
 * inbox.ts -- `vespin inbox list`, `view`, `answer`, `reply`, and `close`: the threads agents posted for the member, one read whole, its open ask answered, a message written on it, or the thread closed without an answer.
 *
 * `list` reads the account's open threads (`inbox.account`) and keeps those
 * of the workspace the command acts in, placing a task's thread by its
 * task (`plans.list`). `view` finds the thread's agent (`inbox.home`) and
 * reads its threads (`inbox.agent`) for the one asked. The writes go
 * through the procedures the app's inbox sends them by: an answer is a
 * message carrying the answer to the open ask (`inbox.message`, its
 * answer made by `@repo/features/cli-inbox-answer`), a thread that asks
 * nothing is nodded to with Got it (`inbox.answer`), and a close is
 * `inbox.close`, each against the revision just read, so a thread the
 * agent changed since is not settled unseen.
 */

import { randomUUID } from "node:crypto";
import {
  ACCOUNT_INBOX_REPOSITORYLESS,
  type AccountInboxAnswer,
} from "@repo/features/account-inbox-wire";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { CLI_DO_ANSWER, cliInboxAnswer } from "@repo/features/cli-inbox-answer";
import {
  INBOX_ASK,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  knownAsk,
  openAskOf,
  recommendedLabels,
} from "@repo/features/inbox-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** A thread named by its id, as `inbox list` prints it. */
const threadArgument = Argument.String("thread").pipe(
  Argument.withDescription("The thread's id, as inbox list prints it"),
);

/** A thread as a list row carries it, from the account's read. */
interface ListedThread {
  readonly id: string;
  readonly title: string;
  readonly unread: boolean;
  readonly asking: boolean;
  readonly agentId: string;
  readonly agent: string;
  readonly taskId: string | null;
  readonly task: string | null;
  readonly updatedAt: number;
}

/** The account's open threads of one workspace, the latest changed first. */
function threadsOf(
  read: AccountInboxAnswer,
  tasks: ReadonlyMap<string, string>,
  workspaceId: string,
): readonly ListedThread[] {
  const ofTasks = read.items.flatMap((entry) => {
    const task = tasks.get(entry.planId);
    if (task === undefined) return [];
    return [
      {
        id: entry.id,
        title: entry.title,
        unread: entry.unread === true,
        asking: entry.asking !== false,
        agentId: entry.agentId,
        agent: entry.agentTitle ?? entry.agentModel,
        taskId: entry.planId,
        task,
        updatedAt: entry.updatedAt,
      },
    ];
  });
  const taskless = (read.planless ?? [])
    .filter((entry) => entry.workspaceId === workspaceId)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      unread: entry.unread === true,
      asking: entry.asking !== false,
      agentId: entry.agentId,
      agent: entry.agentTitle ?? entry.agentModel,
      taskId: null,
      task: null,
      updatedAt: entry.updatedAt,
    }));
  return [...ofTasks, ...taskless].sort((one, other) => other.updatedAt - one.updatedAt);
}

/** One thread whole, as its agent's threads carry it, or a refusal where the member may read no such thread. */
const threadRead = Effect.fnUntraced(function* (thread: string) {
  const { hosted } = yield* session;
  const home = yield* askService(hosted.inbox.home, { id: thread });
  const { items } = yield* askService(hosted.inbox.agent, { id: home.agentId });
  const item = items.find((each) => each.id === thread);
  if (item === undefined) {
    return yield* new CommandFailed({ exit: CLI_EXIT.REFUSED, message: `No thread ${thread}.` });
  }
  return item;
});

/** Who wrote a message, as a line names them. */
function authorOf(message: InboxMessage): string {
  if (message.author === INBOX_MESSAGE_AUTHOR.AGENT) return "Agent";
  return message.member?.name ?? "Member";
}

/** An ask's lines: what it takes, and how to answer it with `inbox answer`. */
function askLines(read: InboxReadAsk, thread: string): readonly string[] {
  const ask = knownAsk(read);
  if (ask === undefined) return ["An ask this version cannot show. Update vespin."];
  switch (ask.type) {
    case INBOX_ASK.DECIDE: {
      const recommended = new Set(recommendedLabels(ask));
      return [
        `Decide${ask.multiple === true ? " (pick one or more)" : ""}:`,
        ...ask.options.map((option) =>
          [
            `  - ${option.label}`,
            recommended.has(option.label) ? " (recommended)" : "",
            option.detail === undefined ? "" : `: ${option.detail}`,
          ].join(""),
        ),
        `Answer: vespin inbox answer ${thread} "<option>"`,
      ];
    }
    case INBOX_ASK.DO:
      return [
        "To do:",
        ...ask.steps.map((step, index) => `  ${index + 1}. ${step}`),
        `Answer: vespin inbox answer ${thread} ${CLI_DO_ANSWER.DONE} (or ${CLI_DO_ANSWER.NOT_DONE})`,
      ];
    case INBOX_ASK.ANSWER:
      if (ask.fields === undefined) {
        return ["Answer in your own words:", `Answer: vespin inbox answer ${thread} "<words>"`];
      }
      return [
        "Fill in:",
        ...ask.fields.map((field) =>
          [
            `  - ${field.label} (${field.type}`,
            field.required === true ? ", required" : "",
            field.options === undefined ? "" : `: ${field.options.join(", ")}`,
            ")",
          ].join(""),
        ),
        `Answer: vespin inbox answer ${thread} -F values.json, with {"<field>": <value>, ...}`,
      ];
  }
}

/** A thread's lines: its title and where it stands, its messages, and its open ask. */
function threadLines(item: InboxItem): readonly string[] {
  const asking = openAskOf(item.thread ?? []);
  return [
    `${item.title}  [${item.status}]`,
    "",
    ...(item.thread ?? []).flatMap((message) => [
      `${authorOf(message)}:`,
      ...message.text.split("\n").map((line) => `  ${line}`),
      "",
    ]),
    ...(asking === undefined ? [] : askLines(asking.ask, item.id)),
  ];
}

/** A key a write is taken once under, as the app makes one for each. */
function clientKey(): string {
  return randomUUID();
}

/** A write that was not taken because the agent changed the thread first. */
function changedFirst(thread: string): CommandFailed {
  return new CommandFailed({
    exit: CLI_EXIT.REFUSED,
    message: `The thread changed before this reached it. Read it again with vespin inbox view ${thread}.`,
  });
}

/** A thread that is no longer open, which takes no answer and no close. */
function settled(item: InboxItem): CommandFailed {
  return new CommandFailed({ exit: CLI_EXIT.REFUSED, message: `The thread is ${item.status}.` });
}

/** The item a write left, as each reader takes it. */
function written(item: InboxItem, line: string) {
  return answer({ json: { item }, lines: [line], ids: [item.id] });
}

const listCommand = Command.make(
  "list",
  {
    unread: Flag.Boolean("unread").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Only the threads you have not read"),
    ),
  },
  ({ unread }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const read = yield* askService(hosted.inbox.account, {
        [ACCOUNT_INBOX_REPOSITORYLESS.QUERY]: ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE,
      });
      const { plans } = yield* askService(hosted.plans.list, {});
      const tasks = new Map(
        plans
          .filter((plan) => plan.workspaceId === workspace.id)
          .map((plan) => [plan.id, plan.name]),
      );
      const threads = threadsOf(read, tasks, workspace.id).filter(
        (thread) => !unread || thread.unread,
      );
      yield* answer({
        json: { workspace: { id: workspace.id, slug: workspace.slug }, threads },
        lines:
          threads.length === 0
            ? ["No open threads."]
            : threads.map(
                (thread) =>
                  `${thread.unread ? "●" : " "} ${thread.id}  ${thread.title}  (${thread.task ?? thread.agent})${thread.asking ? "  asks" : ""}`,
              ),
        ids: threads.map(({ id }) => id),
      });
    }),
).pipe(
  Command.withDescription("List the open threads of the workspace, unread marked ●"),
  Command.withExamples([
    { command: "vespin inbox list", description: "Every open thread" },
    { command: "vespin inbox list --unread -q", description: "The ids of the unread ones" },
  ]),
);

const viewCommand = Command.make("view", { thread: threadArgument }, ({ thread }) =>
  Effect.gen(function* () {
    const item = yield* threadRead(thread);
    const asking = openAskOf(item.thread ?? []);
    yield* answer({
      json: {
        item,
        openAsk: asking === undefined ? null : { message: asking.message.id, ...asking.ask },
      },
      lines: threadLines(item),
      ids: [item.id],
    });
  }),
).pipe(
  Command.withDescription("Show a thread: its messages and its open ask"),
  Command.withExamples([
    { command: "vespin inbox view <thread>", description: "Read a thread and what it asks" },
  ]),
);

const answerCommand = Command.make(
  "answer",
  {
    thread: threadArgument,
    words: Argument.String("answer").pipe(
      Argument.variadic(),
      Argument.withDescription(
        `A decide's option, ${CLI_DO_ANSWER.DONE} or ${CLI_DO_ANSWER.NOT_DONE} for a to-do, or your words`,
      ),
    ),
    input: Flag.String("input").pipe(
      Flag.withAlias("F"),
      Flag.optional,
      Flag.withDescription(
        "A form's values as a JSON object by field, or your words, from a file or - for stdin",
      ),
    ),
  },
  ({ thread, words, input }) =>
    Effect.gen(function* () {
      const item = yield* threadRead(thread);
      if (item.status !== INBOX_STATUS.OPEN) return yield* settled(item);
      const { hosted } = yield* session;
      const asking = openAskOf(item.thread ?? []);
      // Note that a thread that asks nothing is answered as the app's Got it does.
      if (asking === undefined && words.length === 0 && Option.isNone(input)) {
        const nodded = yield* askService(hosted.inbox.answer, {
          params: { id: thread },
          body: {
            revision: item.revision,
            reply: INBOX_REPLY.ACKNOWLEDGED,
            clientKey: clientKey(),
          },
        });
        if (!nodded.taken) return yield* changedFirst(thread);
        return yield* written(nodded.item, "Acknowledged.");
      }
      const given = Option.isSome(input) ? yield* readInput(input.value) : undefined;
      const made = cliInboxAnswer(asking, { words, input: given });
      if ("refusal" in made) {
        return yield* new CommandFailed({ exit: CLI_EXIT.USAGE, message: made.refusal });
      }
      const sent = yield* askService(hosted.inbox.message, {
        params: { id: thread },
        body: { text: made.text, answers: made.answers, clientKey: clientKey() },
      });
      yield* written(sent.item, "Answered.");
    }),
).pipe(
  Command.withDescription("Answer a thread's open ask, or acknowledge a thread that asks nothing"),
  Command.withExamples([
    { command: "vespin inbox answer <thread> Approve", description: "Pick a decide's option" },
    {
      command: `vespin inbox answer <thread> ${CLI_DO_ANSWER.DONE}`,
      description: "Mark a to-do done",
    },
    {
      command: `echo '{"Region":"us-east-1"}' | vespin inbox answer <thread> -F -`,
      description: "Fill in a form from stdin",
    },
  ]),
);

const replyCommand = Command.make(
  "reply",
  {
    thread: threadArgument,
    input: Flag.String("input").pipe(
      Flag.withAlias("F"),
      Flag.withDescription("The message, from a file or - for stdin"),
    ),
  },
  ({ thread, input }) =>
    Effect.gen(function* () {
      const text = (yield* readInput(input)).trim();
      if (text === "") {
        return yield* new CommandFailed({ exit: CLI_EXIT.USAGE, message: "The message is empty." });
      }
      const { hosted } = yield* session;
      const sent = yield* askService(hosted.inbox.message, {
        params: { id: thread },
        body: { text, clientKey: clientKey() },
      });
      yield* written(sent.item, "Sent.");
    }),
).pipe(
  Command.withDescription("Write a message on a thread, which reaches its agent"),
  Command.withExamples([
    {
      command: 'echo "Use the staging database." | vespin inbox reply <thread> -F -',
      description: "Reply from stdin",
    },
  ]),
);

const closeCommand = Command.make(
  "close",
  {
    thread: threadArgument,
    input: Flag.String("input").pipe(
      Flag.withAlias("F"),
      Flag.optional,
      Flag.withDescription("A note saying why, from a file or - for stdin"),
    ),
  },
  ({ thread, input }) =>
    Effect.gen(function* () {
      const item = yield* threadRead(thread);
      if (item.status !== INBOX_STATUS.OPEN) return yield* settled(item);
      const note = Option.isSome(input) ? (yield* readInput(input.value)).trim() : "";
      const { hosted } = yield* session;
      const closed = yield* askService(hosted.inbox.close, {
        params: { id: thread },
        body: {
          revision: item.revision,
          clientKey: clientKey(),
          ...(note === "" ? undefined : { text: note }),
        },
      });
      if (!closed.taken) return yield* changedFirst(thread);
      yield* written(closed.item, "Closed.");
    }),
).pipe(
  Command.withDescription("Close a thread without answering it"),
  Command.withExamples([{ command: "vespin inbox close <thread>", description: "Close a thread" }]),
);

export const inboxCommand = Command.make("inbox").pipe(
  Command.withDescription("Read and answer the threads agents posted for you"),
  Command.withSubcommands([listCommand, viewCommand, answerCommand, replyCommand, closeCommand]),
  Command.withExamples([
    { command: "vespin inbox list --unread", description: "The threads you have not read" },
  ]),
);
