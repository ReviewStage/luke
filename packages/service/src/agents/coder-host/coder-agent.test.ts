import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_KIND,
  type CodingAgentBrief,
  type CodingAgentKind,
} from "@luke/features/coding-agent-wire";
import { Duration, Redacted, Schema } from "effect";
import { routeAuth } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { serializeModelInputSchema } from "eve/tools";
import { test } from "vitest";
import { AGENT_ROLE } from "../agent-runtime/role.js";
import { toolsOf } from "../agent-runtime/tools.js";
import { lukeAccount } from "../brain-host/auth.js";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_AUTHENTICATOR,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_PRINCIPAL_TYPE,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
} from "../brain-host/bounds.js";
import { BRAIN_HOST_TURN_POLICY } from "../brain-host/channel.js";
import { CODER } from "./bounds.js";
import {
  CODER_DEPLOYMENT_PRESENCE,
  CODER_DEPLOYMENT_STREAMS,
  CODER_DEPLOYMENT_TURNS,
  coderChannelInput,
} from "./channel.js";
import { INBOX_TOOLS } from "./inbox.js";
import { CODER_HARNESS, coderInstructions } from "./instructions.js";
import { SLEEP_TOOL } from "./sleep.js";
import { CODER_TOOL, taskToolsOf } from "./tool-set.js";

/** The link of the task an agent on one works on, as its instructions are handed it. */
const TASK_ADDRESS = "https://tryluke.dev/acme/plan/pl_1";

const SECRET = "eve-deployment-secret-1";
const ACCOUNT = "user-a";
const CONVERSATION = "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";
const OWN_SESSION = "wrun_01SESSIONOFACCOUNTA0000000";
const OTHER_SESSION = "wrun_01SESSIONOFACCOUNTB0000000";

/** What the door answered: the principal it admitted, or the word it refused with. */
type DoorAnswer =
  | { readonly admitted: SessionAuthContext; readonly refused?: undefined }
  | { readonly refused: string; readonly admitted?: undefined };

/** The deployment's request on an agent's session under its secret, naming the account, the conversation, and the kind of turn given. */
function deploymentRequest(sessionId: string, turn: string | undefined, method = "POST"): Request {
  return new Request(`https://luke.test/eve/v1/session/${sessionId}`, {
    method,
    headers: {
      authorization: `Bearer ${SECRET}`,
      [BRAIN_HOST_HEADER.ACCOUNT]: ACCOUNT,
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
      ...(turn === undefined ? undefined : { [BRAIN_HOST_HEADER.TURN]: turn }),
    },
  });
}

/** The deployment's opening of an agent's session under its secret, naming the account, the conversation, and the kind of turn given. */
function deploymentOpening(turn: string): Request {
  return new Request("https://luke.test/eve/v1/session", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      [BRAIN_HOST_HEADER.ACCOUNT]: ACCOUNT,
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
      [BRAIN_HOST_HEADER.TURN]: turn,
    },
  });
}

/** The coder channel over a store in which the account reaches its own session and conversation alone. */
function coderChannel() {
  return coderChannelInput(
    async () => undefined,
    {
      reachesSession: async (userId, sessionId) => userId === ACCOUNT && sessionId === OWN_SESSION,
      reachesConversation: async (userId, conversationId) =>
        userId === ACCOUNT && conversationId === CONVERSATION,
    },
    {
      secret: Redacted.make(SECRET),
      admits: CODER_DEPLOYMENT_TURNS,
      presents: CODER_DEPLOYMENT_PRESENCE,
      streams: CODER_DEPLOYMENT_STREAMS,
    },
    async () => undefined,
  );
}

/** The developer's own principal as the deployment carries it, as a spoken ask, a stream read, a cancel, or a retire is admitted under. */
function asCarriedAccount(admitted: SessionAuthContext | undefined) {
  assert.ok(admitted);
  return [
    admitted.authenticator,
    admitted.principalType,
    admitted.principalId,
    admitted.attributes[BRAIN_HOST_ATTRIBUTE.CARRIER],
  ];
}

const CARRIED_ACCOUNT = [
  BRAIN_HOST_AUTHENTICATOR.ACCOUNT,
  BRAIN_HOST_PRINCIPAL_TYPE.ACCOUNT,
  ACCOUNT,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
];

/** The channel's door as a request meets it: the principal admitted, or the word refused with. */
function doorOf(channel: ReturnType<typeof coderChannelInput>) {
  return async (request: Request): Promise<DoorAnswer> => {
    const answer = await routeAuth(request, channel.auth);
    if (!(answer instanceof Response)) return { admitted: answer };
    // SAFETY: eve's own refusal body, whose `error` field is the word the door threw.
    const refusal = (await answer.json()) as { error: string };
    return { refused: refusal.error };
  };
}

test("a follow-up steers the turn under way; the deployment's typed line on the named account's own agent session, its typed opening of the account's own conversation, its spoken ask, opening or following up, and its read of the session's stream are all minted as the developer's own principal, authenticator, type, and id, which is what eve steers the running turn on, with the deployment named as its carrier, so a call's ask joins the agent's typed turn under way; another account's session is refused", async () => {
  const channel = coderChannel();
  assert.equal(channel.turnPolicy, BRAIN_HOST_TURN_POLICY.STEER);
  const door = doorOf(channel);

  // The developer's own follow-up on the same session, as the agent's turn runs under it.
  const developer = await lukeAccount(async () => ACCOUNT)(
    new Request(`https://luke.test/eve/v1/session/${OWN_SESSION}`, {
      method: "POST",
      headers: {
        authorization: "Bearer developer-token",
        [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
        [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
      },
    }),
  );
  const { admitted: carried } = await door(deploymentRequest(OWN_SESSION, BRAIN_HOST_TURN.TYPED));
  assert.ok(developer);
  assert.ok(carried);
  assert.deepEqual(
    [carried.authenticator, carried.principalType, carried.principalId],
    [developer.authenticator, developer.principalType, developer.principalId],
  );
  assert.deepEqual(carried.attributes, {
    ...developer.attributes,
    [BRAIN_HOST_ATTRIBUTE.CARRIER]: BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  });

  // The start of an agent: the deployment opens the account's own conversation as the developer too.
  const { admitted: opened } = await door(deploymentOpening(BRAIN_HOST_TURN.TYPED));
  assert.ok(opened);
  assert.deepEqual(
    [opened.authenticator, opened.principalType, opened.principalId, opened.attributes],
    [developer.authenticator, developer.principalType, developer.principalId, carried.attributes],
  );

  // A call speaking into the agent: the voice's asks, presented as the developer, so eve steers
  // each into a typed turn under way rather than holding it behind that turn.
  const spoken = await door(deploymentRequest(OWN_SESSION, BRAIN_HOST_TURN.SPOKEN));
  assert.deepEqual(asCarriedAccount(spoken.admitted), CARRIED_ACCOUNT);
  assert.equal(spoken.admitted?.attributes[BRAIN_HOST_ATTRIBUTE.TURN], BRAIN_HOST_TURN.SPOKEN);
  const spokenOpening = await door(deploymentOpening(BRAIN_HOST_TURN.SPOKEN));
  assert.deepEqual(asCarriedAccount(spokenOpening.admitted), CARRIED_ACCOUNT);
  const stream = await door(
    deploymentRequest(`${OWN_SESSION}/stream`, BRAIN_HOST_TURN.SPOKEN, "GET"),
  );
  assert.deepEqual(asCarriedAccount(stream.admitted), CARRIED_ACCOUNT);
  assert.deepEqual(await door(deploymentRequest(OTHER_SESSION, BRAIN_HOST_TURN.TYPED)), {
    refused: BRAIN_HOST_REFUSAL.NOT_OWNER,
  });
  assert.deepEqual(
    await door(deploymentRequest(`${OTHER_SESSION}/stream`, BRAIN_HOST_TURN.SPOKEN, "GET")),
    { refused: BRAIN_HOST_REFUSAL.NOT_OWNER },
  );
});

test("a call's spoken line carries ahead of it into the agent's history the note that its answer is heard, short, and never waits, since eve may steer it into a typed turn under way that keeps that turn's words; a typed line carries none", async () => {
  const channel = coderChannel();
  const { onMessage } = channel;
  assert.ok(onMessage !== undefined);
  const door = doorOf(channel);
  const contextOf = async (turn: string) => {
    const request = deploymentRequest(OWN_SESSION, turn);
    const { admitted } = await door(request);
    assert.ok(admitted);
    const result = await onMessage({ eve: { caller: admitted, request } }, "words");
    assert.equal(result.auth?.attributes[BRAIN_HOST_ATTRIBUTE.TURN], turn);
    return result.context;
  };

  const spoken = await contextOf(BRAIN_HOST_TURN.SPOKEN);
  assert.equal(spoken?.length, 1);
  const [note] = spoken ?? [];
  assert.ok(note !== undefined);
  assert.ok(note.includes("voice call") && note.includes("aloud"), note);
  assert.ok(note.includes(`\`${CODER_TOOL.SLEEP}\``), note);
  assert.equal(await contextOf(BRAIN_HOST_TURN.TYPED), undefined);
});

test("the deployment's cancel of a turn, which a continue started through start_agent stops its source with, is admitted on the named account's own session as the developer's own principal, with no row of the table, and refused on a session the account does not reach", async () => {
  const door = doorOf(coderChannel());
  const cancel = (sessionId: string) =>
    new Request(`https://luke.test/eve/v1/session/${sessionId}/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, [BRAIN_HOST_HEADER.ACCOUNT]: ACCOUNT },
    });

  const { admitted } = await door(cancel(OWN_SESSION));
  assert.deepEqual(asCarriedAccount(admitted), CARRIED_ACCOUNT);
  assert.deepEqual(await door(cancel(OTHER_SESSION)), { refused: BRAIN_HOST_REFUSAL.NOT_OWNER });
});

test("the deployment's retire of a session, which a delete a browser asked for ends an agent's session with, is admitted on the named account's own session as the developer's own principal, with no row of the table; another account's session, a read, and eve's other session controls are refused", async () => {
  const door = doorOf(coderChannel());
  const control = (sessionId: string, route: string, method = "POST") =>
    new Request(`https://luke.test/eve/v1/session/${sessionId}/${route}`, {
      method,
      headers: { authorization: `Bearer ${SECRET}`, [BRAIN_HOST_HEADER.ACCOUNT]: ACCOUNT },
    });

  const { admitted } = await door(control(OWN_SESSION, "reset"));
  assert.deepEqual(asCarriedAccount(admitted), CARRIED_ACCOUNT);
  assert.deepEqual(await door(control(OTHER_SESSION, "reset")), {
    refused: BRAIN_HOST_REFUSAL.NOT_OWNER,
  });
  for (const [route, method] of [
    ["reset", "GET"],
    ["compact", "POST"],
    ["clear", "POST"],
  ] as const) {
    assert.deepEqual(
      await door(control(OWN_SESSION, route, method)),
      { refused: BRAIN_HOST_REFUSAL.NOT_DEPLOYMENT_ACT },
      `${method} ${route}`,
    );
  }
});

test("a Claude Code agent is told of Claude Code's own tools and never of Luke's it is not offered, and an eve agent of Luke's as before", () => {
  // The tools Claude Code owns in place of Luke's, as eve's instructions name Luke's.
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
  const CLAUDE_CODES = ["TodoWrite", "WebSearch", "WebFetch", "Skill tool", "Agent tool"];
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    for (const repository of ["Acme/Relay", null]) {
      for (const memberToken of [false, true]) {
        const args = [repository, brief, true, TASK_ADDRESS, undefined, null, memberToken] as const;
        const eve = coderInstructions(...args);
        const claudeCode = coderInstructions(...args, CODER_HARNESS.CLAUDE_CODE);
        const label = `${brief} ${repository ?? "no repository"} ${memberToken ? "token" : "app"}`;
        assert.deepEqual(
          LUKES.filter((tool) => claudeCode.includes(tool)),
          [],
          label,
        );
        assert.ok(
          LUKES.some((tool) => eve.includes(tool)),
          label,
        );
        assert.deepEqual(
          // An agent with no repository is offered no skills.
          CLAUDE_CODES.filter(
            (tool) => !claudeCode.includes(tool) && (repository !== null || tool !== "Skill tool"),
          ),
          [],
          label,
        );
        assert.deepEqual(
          CLAUDE_CODES.filter((tool) => eve.includes(tool)),
          [],
          label,
        );
        // The tools that touch Luke stay Luke's, under their own names.
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

test("a Claude Code or Codex agent is told of its browser, which Luke's MCP server serves it, with Playwright run from its own shell", () => {
  const BROWSER = `\`${CODER_TOOL.BROWSER}\` drives a real browser, a Chromium in your own sandbox`;
  const SHELL_OF = [
    [CODER_HARNESS.CLAUDE_CODE, "on Playwright from Bash,"],
    [CODER_HARNESS.CODEX, "on Playwright from your shell,"],
  ] as const;
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
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

test("a local agent is told its folders on the Mac, its own harness's sandbox, and no browser", () => {
  const MAC = {
    local: true,
    checkoutPath: "/Users/dev/.luke/agents/a1/repository",
    installedSkills: "/Users/dev/.luke/agents/a1/installed-skills",
  };
  const SANDBOX_OF = [
    [CODER_HARNESS.CLAUDE_CODE, "Claude Code's own sandbox", "Codex's own sandbox"],
    [CODER_HARNESS.CODEX, "Codex's own sandbox", "Claude Code's own sandbox"],
  ] as const;
  for (const repository of ["Acme/Relay", null]) {
    for (const [harness, own, other] of SANDBOX_OF) {
      const words = coderInstructions(
        repository,
        CODING_AGENT_BRIEF.PROMPT,
        true,
        TASK_ADDRESS,
        undefined,
        true,
        null,
        false,
        harness,
        undefined,
        false,
        MAC,
      );
      const label = `${harness} ${repository ?? "no repository"}`;
      assert.ok(words.includes(own), label);
      assert.ok(!words.includes(other), label);
      assert.ok(!words.includes("## Your browser"), label);
      if (repository !== null) assert.ok(words.includes(`\`${MAC.checkoutPath}\``), label);
    }
  }
  const codex = coderInstructions(
    "Acme/Relay",
    CODING_AGENT_BRIEF.PROMPT,
    true,
    TASK_ADDRESS,
    undefined,
    true,
    null,
    false,
    CODER_HARNESS.CODEX,
    undefined,
    false,
    MAC,
  );
  // Codex is pointed at the skills its member installed where the Mac keeps them.
  assert.ok(codex.includes(`\`${MAC.installedSkills}/`));
});

test("a Codex agent is told of Codex's own tools and never of Luke's it is not offered, nor of Claude Code's", () => {
  // Luke's tools Codex owns its own of; \`apply_patch\` is Codex's own too, under the same name.
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
  const CLAUDE_CODES = ["TodoWrite", "WebSearch", "WebFetch", "Skill tool", "Agent tool", "Bash"];
  const CODEXES = [
    "`apply_patch`",
    "`update_plan`",
    "Codex's own web search",
    "Codex's own subagents",
  ];
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
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
        // An agent with a repository is pointed at its skills where Codex keeps them.
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
  const TASK_LINK = "`https://tryluke.dev/<workspace>/plan/<id>` link names a task";
  const PAGES = `show it with \`${CODER_TOOL.SHOW_PAGE}\``;
  const COMMENTS = `answer in that thread with \`${CODER_TOOL.REPLY_TO_COMMENT}\``;
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
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

test("an agent on a task starts the agents that help with it on its own task, and one an automation started with no task, which has none, names a task for them", () => {
  const OWN_TASK = "Start it on your own task";
  const NO_TASK = "You work on no task, so name the task to start it on";
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
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

test("an agent on a task is offered edit_plan, show_page, the comment tools, and the whiteboard's, whether it was handed the plan or a prompt, and one an automation started with no task show_page alone, its pages standing on itself", () => {
  const offered = (agent: Parameters<typeof taskToolsOf>[0]) => [...taskToolsOf(agent)].sort();
  const comments = [
    CODER_TOOL.READ_COMMENTS,
    CODER_TOOL.REOPEN_THREAD,
    CODER_TOOL.REPLY_TO_COMMENT,
    CODER_TOOL.RESOLVE_THREAD,
  ];
  const board = [CODER_TOOL.DRAW_ON_BOARD, CODER_TOOL.LOOK_AT_BOARD];
  const all = [
    CODER_TOOL.EDIT_PLAN,
    CODER_TOOL.SHOW_PAGE,
    CODER_TOOL.LOOK_AT_PICTURE,
    ...comments,
    ...board,
  ].sort();
  const handedItsTask = { taskId: "plan-1", prompt: null };
  const handedPrompt = { taskId: "plan-1", prompt: "Fix the flaky test." };
  const automation = { taskId: null, prompt: "Sweep the flaky tests." };
  assert.deepEqual(offered(handedItsTask), all);
  assert.deepEqual(offered(handedPrompt), all);
  assert.deepEqual(offered(automation), [CODER_TOOL.SHOW_PAGE]);
});

test("every agent on a task is told how to update its plan, one handed a prompt told to read it first, and one on no task told of no plan", () => {
  const UPDATING = "## Updating the plan";
  const READ_FIRST = `Read it with \`${CODER_TOOL.READ_TASK}\``;
  const told = (brief: CodingAgentBrief, taskLink: string | null) => {
    const words = coderInstructions("Acme/Relay", brief, true, taskLink);
    return [
      words.includes(UPDATING),
      words.includes(CODER_TOOL.EDIT_PLAN),
      words.includes(READ_FIRST),
    ];
  };
  assert.deepEqual(told(CODING_AGENT_BRIEF.PLAN, TASK_ADDRESS), [true, true, false]);
  assert.deepEqual(told(CODING_AGENT_BRIEF.PROMPT, TASK_ADDRESS), [true, true, true]);
  assert.deepEqual(told(CODING_AGENT_BRIEF.PROMPT, null), [false, false, false]);
});

test("every agent on a task is told to keep its task's status with update_task, moving it back to in progress and on to done, a helper on its starter's task leaving it to the starter and one on a task of its own keeping that one's, and one on no task told of no status", () => {
  const STATUS = "## Your task's status";
  const told = (brief: CodingAgentBrief, taskLink: string | null) => {
    const words = coderInstructions("Acme/Relay", brief, true, taskLink);
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
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    assert.deepEqual(told(brief, TASK_ADDRESS), [true, true, true, true, true], brief);
    assert.deepEqual(told(brief, null), [false, false, false, false, false], brief);
  }
});

test("an agent asked for a plan, a proposal, or research opens no pull request of a document, and writes it where it can: the plan, or a page, on its task or on itself", () => {
  const NO_DOCUMENT = "never commit the write-up as a document";
  const PLAN = `write it into the plan with \`${CODER_TOOL.EDIT_PLAN}\``;
  const PAGE = `show it as a page with \`${CODER_TOOL.SHOW_PAGE}\``;
  const told = (brief: CodingAgentBrief, taskLink: string | null) => {
    const words = coderInstructions("Acme/Relay", brief, true, taskLink);
    assert.ok(words.includes(NO_DOCUMENT), brief);
    return [words.includes(PLAN), words.includes(PAGE)];
  };
  assert.deepEqual(told(CODING_AGENT_BRIEF.PLAN, TASK_ADDRESS), [true, true]);
  assert.deepEqual(told(CODING_AGENT_BRIEF.PROMPT, TASK_ADDRESS), [false, true]);
  assert.deepEqual(told(CODING_AGENT_BRIEF.PROMPT, null), [false, true]);
});

test("the session is told never to ask for a credential or a secret in a form, since the answer reaches the transcript", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    assert.ok(
      coderInstructions("Acme/Relay", brief, false, TASK_ADDRESS).includes(
        "Never ask for a credential or a secret in a form",
      ),
      brief,
    );
  }
});

test("the session sends whatever is ready for the developer to look at or review to a thread, a pull request among it, and a test only the developer can run, save an agent another coding agent started, which sends that agent what it would post", () => {
  const READY = "ready for them to look at or review";
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    for (const taskLink of [TASK_ADDRESS, null]) {
      const inbox = coderInstructions("Acme/Relay", brief, true, taskLink).split("## Threads")[1];
      assert.ok(inbox?.includes(READY), brief);
      assert.ok(inbox?.includes("a pull request you opened or marked ready"), brief);
      assert.ok(inbox?.includes("needs to test something by hand"), brief);
      // An agent another coding agent started sends that agent what it would post instead.
      assert.ok(
        inbox?.includes(
          "Where another coding agent started you, as your first message says, threads to the developer are that agent's to post",
        ),
        brief,
      );
    }
  }
});

test("an agent writing as its developer is told to end every commit on the trailer naming Luke as co-author, one writing as the App is told never to add one, and both open a pull request through the service, never gh", () => {
  const TRAILER = "Co-authored-by: luke[bot] <90001+luke[bot]@users.noreply.github.com>";
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const developer = coderInstructions("Acme/Relay", brief, true, TASK_ADDRESS, TRAILER);
    const app = coderInstructions("Acme/Relay", brief, true, TASK_ADDRESS);
    assert.ok(developer.includes(`exactly as written: \`${TRAILER}\``), brief);
    assert.ok(!developer.includes("add a `Co-authored-by` trailer"), brief);
    assert.ok(app.includes("add a `Co-authored-by` trailer"), brief);
    assert.ok(!app.includes(TRAILER), brief);
    for (const instructions of [developer, app]) {
      assert.ok(
        instructions.includes(
          `open the pull request with \`${CODER_TOOL.OPEN_PULL_REQUEST}\`, never \`gh pr create\``,
        ),
        brief,
      );
    }
  }
});

test("an agent on its starter's own token reads its checks and its pull request over GitHub's REST API under its repository, never gh pr, and is told a draft cannot be marked ready from its sandbox", () => {
  const TRAILER = "Co-authored-by: luke[bot] <90001+luke[bot]@users.noreply.github.com>";
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const words = (memberToken: boolean) =>
      coderInstructions("Acme/Relay", brief, true, TASK_ADDRESS, TRAILER, null, memberToken);
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

test("an agent whose credential reads its checks waits on them with sleep until GitHub tells it they finished, never on a watch of CI, which it is offered and its read-only worker is not", () => {
  const WAIT = `wait with \`${CODER_TOOL.SLEEP}\``;
  const TOLD = "GitHub tells you so in a message, which ends the wait early";
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    for (const memberToken of [false, true]) {
      const reads = coderInstructions(
        "Acme/Relay",
        brief,
        true,
        TASK_ADDRESS,
        undefined,
        null,
        memberToken,
      );
      assert.ok(reads.includes(WAIT) && reads.includes(TOLD), brief);
      assert.ok(
        !reads.includes("--fail-fast") && reads.includes("command that waits on CI"),
        brief,
      );
    }
    assert.ok(!coderInstructions("Acme/Relay", brief, false, TASK_ADDRESS).includes(WAIT), brief);
  }
  assert.deepEqual(
    [
      toolsOf(AGENT_ROLE.CODER).has(CODER_TOOL.SLEEP),
      toolsOf(AGENT_ROLE.CODER_WORKER).has(CODER_TOOL.SLEEP),
    ],
    [true, false],
  );
});

test("the model is shown the bound on one pause", () => {
  const shown = serializeModelInputSchema(SLEEP_TOOL.inputSchema);
  assert.equal(
    JSON.stringify(shown).includes(`"maximum":${Duration.toSeconds(CODER.SLEEP_MAX)}`),
    true,
  );
});

test("every agent is told that what happens on its pull request after its turn reaches it from GitHub, and to read its reviews before it ends a turn", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    for (const ciReadable of [true, false]) {
      const instructions = coderInstructions("Acme/Relay", brief, ciReadable, TASK_ADDRESS);
      assert.ok(instructions.includes("reaches you as a message from GitHub"), brief);
      assert.ok(instructions.includes("before you end a turn on an open pull request"), brief);
    }
  }
});

test("every agent is told to reply to a message on an inbox thread on that thread, never in its own message alone, and never to post how the work is going", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
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
      // Note that a progress note on a thread is noise the developer must acknowledge, so none is asked for.
      assert.ok(
        instructions.includes("Never post on a thread to say how the work is going"),
        brief,
      );
      assert.ok(!instructions.includes("saying what you did with it"), brief);
    }
  }
});

test("every agent is told to look at a UI it built in the image's Chromium and show the developer what it saw", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    for (const onTask of [true, false]) {
      const instructions = coderInstructions(
        "Acme/Relay",
        brief,
        true,
        onTask ? TASK_ADDRESS : null,
      );
      assert.ok(instructions.includes("playwright screenshot"), brief);
      assert.ok(instructions.includes('NODE_PATH="$(npm root -g)"'), brief);
      assert.ok(instructions.includes(`with \`${CODER_TOOL.SHOW_IMAGE}\``), brief);
    }
  }
});

/** The task link the golden's on-task prompts were composed with. */
const TASK_LINK = "https://tryluke.dev/acme/task/5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";

/** A coding agent's instructions, recorded for each brief, on a task and on none, byte for byte. */
const CODER_PATH = fileURLToPath(
  new URL("../../../fixtures/coder-instructions/coder.json", import.meta.url),
);

/** The instructions for each brief, on a task and on none, as the golden records them. */
function briefInstructions(): Record<string, { onTask: string; taskless: string }> {
  return Object.fromEntries(
    Object.values(CODING_AGENT_BRIEF).map((brief) => [
      brief,
      {
        onTask: coderInstructions("Acme/Relay", brief, true, TASK_LINK),
        taskless: coderInstructions("Acme/Relay", brief, false, null),
      },
    ]),
  );
}

// Note that the golden is written again only under LUKE_UPDATE_FIXTURES=1, and the diff explained in the PR.
if (process.env.LUKE_UPDATE_FIXTURES === "1") {
  writeFileSync(CODER_PATH, `${JSON.stringify(briefInstructions(), null, 2)}\n`);
}

const CODER_GOLDEN = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Struct({ onTask: Schema.String, taskless: Schema.String })),
)(JSON.parse(readFileSync(CODER_PATH, "utf8")));

test("a coding agent's instructions are the golden's, byte for byte, for each brief on a task and on none", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const recorded = CODER_GOLDEN[brief];
    assert.ok(recorded, brief);
    assert.equal(coderInstructions("Acme/Relay", brief, true, TASK_LINK), recorded.onTask, brief);
    assert.equal(coderInstructions("Acme/Relay", brief, false, null), recorded.taskless, brief);
  }
});

test("with Memory off the instructions say nothing of the workspace's memory; with it on they add its section before the one on messages, and nothing else", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const off = coderInstructions("Acme/Relay", brief, true, TASK_LINK);
    const on = coderInstructions(
      "Acme/Relay",
      brief,
      true,
      TASK_LINK,
      undefined,
      null,
      false,
      CODER_HARNESS.EVE,
      CODING_AGENT_KIND.CODER,
      true,
    );
    assert.ok(!off.includes("## The workspace's memory"), brief);
    assert.ok(!off.includes(`\`${CODER_TOOL.REMEMBER}\``), brief);
    const start = on.indexOf("## The workspace's memory\n\n");
    const end = on.indexOf("## What your messages are", start);
    assert.ok(start > 0 && end > start, brief);
    assert.ok(on.slice(start, end).includes(`\`${CODER_TOOL.RECALL}\``), brief);
    assert.equal(on.slice(0, start) + on.slice(end), off, brief);
  }
});

test("with Memory on, the operator is told to keep the developer's own preferences and what they are juggling private, and a coder that it keeps and recalls none", () => {
  const memorySection = (kind: CodingAgentKind) => {
    const on = coderInstructions(
      null,
      CODING_AGENT_BRIEF.BLANK,
      false,
      null,
      undefined,
      null,
      false,
      CODER_HARNESS.EVE,
      kind,
      true,
    );
    const start = on.indexOf("## The workspace's memory\n\n");
    return on.slice(start, on.indexOf("## What your messages are", start));
  };
  const operator = memorySection(CODING_AGENT_KIND.OPERATOR);
  const coder = memorySection(CODING_AGENT_KIND.CODER);

  assert.ok(operator.includes("Keep the developer's own preferences and what they are juggling"));
  assert.ok(operator.includes("as private memories, with private set"));
  assert.ok(coder.includes("you are never answered one, and you never set private"));
  assert.ok(!coder.includes("what they are juggling"));
});

/** The member's operator's instructions, recorded byte for byte: an agent of kind operator, blank, on no task and no repository. */
const OPERATOR_PATH = fileURLToPath(
  new URL("../../../fixtures/coder-instructions/operator.json", import.meta.url),
);

/** An operator's instructions as its session composes them. */
function operatorInstructions(): string {
  return coderInstructions(
    null,
    CODING_AGENT_BRIEF.BLANK,
    false,
    null,
    undefined,
    null,
    false,
    CODER_HARNESS.EVE,
    CODING_AGENT_KIND.OPERATOR,
  );
}

// Note that the golden is written again only under LUKE_UPDATE_FIXTURES=1, and the diff explained in the PR.
if (process.env.LUKE_UPDATE_FIXTURES === "1") {
  writeFileSync(
    OPERATOR_PATH,
    `${JSON.stringify({ operator: operatorInstructions() }, null, 2)}\n`,
  );
}

const OPERATOR_GOLDEN = Schema.decodeUnknownSync(Schema.Struct({ operator: Schema.String }))(
  JSON.parse(readFileSync(OPERATOR_PATH, "utf8")),
);

test("an operator's instructions are the golden's, byte for byte: its own job and Steward's rules in place of an agent's job and pull request, and no delete; a coder's are the same whatever the kind defaults to", () => {
  const operator = operatorInstructions();
  assert.equal(operator, OPERATOR_GOLDEN.operator);
  for (const told of [
    "You are Luke, the developer's operator in this workspace",
    "## What you may do unasked",
    "## Never",
    "Never merge or close a pull request yourself, and never ask an agent to merge or close one on your own initiative.",
    `When the developer asks you in this conversation to merge or close a pull request, tell the agent that owns it to do it, with \`${CODER_TOOL.MESSAGE_AGENT}\``,
    "and messaging the developer's own agents. To reach a teammate's agent, ask the developer.",
    "Never delete anything.",
    "Never answer a thread's ask for the developer",
    "Never change Settings, keys, or integrations.",
    "Never act on a teammate's agent beyond reading it:",
    "Report each action you took unasked as a line of its own in your reply",
    "ask the developer in a thread",
    `reports back to you with \`${CODER_TOOL.MESSAGE_AGENT}\``,
    "## Your opening",
    `\`${CODER_TOOL.LIST_OPEN_ASKS}\``,
  ]) {
    assert.ok(operator.includes(told), told);
  }
  for (const untold of [
    "implement the plan",
    `\`${CODER_TOOL.OPEN_PULL_REQUEST}\``,
    `\`${CODER_TOOL.DELETE_SECTION}\``,
    "and never ask an agent to.",
    "and messaging any agent.",
    "beyond reading it and messaging it",
  ]) {
    assert.ok(!operator.includes(untold), untold);
  }
  // A coder on no repository is told the opposite on each, so the operator's words are its alone.
  const coder = coderInstructions(null, CODING_AGENT_BRIEF.BLANK, false, null);
  assert.ok(!coder.includes("## What you may do unasked"));
  assert.ok(coder.includes(`\`${CODER_TOOL.DELETE_SECTION}\``));
  assert.ok(!coder.includes(`\`${CODER_TOOL.LIST_OPEN_ASKS}\``));
});
