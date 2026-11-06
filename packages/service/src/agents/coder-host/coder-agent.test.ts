import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SHARED_FILES_DIRECTORY } from "@repo/agent-runner/pins";
import {
  AGENT_BRIEF,
  AGENT_KIND,
  type AgentBrief,
  type AgentKind,
} from "@repo/features/agent-wire";
import { Schema } from "effect";
import { test } from "vitest";
import { COMMIT_BY } from "./checkout.js";
import { INBOX_TOOLS } from "./inbox.js";
import { CODER_HARNESS, coderInstructions, type OwnTask } from "./instructions.js";
import { CODER_TOOL } from "./tool-set.js";

const TASK_ADDRESS = {
  link: "https://vespin.dev/acme/task/42",
  id: "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f",
} as const;

test("a Claude Code agent is told of Claude Code's own tools and never of Vespin's it is not offered", () => {
  const LUKES = [
    "`bash`",
    "`read_file`",
    "`write_file`",
    "`apply_patch`",
    "`glob`",
    "`grep`",
    `\`${CODER_TOOL.SLEEP}\``,
    `\`${CODER_TOOL.WEB_SEARCH}\``,
    `\`${CODER_TOOL.READ_WEB_PAGE}\``,
    `\`${CODER_TOOL.LOAD_SKILL}\``,
    "`write_todos`",
    "`delegate`",
    "task_wait",
  ];
  const CLAUDE_CODES = ["TaskCreate", "WebSearch", "WebFetch", "Skill tool", "Agent tool"];
  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const repository of ["Acme/Relay", null]) {
      for (const memberToken of [false, true]) {
        const args = [repository, brief, true, TASK_ADDRESS, undefined, null, memberToken] as const;
        const claudeCode = coderInstructions(...args, CODER_HARNESS.CLAUDE_CODE);
        const label = `${brief} ${repository ?? "no repository"} ${memberToken ? "token" : "app"}`;
        assert.deepEqual(
          LUKES.filter((tool) => claudeCode.includes(tool)),
          [],
          label,
        );
        assert.deepEqual(
          CLAUDE_CODES.filter(
            (tool) => !claudeCode.includes(tool) && (repository !== null || tool !== "Skill tool"),
          ),
          [],
          label,
        );
        for (const kept of [INBOX_TOOLS.POST.name, CODER_TOOL.START_AGENT, CODER_TOOL.SHOW_IMAGE]) {
          assert.ok(claudeCode.includes(`\`${kept}\``), `${label}: ${kept}`);
        }
      }
    }
    const watching = coderInstructions(
      "Acme/Relay",
      brief,
      true,
      TASK_ADDRESS,
      undefined,
      null,
      false,
      CODER_HARNESS.CLAUDE_CODE,
    );
    assert.ok(watching.includes("wait with ScheduleWakeup"), brief);
  }
});

test("a Claude Code or Codex agent is told of its browser, which Vespin's MCP server serves it, with Playwright run from its own shell", () => {
  const BROWSER = `\`${CODER_TOOL.BROWSER}\` drives a real browser, a Chromium in your own sandbox`;
  const SHELL_OF = [
    [CODER_HARNESS.CLAUDE_CODE, "on Playwright from Bash,"],
    [CODER_HARNESS.CODEX, "on Playwright from your shell,"],
  ] as const;
  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const repository of ["Acme/Relay", null]) {
      for (const [harness, shell] of SHELL_OF) {
        const words = coderInstructions(
          repository,
          brief,
          true,
          TASK_ADDRESS,
          undefined,
          null,
          false,
          harness,
        );
        const label = `${harness} ${brief} ${repository ?? "no repository"}`;
        assert.ok(words.includes("## Your browser"), label);
        assert.ok(words.includes(BROWSER), label);
        assert.ok(words.includes(shell), label);
      }
    }
  }
});

test("a local agent is told its folders on its machine, and no browser", () => {
  const MAC = {
    local: true,
    checkoutPath: "/Users/dev/.vespin/agents/a1/repository",
    installedSkills: "/Users/dev/.vespin/agents/a1/installed-skills",
    sharedFiles: "/Users/dev/.vespin/agents/a1/tmp",
  };
  for (const repository of ["Acme/Relay", null]) {
    for (const harness of [CODER_HARNESS.CLAUDE_CODE, CODER_HARNESS.CODEX]) {
      const words = coderInstructions(
        repository,
        AGENT_BRIEF.PROMPT,
        true,
        TASK_ADDRESS,
        undefined,
        null,
        false,
        harness,
        undefined,
        false,
        MAC,
      );
      const label = `${harness} ${repository ?? "no repository"}`;
      assert.ok(!words.includes("## Your browser"), label);
      if (repository !== null) assert.ok(words.includes(`\`${MAC.checkoutPath}\``), label);
    }
  }
  const codex = coderInstructions(
    "Acme/Relay",
    AGENT_BRIEF.PROMPT,
    true,
    TASK_ADDRESS,
    undefined,
    null,
    false,
    CODER_HARNESS.CODEX,
    undefined,
    false,
    MAC,
  );
  assert.ok(codex.includes(`\`${MAC.installedSkills}/`));
});

test("a local agent is told it runs straight on its machine with full access to it, how to work a branch its machine's clone holds, and to save pages where its machine reads them", () => {
  const HOST = {
    local: true,
    checkoutPath: "/home/vespin-host/.vespin/agents/a1/repository",
    installedSkills: "/home/vespin-host/.vespin/agents/a1/installed-skills",
    sharedFiles: "/home/vespin-host/.vespin/agents/a1/tmp",
  };
  const told = ["straight on one of the developer's own machines", "full access"];
  const toldWithRepository = [
    "`git switch --detach origin/<branch>`",
    "`git push origin HEAD:<branch>`",
  ];
  for (const repository of ["Acme/Relay", null]) {
    const words = coderInstructions(
      repository,
      AGENT_BRIEF.PROMPT,
      true,
      TASK_ADDRESS,
      undefined,
      null,
      false,
      CODER_HARNESS.CLAUDE_CODE,
      undefined,
      false,
      HOST,
    );
    const label = repository ?? "no repository";
    for (const each of told) assert.ok(words.includes(each), `${label}: ${each}`);
    assert.ok(!words.includes("## Your browser"), label);
    if (repository !== null) assert.ok(words.includes(`\`${HOST.checkoutPath}\``), label);
    for (const each of toldWithRepository) {
      assert.equal(words.includes(each), repository !== null, `${label}: ${each}`);
    }
    assert.ok(words.includes(`under \`${HOST.sharedFiles}/\``), label);
    assert.ok(!words.includes(SHARED_FILES_DIRECTORY), label);
  }
});

test("a Codex agent is told of Codex's own tools and never of Vespin's it is not offered, nor of Claude Code's", () => {
  const LUKES = [
    "`bash`",
    "`read_file`",
    "`write_file`",
    "`glob`",
    "`grep`",
    `\`${CODER_TOOL.SLEEP}\``,
    `\`${CODER_TOOL.WEB_SEARCH}\``,
    `\`${CODER_TOOL.READ_WEB_PAGE}\``,
    `\`${CODER_TOOL.LOAD_SKILL}\``,
    "`write_todos`",
    "`delegate`",
    "task_wait",
  ];
  const CLAUDE_CODES = ["TaskCreate", "WebSearch", "WebFetch", "Skill tool", "Agent tool", "Bash"];
  const CODEXES = [
    "`apply_patch`",
    "`update_plan`",
    "Codex's own web search",
    "Codex's own subagents",
  ];
  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const repository of ["Acme/Relay", null]) {
      for (const memberToken of [false, true]) {
        const codex = coderInstructions(
          repository,
          brief,
          true,
          TASK_ADDRESS,
          undefined,
          null,
          memberToken,
          CODER_HARNESS.CODEX,
        );
        const label = `${brief} ${repository ?? "no repository"} ${memberToken ? "token" : "app"}`;
        assert.deepEqual(
          LUKES.filter((tool) => codex.includes(tool)),
          [],
          label,
        );
        assert.deepEqual(
          CLAUDE_CODES.filter((tool) => codex.includes(tool)),
          [],
          label,
        );
        assert.deepEqual(
          CODEXES.filter((tool) => !codex.includes(tool)),
          [],
          label,
        );
        assert.equal(codex.includes("`.agents/skills`"), repository !== null, label);
        for (const kept of [INBOX_TOOLS.POST.name, CODER_TOOL.START_AGENT, CODER_TOOL.SHOW_IMAGE]) {
          assert.ok(codex.includes(`\`${kept}\``), `${label}: ${kept}`);
        }
      }
    }
    const watching = coderInstructions(
      "Acme/Relay",
      brief,
      true,
      TASK_ADDRESS,
      undefined,
      null,
      false,
      CODER_HARNESS.CODEX,
    );
    assert.ok(watching.includes("gh pr checks <number> --watch --fail-fast"), brief);
  }
});

test("an agent on a task is told of the task's links, pages, and comments, and one an automation started with no task of its own pages alone", () => {
  const TASK_LINK = "`https://vespin.dev/<workspace>/task/<number>` link, or one by the task's id";
  const PAGES = `show it with \`${CODER_TOOL.SHOW_PAGE}\``;
  const COMMENTS = `answer in that thread with \`${CODER_TOOL.REPLY_TO_COMMENT}\``;
  for (const brief of Object.values(AGENT_BRIEF)) {
    const onTask = coderInstructions("Acme/Relay", brief, true, TASK_ADDRESS);
    const taskless = coderInstructions("Acme/Relay", brief, true, null);
    const told = (words: string) => [
      words.includes(TASK_LINK),
      words.includes(PAGES),
      words.includes(COMMENTS),
    ];
    assert.deepEqual(told(onTask), [true, true, true], brief);
    assert.deepEqual(told(taskless), [false, true, false], brief);
    assert.ok(taskless.includes("## Threads"), "a planless agent keeps its threads");
    assert.ok(!taskless.includes("luke://plan/"), "nor an older message's plan link");
  }
});

test("an agent on a task starts the agents that help with it on its own task, and one an automation started with no task, which has none, starts them on a task made for each", () => {
  const OWN_TASK = "Start it on your own task";
  const NO_TASK =
    "You work on no task, so leave its taskId out to start it on a new task made for it";
  for (const brief of Object.values(AGENT_BRIEF)) {
    const onTask = coderInstructions("Acme/Relay", brief, true, TASK_ADDRESS);
    const taskless = coderInstructions("Acme/Relay", brief, true, null);
    assert.deepEqual([onTask.includes(OWN_TASK), onTask.includes(NO_TASK)], [true, false], brief);
    assert.deepEqual(
      [taskless.includes(OWN_TASK), taskless.includes(NO_TASK)],
      [false, true],
      brief,
    );
  }
});

test("every agent on a task is told how to update its description, one handed a prompt told to read it first, and one on no task told of no description", () => {
  const UPDATING = "## Updating the description";
  const READ_FIRST = `Read it with \`${CODER_TOOL.READ_TASK}\``;
  const told = (brief: AgentBrief, task: OwnTask | null) => {
    const words = coderInstructions("Acme/Relay", brief, true, task);
    return [
      words.includes(UPDATING),
      words.includes(CODER_TOOL.EDIT_DESCRIPTION),
      words.includes(READ_FIRST),
    ];
  };
  assert.deepEqual(told(AGENT_BRIEF.DESCRIPTION, TASK_ADDRESS), [true, true, false]);
  assert.deepEqual(told(AGENT_BRIEF.PROMPT, TASK_ADDRESS), [true, true, true]);
  assert.deepEqual(told(AGENT_BRIEF.PROMPT, null), [false, false, false]);
});

test("an agent on a task with no repository names what it decided in its message, never in a pull request's description, which it opens none of", () => {
  const IN_PULL_REQUEST = "pull request's description";
  const decided = (repository: string | null, kind: AgentKind) =>
    coderInstructions(
      repository,
      AGENT_BRIEF.DESCRIPTION,
      true,
      TASK_ADDRESS,
      undefined,
      null,
      false,
      CODER_HARNESS.CLAUDE_CODE,
      kind,
    ).includes(IN_PULL_REQUEST);
  for (const kind of [AGENT_KIND.CODER, AGENT_KIND.PILOT]) {
    assert.deepEqual([decided("Acme/Relay", kind), decided(null, kind)], [true, false], kind);
  }
});

test("every agent on a task is told to keep its task's status with update_task, moving it back to in progress and on to done, a helper on its starter's task leaving it to the starter and one on a task of its own keeping that one's, and one on no task told of no status", () => {
  const STATUS = "## Your task's status";
  const told = (brief: AgentBrief, task: OwnTask | null) => {
    const words = coderInstructions("Acme/Relay", brief, true, task);
    const at = words.indexOf(STATUS);
    if (at === -1) return [false, false, false, false, false];
    const section = words.slice(at, words.indexOf("\n\n## ", at + STATUS.length));
    return [
      true,
      section.includes(CODER_TOOL.UPDATE_TASK),
      section.includes("Mark it done"),
      section.includes(
        "Where another agent started you on its task, leave the status to that agent",
      ),
      section.includes("one started on a task of its own keeps that status itself"),
    ];
  };
  for (const brief of Object.values(AGENT_BRIEF)) {
    assert.deepEqual(told(brief, TASK_ADDRESS), [true, true, true, true, true], brief);
    assert.deepEqual(told(brief, null), [false, false, false, false, false], brief);
  }
});

test("an agent asked for a plan, a proposal, or research opens no pull request of a document, and writes it where it can: the description, or a page, on its task or on itself", () => {
  const NO_DOCUMENT = "never commit the write-up as a document";
  const PLAN = `write it into the description with \`${CODER_TOOL.EDIT_DESCRIPTION}\``;
  const PAGE = `show it as a page with \`${CODER_TOOL.SHOW_PAGE}\``;
  const told = (brief: AgentBrief, task: OwnTask | null) => {
    const words = coderInstructions("Acme/Relay", brief, true, task);
    assert.ok(words.includes(NO_DOCUMENT), brief);
    return [words.includes(PLAN), words.includes(PAGE)];
  };
  assert.deepEqual(told(AGENT_BRIEF.DESCRIPTION, TASK_ADDRESS), [true, true]);
  assert.deepEqual(told(AGENT_BRIEF.PROMPT, TASK_ADDRESS), [false, true]);
  assert.deepEqual(told(AGENT_BRIEF.PROMPT, null), [false, true]);
});

test("the thread post tool tells the session never to ask for a credential or a secret in a form, since the answer reaches the transcript", () => {
  assert.ok(
    INBOX_TOOLS.POST.description.includes("never ask for a credential or a secret in a form"),
  );
});

test("the session sends whatever is ready for the developer to look at or review to a thread, a pull request among it, and a test only the developer can run, and an agent another coding agent started may message that agent before its report", () => {
  const READY = "ready for them to look at or review";
  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const task of [TASK_ADDRESS, null]) {
      const inbox = coderInstructions("Acme/Relay", brief, true, task).split("## Threads")[1];
      assert.ok(inbox?.includes(READY), brief);
      assert.ok(inbox?.includes("a pull request you opened or marked ready"), brief);
      assert.ok(inbox?.includes("needs to test something by hand"), brief);
      assert.ok(
        inbox?.includes(
          "Where another agent started you, as your first message says, your final message reaches it by itself as your report",
        ),
        brief,
      );
    }
  }
});

test("an agent is told whose its commits are and to end each on the trailer it is handed, never to add one where it is handed none, and to open a pull request through the service, never gh", () => {
  const BOT_TRAILER = "Co-authored-by: luke[bot] <90001+luke[bot]@users.noreply.github.com>";
  const DEVELOPER_TRAILER = "Co-authored-by: Ada Lovelace <7001+ada@users.noreply.github.com>";
  const cases = [
    {
      by: COMMIT_BY.DEVELOPER,
      coAuthor: BOT_TRAILER,
      says: "set to the developer's own GitHub account",
    },
    {
      by: COMMIT_BY.DEVELOPER,
      coAuthor: undefined,
      says: "set to the developer's own GitHub account",
    },
    { by: COMMIT_BY.APP, coAuthor: DEVELOPER_TRAILER, says: "set to its bot" },
    { by: COMMIT_BY.APP, coAuthor: undefined, says: "set to its bot" },
  ] as const;
  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const authorship of cases) {
      const words = coderInstructions("Acme/Relay", brief, true, TASK_ADDRESS, authorship);
      const named = `${brief}, ${authorship.by}, ${authorship.coAuthor ?? "no co-author"}`;
      assert.ok(words.includes(authorship.says), named);
      assert.equal(
        words.includes("The service opens your pull request as the developer too."),
        authorship.by === COMMIT_BY.DEVELOPER,
        named,
      );
      if (authorship.coAuthor === undefined) {
        assert.ok(words.includes("add a `Co-authored-by` trailer"), named);
        assert.ok(!words.includes("exactly as written: `Co-authored-by"), named);
      } else {
        assert.ok(words.includes(`exactly as written: \`${authorship.coAuthor}\``), named);
        assert.ok(!words.includes("add a `Co-authored-by` trailer"), named);
      }
      assert.ok(
        words.includes(
          `open the pull request with \`${CODER_TOOL.OPEN_PULL_REQUEST}\`, never \`gh pr create\``,
        ),
        named,
      );
    }
  }
});

test("an agent on its starter's own token reads its checks and its pull request over GitHub's REST API under its repository, never gh pr, and is told a draft cannot be marked ready from its sandbox", () => {
  const TRAILER = "Co-authored-by: luke[bot] <90001+luke[bot]@users.noreply.github.com>";
  for (const brief of Object.values(AGENT_BRIEF)) {
    const words = (memberToken: boolean) =>
      coderInstructions(
        "Acme/Relay",
        brief,
        true,
        TASK_ADDRESS,
        { by: COMMIT_BY.DEVELOPER, coAuthor: TRAILER },
        null,
        memberToken,
      );
    const onToken = words(true);
    for (const cli of ["`gh pr checks", "`gh run view", "marking a draft ready"]) {
      assert.ok(!onToken.includes(cli), `${brief}: ${cli}`);
      assert.ok(words(false).includes(cli), `${brief}: ${cli}`);
    }
    assert.ok(onToken.includes("`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`"), brief);
    assert.ok(onToken.includes("`gh api repos/{owner}/{repo}/pulls/<number>/reviews`"), brief);
    assert.ok(onToken.includes("A draft cannot be marked ready from here"), brief);
  }
});

test("every agent is told that what happens on its pull request after its turn reaches it from GitHub, and to read its reviews before it ends a turn", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const ciReadable of [true, false]) {
      const instructions = coderInstructions("Acme/Relay", brief, ciReadable, TASK_ADDRESS);
      assert.ok(instructions.includes("reaches you as a message from GitHub"), brief);
      assert.ok(instructions.includes("before you end a turn on an open pull request"), brief);
    }
  }
});

test("every agent is told to reply on an inbox thread to a question or a request done there, never in its own message alone, and never to post how the work is going", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const onTask of [true, false]) {
      const instructions = coderInstructions(
        "Acme/Relay",
        brief,
        true,
        onTask ? TASK_ADDRESS : null,
      );
      assert.ok(
        instructions.includes(
          `reply on that thread with \`${INBOX_TOOLS.POST.name}\` under its key`,
        ),
        brief,
      );
      assert.ok(instructions.includes("never answer them in your message alone"), brief);
      assert.ok(
        instructions.includes("once a request is done, say in a line or two what you did"),
        brief,
      );
      assert.ok(
        instructions.includes("Never post on a thread to say how the work is going"),
        brief,
      );
      assert.ok(!instructions.includes("saying what you did with it"), brief);
    }
  }
});

test("every agent is told to look at a UI it built in the image's Chromium and show the developer what it saw", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const onTask of [true, false]) {
      const instructions = coderInstructions(
        "Acme/Relay",
        brief,
        true,
        onTask ? TASK_ADDRESS : null,
      );
      assert.ok(instructions.includes("playwright screenshot"), brief);
      assert.ok(
        instructions.includes('NODE_PATH="/usr/local/lib/node_modules:$(npm root -g)"'),
        brief,
      );
      assert.ok(instructions.includes(`with \`${CODER_TOOL.SHOW_IMAGE}\``), brief);
    }
  }
});

const TASK_LINK = {
  link: "https://vespin.dev/acme/task/42",
  id: "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f",
} as const;

const CODER_PATH = fileURLToPath(
  new URL("../../../fixtures/coder-instructions/coder.json", import.meta.url),
);

function briefInstructions(): Record<string, { onTask: string; taskless: string }> {
  return Object.fromEntries(
    Object.values(AGENT_BRIEF).map((brief) => [
      brief,
      {
        onTask: coderInstructions("Acme/Relay", brief, true, TASK_LINK),
        taskless: coderInstructions("Acme/Relay", brief, false, null),
      },
    ]),
  );
}

if (process.env.APP_UPDATE_FIXTURES === "1") {
  writeFileSync(CODER_PATH, `${JSON.stringify(briefInstructions(), null, 2)}\n`);
}

const CODER_GOLDEN = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Struct({ onTask: Schema.String, taskless: Schema.String })),
)(JSON.parse(readFileSync(CODER_PATH, "utf8")));

test("a coding agent's instructions are the golden's, byte for byte, for each brief on a task and on none", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    const recorded = CODER_GOLDEN[brief];
    assert.ok(recorded, brief);
    assert.equal(coderInstructions("Acme/Relay", brief, true, TASK_LINK), recorded.onTask, brief);
    assert.equal(coderInstructions("Acme/Relay", brief, false, null), recorded.taskless, brief);
  }
});

test("with Memory off the instructions say nothing of the workspace's memory; with it on they add its section before the one on messages, and nothing else", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    const off = coderInstructions("Acme/Relay", brief, true, TASK_LINK);
    const on = coderInstructions(
      "Acme/Relay",
      brief,
      true,
      TASK_LINK,
      undefined,
      null,
      false,
      CODER_HARNESS.CLAUDE_CODE,
      AGENT_KIND.CODER,
      true,
    );
    assert.ok(!off.includes("## The workspace's memory"), brief);
    assert.ok(!off.includes(`\`${CODER_TOOL.SAVE_MEMORY}\``), brief);
    const start = on.indexOf("## The workspace's memory\n\n");
    const end = on.indexOf("## What your messages are", start);
    assert.ok(start > 0 && end > start, brief);
    assert.ok(on.slice(start, end).includes(`\`${CODER_TOOL.SEARCH_MEMORY}\``), brief);
    assert.equal(on.slice(0, start) + on.slice(end), off, brief);
  }
});

test("with Task descriptions off the instructions say nothing of a description: no edit_description, no description handed with a task's link or read_task, no description to name or write a write-up into, and comments on pages alone", () => {
  const DESCRIPTION_WORDS = [
    `\`${CODER_TOOL.EDIT_DESCRIPTION}\``,
    "## Updating the description",
    "take that decision into the description",
    "write it into the description",
    "what its description said when the message was sent",
    "its description included",
    "Your task's description, whose link is",
    "Keep a mention in the description",
    "comment threads on a description's text",
  ];
  for (const brief of Object.values(AGENT_BRIEF)) {
    const told = (descriptionsOn: boolean) =>
      coderInstructions(
        "Acme/Relay",
        brief,
        true,
        TASK_LINK,
        undefined,
        null,
        false,
        CODER_HARNESS.CLAUDE_CODE,
        AGENT_KIND.CODER,
        false,
        undefined,
        [],
        descriptionsOn,
      );
    const on = told(true);
    const off = told(false);
    assert.equal(on, coderInstructions("Acme/Relay", brief, true, TASK_LINK), brief);
    assert.deepEqual(
      DESCRIPTION_WORDS.filter((words) => off.includes(words)),
      [],
      brief,
    );
    const comments = off.slice(off.indexOf("## Comments"), off.indexOf("## Handing work"));
    assert.ok(comments.includes(`\`${CODER_TOOL.REPLY_TO_COMMENT}\``), brief);
    assert.ok(off.includes(`show it as a page with \`${CODER_TOOL.SHOW_PAGE}\``), brief);
  }
  const planned = coderInstructions("Acme/Relay", AGENT_BRIEF.DESCRIPTION, true, TASK_LINK);
  assert.deepEqual(
    DESCRIPTION_WORDS.filter((words) => !planned.includes(words)),
    [],
  );
});

const PILOT_PATH = fileURLToPath(
  new URL("../../../fixtures/coder-instructions/pilot.json", import.meta.url),
);

function pilotInstructions(): string {
  return coderInstructions(
    "Acme/Relay",
    AGENT_BRIEF.PROMPT,
    true,
    TASK_LINK,
    undefined,
    null,
    false,
    CODER_HARNESS.CLAUDE_CODE,
    AGENT_KIND.PILOT,
  );
}

if (process.env.APP_UPDATE_FIXTURES === "1") {
  writeFileSync(PILOT_PATH, `${JSON.stringify({ pilot: pilotInstructions() }, null, 2)}\n`);
}

const PILOT_GOLDEN = Schema.decodeUnknownSync(Schema.Struct({ pilot: Schema.String }))(
  JSON.parse(readFileSync(PILOT_PATH, "utf8")),
);

test("a pilot's instructions are the golden's, byte for byte: its own job in place of a coder's, and a coder's publishing only for a task too small to split", () => {
  const pilot = pilotInstructions();
  assert.equal(pilot, PILOT_GOLDEN.pilot);
  assert.ok(pilot.includes("Too small to split; I'll do it myself"));
  assert.ok(pilot.includes("## Doing a task yourself"));
  assert.ok(!pilot.includes("makes a task of its own, for the developer"));
});
