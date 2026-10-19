import assert from "node:assert/strict";
import { CALL_KIND, callLine } from "@luke/features/turn-rows";
import { TOOL_BLOCK } from "@luke/panel/ai-elements/tool";
import type { WireRecord } from "@luke/wire";
import { test } from "vitest";
import { cardTitle, TOOL_TARGET, toolCallView, toolTarget } from "./tool-call-model";

const ESCAPE = String.fromCharCode(27);

test("a command's row is the command it ran, and its answer reads as a terminal showed it", () => {
  const view = toolCallView({
    tool: "bash",
    input: { command: "pnpm check" },
    output: {
      status: "completed",
      exitCode: 2,
      stdout: `${ESCAPE}[32mall green${ESCAPE}[0m\n`,
      stderr: "one warning\n",
      truncated: true,
    },
  });
  assert.equal(view.kind, CALL_KIND.COMMAND);
  assert.equal(view.subject, "pnpm check");
  assert.deepEqual(view.input, { kind: TOOL_BLOCK.COMMAND, text: "pnpm check" });
  assert.deepEqual(view.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "all green\none warning\nexit 2\n(output truncated)",
  });
});

test("a command the model described carries its description on one line for the row and keeps the command for the body; one with none, or only blanks, is the command's row as before", () => {
  const described = toolCallView({
    tool: "bash",
    input: { command: "pnpm test --filter web", description: " Run the web\n- tests " },
    output: undefined,
  });
  assert.equal(described.description, "Run the web - tests");
  assert.equal(described.subject, "pnpm test --filter web");
  assert.deepEqual(described.input, { kind: TOOL_BLOCK.COMMAND, text: "pnpm test --filter web" });

  for (const input of [{ command: "ls" }, { command: "ls", description: "  " }]) {
    const plain = toolCallView({ tool: "bash", input, output: undefined });
    assert.equal(plain.description, undefined);
    assert.equal(plain.subject, "ls");
  }
});

test("a command run on the Mac is the command it ran, described as a command is, and its answer says how it ended: its exit, its timeout, or why it was not run", () => {
  const ran = (output: Record<string, string | number | boolean | null>) =>
    toolCallView({
      tool: "run_on_mac",
      input: { command: "pnpm dev", description: "Start the dev server" },
      output,
    });
  const killed = ran({
    status: "ran",
    exitCode: null,
    stdout: "  ready on :3000\n",
    stderr: "",
    truncated: false,
    timedOut: true,
  });
  assert.equal(killed.kind, CALL_KIND.MAC_COMMAND);
  assert.equal(killed.subject, "pnpm dev");
  assert.equal(killed.description, "Start the dev server");
  assert.deepEqual(killed.input, { kind: TOOL_BLOCK.COMMAND, text: "pnpm dev" });
  assert.deepEqual(killed.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "  ready on :3000\n(killed at its timeout)",
  });
  const failed = ran({
    status: "ran",
    exitCode: 1,
    stdout: "",
    stderr: "missing script: dev\n",
    truncated: false,
    timedOut: false,
  });
  assert.deepEqual(failed.output, { kind: TOOL_BLOCK.TEXT, text: "missing script: dev\nexit 1" });
  const refused = ran({
    status: "not-run",
    reason: "Not run: Luke is not running on the developer's Mac.",
  });
  assert.deepEqual(refused.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "Not run: Luke is not running on the developer's Mac.",
  });
});

test("a file read and a search say the path and the pattern, and answer with the words under them", () => {
  const read = toolCallView({
    tool: "read_file",
    input: { filePath: "/workspace/repository/README.md", limit: 20 },
    output: { content: "# Luke\n" },
  });
  assert.equal(read.kind, CALL_KIND.READ_FILE);
  assert.equal(read.subject, "/workspace/repository/README.md");
  assert.deepEqual(read.output, { kind: TOOL_BLOCK.TEXT, text: "# Luke\n" });

  const grep = toolCallView({
    tool: "grep",
    input: { pattern: "invit", path: "/workspace/repository" },
    output: {
      content: "a.ts:1: invite",
      matchCount: 1,
      path: "/workspace/repository",
      truncated: false,
    },
  });
  assert.equal(grep.kind, CALL_KIND.SEARCH);
  assert.equal(grep.subject, "invit");
  assert.deepEqual(grep.output, { kind: TOOL_BLOCK.TEXT, text: "a.ts:1: invite" });

  // A search the tool cut short says so after its matches, so they are not read as all of them.
  const cut = toolCallView({
    tool: "grep",
    input: { pattern: "invit" },
    output: { content: "a.ts:1: invite\n", matchCount: 100, path: "/w", truncated: true },
  });
  assert.deepEqual(cut.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "a.ts:1: invite\n(output truncated)",
  });
});

test("a skill load says the skill it loaded, and answers with the skill's instructions as words", () => {
  const body = "# Release\n\nTag the commit, then publish the notes.";
  const view = toolCallView({
    tool: "load_skill",
    input: { skill: "release-notes" },
    output: body,
  });
  assert.equal(view.kind, CALL_KIND.LOAD_SKILL);
  assert.equal(view.subject, "/release-notes");
  assert.deepEqual(view.input, { kind: TOOL_BLOCK.TEXT, text: "release-notes" });
  assert.deepEqual(view.output, { kind: TOOL_BLOCK.TEXT, text: body });

  const loading = toolCallView({
    tool: "load_skill",
    input: { skill: "release-notes" },
    output: undefined,
  });
  assert.equal(loading.subject, "/release-notes");
  assert.equal(loading.output, undefined);
});

test("a patch names the first file it touches and how many more, carries the patch to draw as a diff, and answers with the files it changed", () => {
  const patchText = [
    "*** Begin Patch",
    "*** Update File: apps/web/a.ts",
    "@@",
    "-old",
    "+new",
    "*** Add File: apps/web/b.ts",
    "+export const b = 1;",
    "*** End Patch",
  ].join("\n");
  const view = toolCallView({
    tool: "apply_patch",
    input: { root: "/workspace/repository", patchText },
    output: {
      diagnostics: [],
      files: [
        { operation: "update", path: "apps/web/a.ts" },
        { operation: "add", path: "apps/web/b.ts" },
      ],
    },
  });
  assert.equal(view.kind, CALL_KIND.EDIT);
  assert.equal(view.subject, "apps/web/a.ts +1");
  assert.deepEqual(view.input, { kind: TOOL_BLOCK.PATCH, text: patchText });
  assert.deepEqual(view.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "update apps/web/a.ts\nadd apps/web/b.ts",
  });

  // A problem the patch reported is told after the files, not dropped.
  const flagged = toolCallView({
    tool: "apply_patch",
    input: { root: "/w", patchText },
    output: {
      diagnostics: ["Type error in apps/web/a.ts", { path: "apps/web/b.ts", message: "unused" }],
      files: [{ operation: "update", path: "apps/web/a.ts" }],
    },
  });
  assert.deepEqual(flagged.output, {
    kind: TOOL_BLOCK.TEXT,
    text: `update apps/web/a.ts\nType error in apps/web/a.ts\n${JSON.stringify({ path: "apps/web/b.ts", message: "unused" }, null, 2)}`,
  });
});

test("a tool this build does not know is named as it is, with its input and answer as JSON", () => {
  const view = toolCallView({
    tool: "gh",
    input: { args: ["pr", "create"] },
    output: { url: "https://github.com/acme/relay/pull/7" },
  });
  assert.equal(view.kind, CALL_KIND.OTHER);
  assert.equal(view.subject, "gh");
  assert.deepEqual(view.input, {
    kind: TOOL_BLOCK.JSON,
    text: '{\n  "args": [\n    "pr",\n    "create"\n  ]\n}',
  });
  assert.deepEqual(view.output, {
    kind: TOOL_BLOCK.JSON,
    text: '{\n  "url": "https://github.com/acme/relay/pull/7"\n}',
  });
  // An answer that is already words is shown as they are.
  assert.deepEqual(toolCallView({ tool: "gh", input: undefined, output: "done" }).output, {
    kind: TOOL_BLOCK.JSON,
    text: "done",
  });
});

test("a command's answer that is not a terminal's envelope falls back to its JSON", () => {
  const view = toolCallView({
    tool: "bash",
    input: { command: "true" },
    output: {
      status: "unknown",
      reason: "The turn ended before the call answered; it may have run.",
    },
  });
  assert.equal(view.output?.kind, TOOL_BLOCK.JSON);
  assert.match(view.output?.text ?? "", /"reason": "The turn ended/u);
});

test("a plan's card is titled by its first heading, or its first line of words", () => {
  assert.equal(cardTitle("# Teammate invitations\n\nInvite by email."), "Teammate invitations");
  assert.equal(cardTitle("\n\nInvite by email.\n# Later"), "Invite by email.");
  assert.equal(cardTitle("   "), "");
  assert.equal(cardTitle("```ts\nconst seats = plan.seats;\n```"), "const seats = plan.seats;");
});

test("a card's title says each link by its name, as markdown reads the link, and never its destination", () => {
  assert.equal(
    cardTitle("Review [@store.ts](https://github.com/acme/relay/blob/HEAD/store.ts) first"),
    "Review store.ts first",
  );
  assert.equal(cardTitle("Read [Plan](https://www.notion.so/Plan-(draft)) now"), "Read Plan now");
  assert.equal(cardTitle("See [the \\[draft\\]](https://example.com/a)"), "See the [draft]");
  assert.equal(cardTitle("outer [inner](https://example.com/b) end"), "outer inner end");
  assert.equal(cardTitle("Read [Docs](<https://example.com/the docs>)"), "Read Docs");
  assert.equal(cardTitle("Keep [a](b c d) as written"), "Keep [a](b c d) as written");
});

test("a card's title is plain words: the marks a markdown line opens on, strong emphasis, code spans, and a link's destination are left out, and an identifier keeps its underscores", () => {
  assert.equal(
    cardTitle("**Goal:** find where `planList` refreshes.\n\n- Read it"),
    "Goal: find where planList refreshes.",
  );
  assert.equal(cardTitle("- Find the admin check"), "Find the admin check");
  assert.equal(cardTitle("1. Find the admin check"), "Find the admin check");
  assert.equal(cardTitle("> Find the admin check"), "Find the admin check");
  assert.equal(cardTitle("Read plan_list_store.ts"), "Read plan_list_store.ts");
  assert.equal(cardTitle("Find who calls `__init__`"), "Find who calls __init__");
  assert.equal(
    cardTitle("Compare [the queue docs](https://example.com/queues) with ours"),
    "Compare the queue docs with ours",
  );
});

test("a plan edit's row sums its notes by what each did, and shows them as JSON", () => {
  const notes = [
    {
      kind: "add",
      field: "openQuestions",
      text: "Who may withdraw an invite? Assuming the sender.",
    },
    { kind: "add", field: "decisions", text: "- Invites expire after 7 days." },
    { kind: "replace", field: "problem", find: "an admin", text: "an owner" },
    { kind: "replace", find: "## Assumptions\n\n- Invites expire.", text: "" },
  ];
  const view = toolCallView({
    tool: "edit_plan",
    input: { notes },
    output: { status: "accepted", taken: 4 },
  });
  assert.equal(view.kind, CALL_KIND.EDIT_PLAN);
  assert.equal(view.subject, "2 added, 1 corrected, 1 struck");
  const pictured = toolCallView({
    tool: "edit_plan",
    input: {
      notes: notes.slice(0, 1),
      pictures: [{ section: "Approach", path: "shot.png", alt: "The members page" }],
    },
    output: undefined,
  });
  assert.equal(pictured.subject, "1 added, 1 picture added");
  assert.equal(view.input.kind, TOOL_BLOCK.JSON);
  assert.equal(
    toolCallView({ tool: "edit_plan", input: undefined, output: undefined }).subject,
    "",
  );
});

test("a post to the inbox is a row naming its item, its blocks and options as the body, a link as its label and address, code as its path, lines, and short commit, an image as its words and its path, and the recommended option saying so; a close names the key and says why", () => {
  const view = toolCallView({
    tool: "post_to_inbox",
    input: {
      key: "invite-queue",
      title: "Which queue backs the `invite` emails?",
      blocks: [
        { type: "markdown", text: "Both work." },
        { type: "link", url: "https://github.com/acme/relay/pull/7", label: "The PR" },
        {
          type: "code",
          repo: "acme/relay",
          path: "src/queue.ts",
          startLine: 12,
          endLine: 20,
          sha: "0123456789abcdef0123456789abcdef01234567",
        },
        { type: "image", path: "shots/queue.png", alt: "The queue dashboard" },
      ],
      response: {
        type: "choice",
        options: [{ label: "Postgres", detail: "One database." }, { label: "Redis" }],
        recommended: "Postgres",
      },
    },
    output: { status: "accepted", inbox: [] },
  });
  assert.equal(view.kind, CALL_KIND.INBOX_POST);
  assert.equal(
    view.subject,
    "Which queue backs the invite emails?",
    "the title as plain words, as its card draws it",
  );
  assert.deepEqual(view.input, {
    kind: TOOL_BLOCK.TEXT,
    text: "Both work.\nThe PR: https://github.com/acme/relay/pull/7\nsrc/queue.ts, Lines 12–20 at 0123456\nImage: The queue dashboard (shots/queue.png)\n- Postgres (recommended) -- One database.\n- Redis",
  });
  assert.equal(view.output, undefined);

  const closed = toolCallView({
    tool: "close_inbox_item",
    input: { key: "invite-queue", reason: "Found it in the README." },
    output: { status: "accepted", inbox: [] },
  });
  assert.equal(closed.kind, CALL_KIND.INBOX_CLOSE);
  assert.equal(closed.subject, "invite-queue");
  assert.deepEqual(closed.input, { kind: TOOL_BLOCK.TEXT, text: "Found it in the README." });
});

test("an agent's reply on an inbox thread is its own row, naming the item's key and showing the words and pictures it sent, and one refused says why", () => {
  const view = toolCallView({
    tool: "reply_inbox",
    input: {
      key: "invite-queue",
      text: "Postgres it is; the migration is in.",
      images: [{ path: "shots/queue.png" }],
    },
    output: { status: "accepted", inbox: [] },
  });
  assert.equal(view.kind, CALL_KIND.INBOX_REPLY);
  assert.equal(view.subject, "invite-queue");
  assert.deepEqual(view.input, {
    kind: TOOL_BLOCK.TEXT,
    text: "Postgres it is; the migration is in.\nImage: shots/queue.png",
  });
  assert.equal(view.output, undefined);

  const refused = toolCallView({
    tool: "reply_inbox",
    input: { key: "gone", text: "Done." },
    output: { status: "rejected", reason: "No item of yours is under the key gone." },
  });
  assert.deepEqual(refused.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "No item of yours is under the key gone.",
  });
});

test("an inbox call that did nothing shows why, so a refused post never reads as posted", () => {
  const view = toolCallView({
    tool: "post_to_inbox",
    input: { key: "one-more", title: "Protect main", response: { type: "task" } },
    output: { status: "rejected", reason: "Not posted: you hold 20 open items already." },
  });
  assert.deepEqual(view.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "Not posted: you hold 20 open items already.",
  });
});

test("a coding agent's hosted public reads draw as the web reads they are: a search by its query, a page by its name and its text", () => {
  const search = toolCallView({
    tool: "search_web",
    input: { query: "invite link expiry" },
    output: { status: "found", findings: [] },
  });
  assert.equal(search.kind, CALL_KIND.WEB_SEARCH);
  assert.equal(search.subject, "invite link expiry");

  const page = toolCallView({
    tool: "read_web_page",
    input: { url: "https://docs.example.com/invites/" },
    output: {
      status: "read",
      url: "https://docs.example.com/invites/",
      text: "Invites expire.",
      truncated: true,
    },
  });
  assert.equal(page.kind, CALL_KIND.WEB_PAGE);
  assert.equal(page.subject, "docs.example.com/invites");
  assert.deepEqual(page.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "Invites expire.\n(output truncated)",
  });
});

test("the planning model's own calls draw from their parts as a coding agent's do: a repository command by its command and purpose, its answer or why it ran nothing, a shown range by its file and lines, a question by its words", () => {
  const ran = toolCallView({
    tool: "run_in_repository",
    input: { command: "ls src", description: "List the sources" },
    output: { status: "ran", exitCode: 0, stdout: "queue.ts\n", stderr: "" },
  });
  assert.equal(ran.kind, CALL_KIND.COMMAND);
  assert.equal(ran.subject, "ls src");
  assert.equal(ran.description, "List the sources");
  assert.deepEqual(ran.output, { kind: TOOL_BLOCK.TEXT, text: "queue.ts" });
  const refused = toolCallView({
    tool: "run_in_repository",
    input: { command: "ls" },
    output: { status: "not-run", reason: "Not run: the plan names no repository." },
  });
  // The service's reason already says it was not run, so its words stand as they are.
  assert.deepEqual(refused.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "Not run: the plan names no repository.",
  });

  const shown = toolCallView({
    tool: "show_code",
    input: { path: "src/invites.ts", startLine: 12, endLine: 30 },
    output: undefined,
  });
  assert.deepEqual(
    [shown.kind, shown.subject],
    [CALL_KIND.SHOW_CODE, "src/invites.ts, Lines 12–30"],
  );
  const asked = toolCallView({
    tool: "queue_question",
    input: { question: "Who can invite?", recommendation: "Admins." },
    output: undefined,
  });
  assert.deepEqual([asked.kind, asked.subject], [CALL_KIND.QUEUE_QUESTION, "Who can invite?"]);
  const looked = toolCallView({ tool: "look_at_board", input: {}, output: { image: "…" } });
  assert.deepEqual([looked.kind, looked.output], [CALL_KIND.LOOK_AT_BOARD, undefined]);
  const started = (input: Record<string, string>) =>
    toolCallView({ tool: "start_coding_agent", input, output: undefined }).subject;
  assert.deepEqual(
    [started({ prompt: "Fix the invite email." }), started({ task: "Fix the invite email." })],
    ["Fix the invite email.", "Fix the invite email."],
    "a start names its prompt, and one journaled before it had its name names its task",
  );
  const waited = toolCallView({ tool: "task_wait", input: {}, output: "1 task settled." });
  assert.equal(waited.kind, CALL_KIND.WORKER_WAIT);
  const stopped = toolCallView({
    tool: "task_cancel",
    input: { taskId: "delegate-7k2m9q" },
    output: "Stopped delegate-7k2m9q.",
  });
  assert.deepEqual([stopped.kind, stopped.subject], [CALL_KIND.WORKER_CANCEL, "delegate-7k2m9q"]);
});

test("a look at one of the plan's pictures says it looked and opens the plan, and one refused shows why and opens nothing", () => {
  const input = {
    address:
      "https://tryluke.dev/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b/files/9d2e4c61-7a3b-4f0e-8b1a-2c6d4e8f0a13",
  };
  const looked = { tool: "look_at_picture", callId: "call-1", input, output: { status: "looked" } };
  const refused = {
    ...looked,
    output: { status: "not-looked", reason: "Not looked: this task's plan holds no such picture." },
  };

  assert.equal(toolCallView(looked).kind, CALL_KIND.LOOK_AT_PICTURE);
  assert.deepEqual(toolTarget(looked), { kind: TOOL_TARGET.PLAN });
  const shown = toolCallView(refused).output;
  assert.equal(shown?.kind, TOOL_BLOCK.JSON);
  assert.ok(shown?.text.includes(refused.output.reason));
  assert.equal(toolTarget(refused), undefined);
});

test("an agent a call starts, reads, or messages opens its tab while it is on the call's own task, and nothing once its answer says it is on another, which this task's column has no tab for", () => {
  const agent = (onYourTask?: boolean) => ({
    id: "agent-2",
    ...(onYourTask === undefined ? undefined : { onYourTask }),
  });
  const call = (tool: string, onYourTask?: boolean) => ({
    tool,
    callId: "call-1",
    input: { agentId: "agent-2", text: "Rebase on main." },
    output: { status: "accepted", agent: agent(onYourTask) },
  });
  for (const tool of ["start_agent", "read_agent", "message_agent"]) {
    const opened = { kind: TOOL_TARGET.AGENT, agent: "agent-2" };
    assert.deepEqual(toolTarget(call(tool, true)), opened, tool);
    assert.deepEqual(toolTarget(call(tool)), opened, `${tool}, answered before the service said`);
    assert.equal(toolTarget(call(tool, false)), undefined, tool);
  }
});

test("an archive names the agent its answer titles and opens nothing, its tab being gone, and an unarchive opens the agent it brought back", () => {
  const call = (tool: string) => ({
    tool,
    callId: "call-1",
    input: { agentId: "agent-2", reason: "Its pull request merged." },
    output: {
      status: "accepted",
      agent: { id: "agent-2", title: "Bill by seat", onYourTask: true },
      archived: tool === "archive_agent",
      already: false,
    },
  });

  const archived = toolCallView(call("archive_agent"));
  assert.deepEqual([archived.kind, archived.subject], [CALL_KIND.ARCHIVE_AGENT, "Bill by seat"]);
  assert.equal(toolTarget(call("archive_agent")), undefined);
  const back = toolCallView(call("unarchive_agent"));
  assert.deepEqual([back.kind, back.subject], [CALL_KIND.UNARCHIVE_AGENT, "Bill by seat"]);
  assert.deepEqual(toolTarget(call("unarchive_agent")), {
    kind: TOOL_TARGET.AGENT,
    agent: "agent-2",
  });
});

test("a task's change says it archived, unarchived, or updated the task its answer names, by what it asked, and opens it, while one still out or refused names none and opens nothing", () => {
  const call = (input: WireRecord, output?: WireRecord) => ({
    tool: "update_task",
    callId: "call-1",
    input: { taskId: "task-2", ...input },
    output,
  });
  const answer = {
    status: "accepted",
    task: {
      id: "task-2",
      name: "Seat billing",
      mention: "[@Seat billing](https://tryluke.dev/acme/plan/task-2)",
    },
    already: false,
  };
  const opened = { kind: TOOL_TARGET.TASK, task: "task-2" };
  const line = (input: WireRecord, output?: WireRecord) => {
    const view = toolCallView(call(input, output));
    return [view.kind, callLine(view.kind, view.subject, undefined).verb, view.subject];
  };

  assert.deepEqual(line({ archived: true }, answer), [
    CALL_KIND.ARCHIVE_TASK,
    "Archived the task",
    "Seat billing",
  ]);
  assert.deepEqual(line({ archived: false }, answer), [
    CALL_KIND.UNARCHIVE_TASK,
    "Unarchived the task",
    "Seat billing",
  ]);
  assert.deepEqual(line({ name: "Seat billing", pinned: true }, answer), [
    CALL_KIND.UPDATE_TASK,
    "Updated the task",
    "Seat billing",
  ]);
  assert.deepEqual(toolTarget(call({ archived: true }, answer)), opened);

  assert.deepEqual(line({ archived: true }), [CALL_KIND.ARCHIVE_TASK, "Archived the task", ""]);
  assert.equal(toolTarget(call({ archived: true })), undefined);
  const refused = call({ archived: true }, { status: "rejected", reason: "Not archived." });
  assert.equal(toolCallView(refused).subject, "");
  assert.equal(toolTarget(refused), undefined);
});

test("a list of the models reads as one, not as a tool this build does not know, and opens nothing", () => {
  const call = {
    tool: "list_models",
    callId: "call-1",
    input: {},
    output: { status: "accepted", models: [], default: { model: "openai/gpt-6.1-sol" } },
  };

  assert.equal(toolCallView(call).kind, CALL_KIND.LIST_MODELS);
  assert.equal(toolTarget(call), undefined);
});

test("a stop names the agent its answer titles and opens that agent's tab, which stays; a refused stop opens nothing", () => {
  const asked = { tool: "stop_agent", callId: "call-1", input: { agentId: "agent-2" } };
  const stopped = {
    ...asked,
    output: {
      status: "accepted",
      agent: { id: "agent-2", title: "Bill by seat", onYourTask: true, status: "cancelled" },
      stopped: true,
    },
  };

  const view = toolCallView(stopped);
  assert.deepEqual([view.kind, view.subject], [CALL_KIND.STOP_AGENT, "Bill by seat"]);
  assert.deepEqual(toolTarget(stopped), { kind: TOOL_TARGET.AGENT, agent: "agent-2" });
  const refused = { ...asked, output: { status: "rejected", reason: "Not stopped." } };
  assert.equal(toolTarget(refused), undefined);
});

test("the section calls read as theirs, a made section by the title asked and a deleted one and a moved task by what the answer names, and open nothing", () => {
  const made = {
    tool: "create_section",
    callId: "call-1",
    input: { title: "Growth" },
    output: { status: "accepted", section: { id: "section-1", title: "Growth" } },
  };
  const deleted = {
    tool: "delete_section",
    callId: "call-2",
    input: { sectionId: "section-1" },
    output: {
      status: "accepted",
      section: { id: "section-1", title: "Growth" },
      tasksBackUnderTasks: 2,
    },
  };
  const moved = {
    tool: "move_task",
    callId: "call-3",
    input: { taskId: "task-1", sectionId: "section-2" },
    output: {
      status: "accepted",
      task: { id: "task-1", name: "Bill by seat" },
      section: { id: "section-2", title: "Billing" },
    },
  };

  const rows = [made, deleted, moved].map((call) => {
    const view = toolCallView(call);
    return [view.kind, view.subject, toolTarget(call)];
  });
  assert.deepEqual(rows, [
    [CALL_KIND.CREATE_SECTION, "Growth", undefined],
    [CALL_KIND.DELETE_SECTION, "Growth", undefined],
    [CALL_KIND.MOVE_TASK, "Bill by seat", undefined],
  ]);
  assert.equal(toolCallView({ ...moved, output: undefined }).subject, "");
});

test("a page read names the page its answer titles, and opens the page's tab only where it is on the call's own task", () => {
  const call = (isYourTask: boolean) => ({
    tool: "read_page",
    callId: "call-1",
    input: { pageId: "page-1" },
    output: { status: "accepted", page: { id: "page-1", title: "Seats by month", isYourTask } },
  });

  const view = toolCallView(call(true));
  assert.deepEqual([view.kind, view.subject], [CALL_KIND.READ_PAGE, "Seats by month"]);
  assert.deepEqual(toolTarget(call(true)), { kind: TOOL_TARGET.PAGE, page: "page-1" });
  assert.equal(toolTarget(call(false)), undefined);
});

test("a pause names how long it waits, and its answer how long it waited or that a message ended it early", () => {
  const paused = (seconds: number, output?: Record<string, number | boolean>) =>
    toolCallView({ tool: "sleep", input: { seconds }, output });
  assert.deepEqual(
    [paused(45), paused(300), paused(5_400), paused(3_600)].map((view) => [
      view.kind,
      view.subject,
    ]),
    [
      [CALL_KIND.SLEEP, "45 seconds"],
      [CALL_KIND.SLEEP, "5 minutes"],
      [CALL_KIND.SLEEP, "1 hour 30 minutes"],
      [CALL_KIND.SLEEP, "1 hour"],
    ],
  );
  assert.equal(paused(300).output, undefined, "a pause still under way has no answer yet");
  assert.deepEqual(paused(300, { waitedSeconds: 300 }).output, {
    kind: TOOL_BLOCK.TEXT,
    text: "Waited 5 minutes.",
  });
  assert.deepEqual(paused(300, { interrupted: true }).output, {
    kind: TOOL_BLOCK.TEXT,
    text: "Stopped early: a message arrived.",
  });
});

test("a post into the plan's own channel opens the plan's Chat tab, and a post elsewhere, a read, or a resolve opens nothing", () => {
  const target = (tool: string, input: Record<string, string | number>) =>
    toolTarget({ tool, callId: "call", input, output: { status: "accepted" } });
  assert.deepEqual(target("post_chat", { text: "hi" }), { kind: TOOL_TARGET.CHAT });
  assert.deepEqual(
    [
      target("post_chat", { text: "hi", to: "@sam" }),
      target("post_chat", { text: "hi", to: "#launch" }),
      target("post_chat", { text: "hi", replyTo: 4 }),
      target("read_chat", {}),
      target("read_chat", { channel: "@sam" }),
      target("resolve_ask", { key: "invite", reason: "Settled." }),
    ],
    [undefined, undefined, undefined, undefined, undefined, undefined],
  );
});
