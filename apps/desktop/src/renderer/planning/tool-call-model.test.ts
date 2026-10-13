import assert from "node:assert/strict";
import { test } from "vitest";
import { TOOL_BLOCK } from "../ai-elements/tool";
import { cardTitle, patchPaths, stripAnsi, toolCallView } from "./tool-call-model";
import { CALL_KIND } from "./turn-rows";

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

test("a command still running has its row and its command, and no answer yet", () => {
  const view = toolCallView({ tool: "bash", input: { command: "sleep 1" }, output: undefined });
  assert.equal(view.subject, "sleep 1");
  assert.equal(view.output, undefined);
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
  assert.equal(view.subject, "release-notes");
  assert.deepEqual(view.input, { kind: TOOL_BLOCK.TEXT, text: "release-notes" });
  assert.deepEqual(view.output, { kind: TOOL_BLOCK.TEXT, text: body });

  const loading = toolCallView({
    tool: "load_skill",
    input: { skill: "release-notes" },
    output: undefined,
  });
  assert.equal(loading.subject, "release-notes");
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
  assert.deepEqual(patchPaths(patchText), ["apps/web/a.ts", "apps/web/b.ts"]);

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

test("terminal escapes are taken out of words, colours and titles alike", () => {
  assert.equal(stripAnsi(`${ESCAPE}[1;31mred${ESCAPE}[0m plain`), "red plain");
  assert.equal(stripAnsi(`${ESCAPE}]0;title${String.fromCharCode(7)}after`), "after");
  assert.equal(stripAnsi("no escapes"), "no escapes");
});

test("a plan's card is titled by its first heading, or its first line of words", () => {
  assert.equal(cardTitle("# Teammate invitations\n\nInvite by email."), "Teammate invitations");
  assert.equal(cardTitle("\n\nInvite by email.\n# Later"), "Invite by email.");
  assert.equal(cardTitle("   "), "");
  assert.equal(cardTitle("```ts\nconst seats = plan.seats;\n```"), "const seats = plan.seats;");
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
  ];
  const view = toolCallView({
    tool: "edit_plan",
    input: { notes },
    output: { status: "accepted", taken: 3, missed: [] },
  });
  assert.equal(view.kind, CALL_KIND.EDIT_PLAN);
  assert.equal(view.subject, "2 added, 1 corrected");
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
    text: "Both work.\nThe PR: https://github.com/acme/relay/pull/7\nsrc/queue.ts:12-20 at 0123456\nImage: The queue dashboard (shots/queue.png)\n- Postgres (recommended) -- One database.\n- Redis",
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

test("a call its wire already read is drawn as the wire said it: its kind, subject, and purpose, a command behind its prompt, other input as it came, and its answer as it came", () => {
  const command = toolCallView({
    tool: "run_in_repository",
    input: { command: "ls src", description: "List the sources" },
    output: "queue.ts",
    said: { kind: CALL_KIND.COMMAND, subject: "ls src", description: "List the sources" },
  });
  assert.deepEqual(command, {
    kind: CALL_KIND.COMMAND,
    subject: "ls src",
    description: "List the sources",
    input: { kind: TOOL_BLOCK.COMMAND, text: "ls src" },
    output: { kind: TOOL_BLOCK.TEXT, text: "queue.ts" },
  });
  // A tool a coding agent also has is still drawn as said, not read again from its input.
  const question = toolCallView({
    tool: "bash",
    input: { question: "Who can invite?" },
    output: { status: "queued" },
    said: { kind: CALL_KIND.QUEUE_QUESTION, subject: "Who can invite?" },
  });
  assert.equal(question.kind, CALL_KIND.QUEUE_QUESTION);
  assert.equal(question.subject, "Who can invite?");
  assert.deepEqual(question.input, {
    kind: TOOL_BLOCK.JSON,
    text: JSON.stringify({ question: "Who can invite?" }, null, 2),
  });
  assert.deepEqual(question.output, {
    kind: TOOL_BLOCK.JSON,
    text: JSON.stringify({ status: "queued" }, null, 2),
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
